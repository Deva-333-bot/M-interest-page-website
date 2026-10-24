'use strict';
const { nowIso } = require('../db');
const { clean, normalizePhone, isEmail, lines } = require('../util');

// Every editable site setting. `default: ''` means "not provided": the public site hides
// anything that is empty instead of showing placeholder text.
const DEFAULT_HEADLINE = 'Everyday Services, Made Simple.';
const SCHEMA = {
  business_name: { group: 'business', label: 'Business name', type: 'text', max: 80, default: 'M-Interest', required: true },
  whatsapp_number: { group: 'business', label: 'WhatsApp number', type: 'phone', default: '', help: 'Any format, e.g. 0712 345 678 or +254 712 345 678. Stored in international format.' },
  phone_number: { group: 'business', label: 'Business telephone number', type: 'phone', default: '' },
  email: { group: 'business', label: 'Business e-mail', type: 'email', default: '' },
  address: { group: 'business', label: 'Physical address', type: 'text', max: 200, default: '', help: 'Leave empty until the real address is confirmed.' },
  area: { group: 'business', label: 'Town / neighbourhood / county', type: 'text', max: 100, default: '' },
  opening_hours: { group: 'business', label: 'Opening hours', type: 'textarea', max: 600, maxLines: 8, maxLineLength: 80, default: '', help: 'One line per entry, e.g. "Mon–Fri: 8:00–18:00". Leave empty until confirmed.' },
  map_url: { group: 'business', label: 'Map / directions link', type: 'url', default: '', help: 'https link only. Add once the location is confirmed.' },
  facebook_url: { group: 'business', label: 'Facebook page', type: 'url', default: '' },
  instagram_url: { group: 'business', label: 'Instagram profile', type: 'url', default: '' },
  tiktok_url: { group: 'business', label: 'TikTok profile', type: 'url', default: '' },

  hero_headline: { group: 'home', label: 'Homepage headline', type: 'text', max: 90, default: DEFAULT_HEADLINE, required: true, help: 'The default is a temporary example. Replace it once the positioning is confirmed.' },
  hero_subtext: { group: 'home', label: 'Homepage introduction', type: 'textarea', max: 240, default: '' },
  value_points: { group: 'home', label: 'Verified value points', type: 'textarea', max: 700, maxLines: 6, maxLineLength: 110, default: '', help: 'One per line. Only add statements the owner has confirmed. The section stays hidden when empty.' },
  about_text: { group: 'home', label: 'About text', type: 'textarea', max: 1500, default: '', help: 'Separate paragraphs with a blank line. Do not invent history, awards or customer numbers.' },
  mission: { group: 'home', label: 'Mission (only if approved)', type: 'textarea', max: 400, default: '' },
  vision: { group: 'home', label: 'Vision (only if approved)', type: 'textarea', max: 400, default: '' },

  food_enabled: { group: 'options', label: 'Show the food menu', type: 'bool', default: '0', help: 'Turn on only if M-Interest really sells food or refreshments.' },
  allow_contact_for_pricing: { group: 'options', label: 'Allow "Contact us for pricing" listings', type: 'bool', default: '0', help: 'Owner approval required before listings without a price can be published.' },
  accent: { group: 'options', label: 'Accent colour', type: 'select', options: { orange: 'Zesty Cyber Orange', crimson: 'Crimson Red' }, default: 'orange' },
  retention_months: { group: 'options', label: 'Enquiry retention (months)', type: 'int', min: 1, max: 60, default: '', help: 'Only set after the owner approves a retention policy. It is stated in the privacy notice.' },
  privacy_reviewed: { group: 'options', label: 'Privacy notice has been reviewed and approved', type: 'bool', default: '0', help: 'Until ticked, the public privacy page shows a "pending review" note.' },
};

function defaults() {
  const out = {};
  for (const [k, def] of Object.entries(SCHEMA)) out[k] = def.default;
  out.logo_path = '';
  out.food_enabled = false; out.allow_contact_for_pricing = false; out.privacy_reviewed = false;
  return out;
}
async function getAll(db) {
  const out = defaults();
  for (const row of await db.all('SELECT key, value FROM settings')) if (row.key in SCHEMA) out[row.key] = row.value;
  const logo = await db.get("SELECT value FROM settings WHERE key = 'logo_path'");
  out.logo_path = logo?.value || '';
  out.food_enabled = out.food_enabled === '1';
  out.allow_contact_for_pricing = out.allow_contact_for_pricing === '1';
  out.privacy_reviewed = out.privacy_reviewed === '1';
  return out;
}

