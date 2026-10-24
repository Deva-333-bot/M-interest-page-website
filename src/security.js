'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { nowIso } = require('./db');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const dk = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(dk, expected);
}
// Used so that unknown e-mail addresses cost the same time as wrong passwords.
let dummyHash;
async function burnPasswordCheck(password) {
  dummyHash = dummyHash || (await hashPassword('dummy-password-for-timing'));
  await verifyPassword(password, dummyHash);
}

const COMMON = new Set(['password1234', '123456789012', 'qwertyuiop12', 'minterest1234', 'm-interest123', 'administrator1']);
function passwordProblem(pw, email = '') {
  if (typeof pw !== 'string' || pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (new Set(pw).size < 5) return 'Use a more varied password.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'Do not include your e-mail name in the password.';
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---- Cookies -----------------------------------------------------------------------
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) { try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ } }
  }
  return out;
}

// ---- Sessions ------------------------------------------------------------------------
class Sessions {
  constructor(db, cfg) {
    this.db = db; this.cfg = cfg;
    this.cookieName = cfg.isProd ? '__Host-mi_session' : 'mi_session';
  }
  async create(userId) {
    const token = randomToken(32);
    const now = Date.now();
    await this.db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
    await this.db.run('INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?)', sha256(token), userId, randomToken(24), new Date(now).toISOString(), new Date(now).toISOString(), new Date(now + this.cfg.sessionMaxMs).toISOString());
    return token;
  }
  cookie(token, maxAgeMs) {
    const parts = [`${this.cookieName}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
    if (this.cfg.isProd) parts.push('Secure');
    return parts.join('; ');
  }
  async load(req) {
    const token = parseCookies(req.headers.cookie)[this.cookieName];
    if (!token || token.length > 100) return null;
    const row = await this.db.get(`SELECT s.*, u.email, u.role, u.active FROM sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.id_hash = ?`, sha256(token));
    if (!row) return null;
    const now = Date.now();
    const idleOk = now - Date.parse(row.last_seen_at) < this.cfg.sessionIdleMs;
    const absOk = now < Date.parse(row.expires_at);
    if (!idleOk || !absOk || !row.active) { await this.destroyHash(row.id_hash); return null; }
    if (now - Date.parse(row.last_seen_at) > 60_000) await this.db.run('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', new Date(now).toISOString(), row.id_hash);
    return { hash: row.id_hash, csrf: row.csrf_token, flash: row.flash, user: { id: row.user_id, email: row.email, role: row.role } };
  }
  async destroyHash(hash) { await this.db.run('DELETE FROM sessions WHERE id_hash = ?', hash); }
  async destroyOthers(userId, keepHash) { await this.db.run('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?', userId, keepHash); }
  async addFlash(hash, type, text) {
    const row = await this.db.get('SELECT flash FROM sessions WHERE id_hash = ?', hash);
    const list = row?.flash ? JSON.parse(row.flash) : [];
    list.push({ type, text });
    await this.db.run('UPDATE sessions SET flash = ? WHERE id_hash = ?', JSON.stringify(list.slice(-5)), hash);
  }
  async takeFlash(hash) {
    const row = await this.db.get('SELECT flash FROM sessions WHERE id_hash = ?', hash);
    if (!row?.flash) return [];
    await this.db.run('UPDATE sessions SET flash = NULL WHERE id_hash = ?', hash);
    return JSON.parse(row.flash);
  }
}

// ---- Rate limiting (in-memory, per process; fine for a single-instance deployment) ------
class RateLimiter {
  constructor() { this.hits = new Map(); }
  hit(key, limit, windowMs) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; this.hits.set(key, e); }
    e.count++;
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    return { ok: e.count <= limit, retryAfter: Math.ceil((e.reset - now) / 1000) };
  }
  reset() { this.hits.clear(); }
}

// ---- Stateless public-form token: "<timestamp>.<hmac>" -------------------------------
function formToken(secret, now = Date.now()) {
  const ts = String(now);
  return `${ts}.${crypto.createHmac('sha256', secret).update('form:' + ts).digest('base64url')}`;
}
function checkFormToken(secret, token, { minSeconds = 2, maxHours = 6 } = {}) {
  const [ts, mac] = String(token || '').split('.');
  if (!/^\d{10,15}$/.test(ts || '') || !mac) return 'invalid';
  const expected = crypto.createHmac('sha256', secret).update('form:' + ts).digest('base64url');
  if (!safeEqual(mac, expected)) return 'invalid';
  const age = (Date.now() - Number(ts)) / 1000;
  if (age < minSeconds) return 'too_fast';
  if (age > maxHours * 3600) return 'expired';
  return 'ok';
}

module.exports = { hashPassword, verifyPassword, burnPasswordCheck, passwordProblem, sha256, randomToken, safeEqual,
  parseCookies, Sessions, RateLimiter, formToken, checkFormToken };
