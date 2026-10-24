'use strict';
const crypto = require('node:crypto');
const { nowIso } = require('../db');
const { clean, normalizePhone, isEmail } = require('../util');

const CATEGORIES = { laundry: 'Laundry', cyber: 'Cyber café', food: 'Food / refreshments', other: 'Something else' };
const METHODS = { phone: 'Phone call', whatsapp: 'WhatsApp', email: 'E-mail' };
const STATUSES = { new: 'New', in_progress: 'In progress', resolved: 'Resolved', archived: 'Archived' };
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newRef() {
  const b = crypto.randomBytes(8);
  return 'MI-' + Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('');
}

function validate(input, { foodEnabled }) {
  const errors = {};
  const name = clean(input.name, 100);
  if (name.length < 2) errors.name = 'Please enter your name.';
  else if (name.length > 100) errors.name = 'Please keep your name under 100 characters.';
  const contact_method = ['phone', 'whatsapp', 'email'].includes(input.contact_method) ? input.contact_method : '';
  if (!contact_method) errors.contact_method = 'Choose how we should reach you.';
  let contact_value = clean(input.contact_value, 120);
  if (contact_method === 'email') { contact_value = contact_value.toLowerCase(); if (!isEmail(contact_value)) errors.contact_value = 'Enter a valid e-mail address.'; }
  else if (contact_method) { const p = normalizePhone(contact_value); if (!p) errors.contact_value = 'Enter a valid phone number, e.g. 0712 345 678.'; else contact_value = p; }
  else if (!contact_value) errors.contact_value = 'Enter your phone number or e-mail.';
  const allowed = Object.keys(CATEGORIES).filter((k) => k !== 'food' || foodEnabled);
  const category = allowed.includes(input.category) ? input.category : '';
  if (!category) errors.category = 'Choose what your enquiry is about.';
  const message = clean(input.message, 1000);
  if (message.length < 10) errors.message = 'Please write a short message (at least 10 characters).';
  else if (message.length > 1000) errors.message = 'Please keep your message under 1000 characters.';
  return { errors, values: { name, contact_method, contact_value, category, message: message.slice(0, 1000) } };
}

// Returns { ref, duplicate }. A repeat of the same enquiry within 10 minutes is not stored twice.
async function create(db, v) {
  const dedupe = crypto.createHash('sha256').update([v.name, v.contact_value, v.category, v.message].join('\u0000').toLowerCase()).digest('hex');
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const dup = await db.get('SELECT ref FROM enquiries WHERE dedupe_hash = ? AND created_at > ?', dedupe, since);
  if (dup) return { ref: dup.ref, duplicate: true };
  const ref = newRef();
  await db.run('INSERT INTO enquiries (ref, name, contact_method, contact_value, category, message, dedupe_hash) VALUES (?,?,?,?,?,?,?)', ref, v.name, v.contact_method, v.contact_value, v.category, v.message, dedupe);
  return { ref, duplicate: false };
}

async function list(db, { status = '', q = '', page = 1, pageSize = 20 } = {}) {
  const where = []; const params = [];
  if (status && status in STATUSES) { where.push('status = ?'); params.push(status); } else where.push("status != 'archived'");
  if (q) { where.push("(name ILIKE ? ESCAPE '\\' OR message ILIKE ? ESCAPE '\\' OR ref ILIKE ? ESCAPE '\\' OR contact_value ILIKE ? ESCAPE '\\')"); const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`; params.push(like, like, like, like); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await db.get(`SELECT COUNT(*) c FROM enquiries ${w}`, ...params)).c;
  const rows = await db.all(`SELECT * FROM enquiries ${w} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
const get = async (db, id) => await db.get('SELECT * FROM enquiries WHERE id = ?', id);
const countNew = async (db) => (await db.get("SELECT COUNT(*) c FROM enquiries WHERE status = 'new'")).c;
async function update(db, id, { status, notes }) {
  if (!(status in STATUSES)) return false;
  await db.run('UPDATE enquiries SET status = ?, internal_notes = ?, updated_at = ? WHERE id = ?', status, clean(notes, 1000).slice(0, 1000), nowIso(), id);
  return true;
}
const remove = async (db, id) => await db.run('DELETE FROM enquiries WHERE id = ?', id);

module.exports = { CATEGORIES, METHODS, STATUSES, validate, create, list, get, countNew, update, remove };