function validate(input) {
  const values = {}; const errors = {};
  for (const [key, def] of Object.entries(SCHEMA)) {
    let v = input[key];
    if (def.type === 'bool') { values[key] = v === '1' || v === 'on' || v === 'true' ? '1' : '0'; continue; }
    v = clean(v, def.max || 300);
    if (def.max && v.length > def.max) { errors[key] = `Keep this under ${def.max} characters.`; values[key] = v.slice(0, def.max); continue; }
    if (!v) { if (def.required) errors[key] = 'This field is required.'; values[key] = ''; continue; }
    switch (def.type) {
      case 'phone': { const p = normalizePhone(v); if (!p) errors[key] = 'Enter a valid phone number, e.g. 0712 345 678 or +254 712 345 678.'; else v = p; break; }
      case 'email': if (!isEmail(v)) errors[key] = 'Enter a valid e-mail address.'; break;
      case 'url': {
        try { const u = new URL(v); if (u.protocol !== 'https:' || u.username || u.password) throw new Error('x'); v = u.toString(); } catch { errors[key] = 'Enter a full https:// link.'; }
        break;
      }
      case 'select': if (!(v in def.options)) errors[key] = 'Choose one of the options.'; break;
      case 'int': { if (!/^\d+$/.test(v) || Number(v) < def.min || Number(v) > def.max) errors[key] = `Enter a whole number from ${def.min} to ${def.max}.`; break; }
      case 'textarea': if (def.maxLines) { const ls = lines(v); if (ls.length > def.maxLines || ls.some((l) => l.length > def.maxLineLength)) errors[key] = `Use at most ${def.maxLines} lines of ${def.maxLineLength} characters.`; else v = ls.join('\n'); } break;
      default: break;
    }
    values[key] = v;
  }
  return { values, errors };
}

async function save(db, values, userId) {
  const now = nowIso();
  await db.tx(async (t) => {
    for (const [k, v] of Object.entries(values)) {
      await t.run(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, k, v, now, userId);
    }
  });
}
async function setRaw(db, key, value, userId) { await save(db, { [key]: value }, userId); }

// Things the owner still needs to supply or confirm. Shown on the dashboard only.
async function configWarnings(db, s) {
  const w = [];
  if (!s.whatsapp_number) w.push({ text: 'WhatsApp number is not set, so WhatsApp buttons are hidden on the public site.', href: '/admin/settings' });
  if (!s.phone_number) w.push({ text: 'Business telephone number is not set.', href: '/admin/settings' });
  if (!s.address) w.push({ text: 'Physical address is not set, so no address, map or location data is published.', href: '/admin/settings' });
  if (!s.opening_hours) w.push({ text: 'Opening hours are not set.', href: '/admin/settings' });
  if (s.hero_headline === DEFAULT_HEADLINE) w.push({ text: 'The homepage headline is still the temporary example text.', href: '/admin/settings' });
  if (!s.privacy_reviewed) w.push({ text: 'The privacy notice has not been marked as reviewed. Have it reviewed against Kenyan data protection requirements before launch.', href: '/admin/settings' });
  for (const sec of ['laundry', 'cyber']) {
    const n = (await db.get("SELECT COUNT(*) c FROM items WHERE section = ? AND status = 'published'", sec)).c;
    if (!n) w.push({ text: `No published ${sec === 'laundry' ? 'laundry' : 'cyber café'} listings yet. The public page shows a "being prepared" message.`, href: `/admin/items/${sec}` });
  }
  const old = s.retention_months ? (await db.get("SELECT COUNT(*) c FROM enquiries WHERE created_at < now() - make_interval(months => ?)", Number(s.retention_months))).c : 0;
  if (old) w.push({ text: `${old} enquiries are older than the ${s.retention_months}-month retention period and should be deleted.`, href: '/admin/enquiries' });
  return w;
}

module.exports = { defaults, SCHEMA, DEFAULT_HEADLINE, getAll, validate, save, setRaw, configWarnings };
