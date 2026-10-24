'use strict';
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');
const users = require('../src/models/users');

const PASSWORD = 'Correct-Horse-Battery-9';

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:testpw@127.0.0.1:5432/postgres';

// Every call gets its own empty PostgreSQL database, dropped again by stop().
async function startApp(overrides = {}) {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const name = 'mi_test_' + crypto.randomBytes(6).toString('hex');
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(ADMIN_URL); url.pathname = '/' + name;
  const cfg = loadConfig({ NODE_ENV: 'test', PORT: '0' }, { minFormSeconds: 0, ...overrides });
  const db = await openDb(url.toString(), { ssl: 'off' });
  const app = createApp(cfg, db);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app, db, cfg, base,
    limiter: app.locals.limiter,
    async stop() {
      await new Promise((r) => server.close(r));
      await db.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

// Tiny cookie-keeping HTTP client (no redirects followed automatically).
class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, url, { form, multipart, headers = {} } = {}) {
    const init = { method, redirect: 'manual', headers: { ...headers } };
    if (this.cookie) init.headers.cookie = this.cookie;
    if (form) { init.headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(form).toString(); }
    if (multipart) init.body = multipart;
    const res = await fetch(this.base + url, init);
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) { const [pair] = c.split(';'); if (/=;?$/.test(pair) || /Max-Age=0/i.test(c)) this.cookie = ''; else this.cookie = pair; }
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }
  get(url, o) { return this.req('GET', url, o); }
  post(url, form, o = {}) { return this.req('POST', url, { form, ...o }); }
  async csrf(url = '/admin') { const r = await this.get(url); const m = /name="_csrf" value="([^"]+)"/.exec(r.text); return m && m[1]; }
}

async function seedAdmin(db, { email = 'owner@example.test', role = 'owner', password = PASSWORD } = {}) {
  return users.createAdmin(db, { email, password, role });
}
async function login(base, email = 'owner@example.test', password = PASSWORD) {
  const c = new Client(base);
  const page = await c.get('/admin/login');
  const token = /name="_t" value="([^"]+)"/.exec(page.text)[1];
  const res = await c.post('/admin/login', { email, password, _t: token });
  if (res.status !== 303) throw new Error('login failed: ' + res.status);
  return c;
}
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function contactToken(client) { return /name="_t" value="([^"]+)"/.exec((await client.get('/contact')).text)[1]; }
module.exports = { contactToken, startApp, Client, seedAdmin, login, PASSWORD, PNG };
