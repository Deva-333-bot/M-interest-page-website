'use strict';

// ---- HTML escaping template tag -------------------------------------------------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(esc).join('');
  if (v === null || v === undefined || v === false) return '';
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}
function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += esc(vals[i]) + strings[i + 1];
  return new Raw(out);
}

// ---- Money (KES, stored as integer minor units) ---------------------------------
function parseKES(input) {
  const s = String(input ?? '').replace(/^\s*(KES|KSH|KSHS)\.?\s*/i, '').replace(/[,\s]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}
function formatKES(minor) {
  if (minor === null || minor === undefined) return '';
  const whole = Math.floor(minor / 100);
  const frac = minor % 100;
  const w = whole.toLocaleString('en-KE');
  return `KES ${w}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}
const minorToInput = (minor) => (minor === null || minor === undefined ? '' : (minor % 100 ? (minor / 100).toFixed(2) : String(minor / 100)));

// ---- Text helpers ---------------------------------------------------------------
function slugify(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}
const clean = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max === undefined ? 5000 : max + 1);
const qs = (v) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''));
const paragraphs = (text) => String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
const lines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);

// ---- Phone numbers --------------------------------------------------------------
// Returns E.164 string (e.g. +254712345678) or null. Local numbers starting with 0 are
// assumed to be Kenyan (+254) because that is the launch market.
function normalizePhone(input) {
  let s = String(input ?? '').trim();
  if (!/^[+\d][\d\s().-]*$/.test(s)) return null;
  const hadPlus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (s.startsWith('00')) s = s.slice(2);
  else if (!hadPlus && s.startsWith('0')) s = '254' + s.slice(1);
  else if (!hadPlus && /^[17]\d{8}$/.test(s)) s = '254' + s;
  if (!/^[1-9]\d{7,14}$/.test(s)) return null;
  if (s.startsWith('254') && !/^254[17]\d{8}$/.test(s)) return null;
  return '+' + s;
}
function formatPhone(e164) {
  const m = /^\+254([17]\d{2})(\d{3})(\d{3})$/.exec(e164 || '');
  return m ? `+254 ${m[1]} ${m[2]} ${m[3]}` : e164 || '';
}
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const isEmail = (s) => s.length <= 254 && EMAIL_RE.test(s);

function whatsappLink(e164, text) {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}

// ---- Dates (stored as UTC ISO; displayed in East Africa Time) ------------------------
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(d);
}

const SECTIONS = {
  laundry: { label: 'Laundry', path: '/laundry', singular: 'laundry service' },
  cyber: { label: 'Cyber café', path: '/cyber-cafe', singular: 'cyber café service' },
  food: { label: 'Food menu', path: '/menu', singular: 'menu item' },
};

module.exports = { Raw, raw, esc, html, parseKES, formatKES, minorToInput, slugify, clean, qs, paragraphs, lines,
  normalizePhone, formatPhone, isEmail, whatsappLink, fmtDate, SECTIONS };
