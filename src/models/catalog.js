'use strict';
const { nowIso } = require('../db');
const { clean, parseKES, minorToInput, slugify, formatKES, SECTIONS } = require('../util');

const SECTION_KEYS = Object.keys(SECTIONS);
const isSection = (s) => SECTION_KEYS.includes(s);
const UNIT_SUGGESTIONS = {
  laundry: ['per kg', 'per item', 'per piece', 'per load', 'per bag', 'package'],
  cyber: ['per page', 'per document', 'per hour', 'per 30 minutes', 'per copy', 'per photo'],
  food: ['per plate', 'per cup', 'per piece', 'per serving', 'per bottle'],
};

async function uniqueSlug(db, table, section, base, ignoreId = 0) {
  let slug = base; let n = 2;
  while (await db.get(`SELECT 1 FROM ${table} WHERE section = ? AND slug = ? AND id != ?`, section, slug, ignoreId)) slug = `${base}-${n++}`;
  return slug;
}

// ---------------------------------------------------------------- categories
async function listCategories(db, section, { publishedOnly = false } = {}) {
  return await db.all(`SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS item_count
    FROM categories c WHERE c.section = ? ${publishedOnly ? 'AND c.is_published = 1' : ''} ORDER BY c.sort_order, c.name`, section);
}
const getCategory = async (db, id) => await db.get('SELECT * FROM categories WHERE id = ?', id);

function validateCategory(input) {
  const errors = {};
  const name = clean(input.name, 80);
  if (name.length < 2) errors.name = 'Enter a name (at least 2 characters).';
  else if (name.length > 80) errors.name = 'Keep the name under 80 characters.';
  const description = clean(input.description, 300);
  if (description.length > 300) errors.description = 'Keep the description under 300 characters.';
  const sortRaw = clean(input.sort_order, 6) || '0';
  const sort_order = /^-?\d{1,4}$/.test(sortRaw) ? Number(sortRaw) : NaN;
  if (Number.isNaN(sort_order)) errors.sort_order = 'Enter a whole number.';
  return { values: { name, description: description.slice(0, 300), sort_order: Number.isNaN(sort_order) ? 0 : sort_order, is_published: input.is_published === '1' || input.is_published === 'on' ? 1 : 0 }, errors };
}
async function createCategory(db, section, v) {
  for (let attempt = 0; ; attempt++) {
    const slug = await uniqueSlug(db, 'categories', section, slugify(v.name));
    try {
      const r = await db.run('INSERT INTO categories (section, name, slug, description, sort_order, is_published) VALUES (?,?,?,?,?,?) RETURNING id', section, v.name, slug, v.description, v.sort_order, v.is_published);
      return r.rows[0].id;
    } catch (e) { if (e.code === '23505' && attempt < 4) continue; throw e; }
  }
}
async function updateCategory(db, id, v) {
  await db.run('UPDATE categories SET name=?, description=?, sort_order=?, is_published=?, updated_at=? WHERE id=?', v.name, v.description, v.sort_order, v.is_published, nowIso(), id);
}
async function deleteCategory(db, id) {
  const n = (await db.get('SELECT COUNT(*) c FROM items WHERE category_id = ?', id)).c;
  if (n) return { ok: false, reason: `This category still contains ${n} listing${n === 1 ? '' : 's'}. Move or delete them first.` };
  await db.run('DELETE FROM categories WHERE id = ?', id);
  return { ok: true };
}

// --------------------------------------------------------------------- items
const ITEM_SELECT = `SELECT i.*, c.name AS category_name, c.slug AS category_slug, c.is_published AS category_published
  FROM items i JOIN categories c ON c.id = i.category_id`;

const getItem = async (db, id) => await db.get(`${ITEM_SELECT} WHERE i.id = ?`, id);

function validateItem(input, { section, categories, settings }) {
  const errors = {};
  const name = clean(input.name, 120);
  if (name.length < 2) errors.name = 'Enter a name (at least 2 characters).';
  else if (name.length > 120) errors.name = 'Keep the name under 120 characters.';

  const category_id = /^\d+$/.test(String(input.category_id || '')) ? Number(input.category_id) : 0;
  if (!categories.some((c) => c.id === category_id)) errors.category_id = categories.length ? 'Choose a category.' : 'Create a category first.';

  const description = clean(input.description, 600);
  if (description.length > 600) errors.description = 'Keep the description under 600 characters.';
  const conditions = clean(input.conditions, 300);
  if (conditions.length > 300) errors.conditions = 'Keep this under 300 characters.';

  const status = input.status === 'published' ? 'published' : 'draft';
  const availability = input.availability === 'unavailable' ? 'unavailable' : 'available';
  const pricing_type = input.pricing_type === 'quote' ? 'quote' : 'fixed';
  const pricing_unit = clean(input.pricing_unit, 40);
  if (pricing_unit.length > 40) errors.pricing_unit = 'Keep the unit under 40 characters.';

  let price_minor = null;
  if (pricing_type === 'fixed') {
    const raw = clean(input.price, 20);
    if (raw) {
      price_minor = parseKES(raw);
      if (price_minor === null) errors.price = 'Enter a price in KES, e.g. 250 or 250.50.';
      else if (price_minor <= 0) errors.price = 'The price must be greater than 0.';
    } else if (status === 'published') errors.price = 'A price is required before publishing (or choose "Contact us for pricing").';
    if (status === 'published' && !pricing_unit && section !== 'food') errors.pricing_unit = 'Say what the price covers (e.g. per kg, per page) before publishing.';
  } else if (status === 'published' && !settings.allow_contact_for_pricing) {
    errors.pricing_type = '"Contact us for pricing" must be approved by the owner in Settings before such a listing can be published.';
  }

  const alt = clean(input.image_alt, 150);
  if (alt.length > 150) errors.image_alt = 'Keep the description under 150 characters.';
  const sortRaw = clean(input.sort_order, 6) || '0';
  const sort_order = /^-?\d{1,4}$/.test(sortRaw) ? Number(sortRaw) : NaN;
  if (Number.isNaN(sort_order)) errors.sort_order = 'Enter a whole number.';

  return {
    errors,
    values: { name, category_id, description: description.slice(0, 600), conditions: conditions.slice(0, 300), status, availability, pricing_type, pricing_unit: pricing_unit.slice(0, 40),
      price_minor, image_alt: alt.slice(0, 150), sort_order: Number.isNaN(sort_order) ? 0 : sort_order, featured: input.featured === '1' || input.featured === 'on' ? 1 : 0 },
  };
}

async function createItem(db, section, v, userId) {
  for (let attempt = 0; ; attempt++) {
    const slug = await uniqueSlug(db, 'items', section, slugify(v.name));
    try {
      const r = await db.run(`INSERT INTO items (section, category_id, name, slug, description, pricing_type, price_minor, pricing_unit, conditions,
        image_path, image_alt, availability, status, featured, sort_order, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
        section, v.category_id, v.name, slug, v.description, v.pricing_type, v.price_minor, v.pricing_unit, v.conditions, v.image_path || null, v.image_alt, v.availability, v.status, v.featured, v.sort_order, userId);
      return r.rows[0].id;
    } catch (e) { if (e.code === '23505' && attempt < 4) continue; throw e; } // slug taken by a concurrent request: retry
  }
}
async function updateItem(db, id, v, userId) {
  await db.run(`UPDATE items SET category_id=?, name=?, description=?, pricing_type=?, price_minor=?, pricing_unit=?, conditions=?, image_path=?, image_alt=?,
    availability=?, status=?, featured=?, sort_order=?, updated_at=?, updated_by=? WHERE id=?`, v.category_id, v.name, v.description, v.pricing_type, v.price_minor, v.pricing_unit, v.conditions, v.image_path || null, v.image_alt, v.availability, v.status, v.featured, v.sort_order, nowIso(), userId, id);
}
async function setStatus(db, item, status, settings, userId) {
  if (status === 'published') {
    if (item.pricing_type === 'fixed' && item.price_minor === null) return { ok: false, reason: 'Add a price before publishing.' };
    if (item.pricing_type === 'fixed' && !item.pricing_unit && item.section !== 'food') return { ok: false, reason: 'Add a pricing unit before publishing.' };
    if (item.pricing_type === 'quote' && !settings.allow_contact_for_pricing) return { ok: false, reason: '"Contact us for pricing" is not approved in Settings.' };
  }
  await db.run('UPDATE items SET status=?, updated_at=?, updated_by=? WHERE id=?', status, nowIso(), userId, item.id);
  return { ok: true };
}
const deleteItem = async (db, id) => await db.run('DELETE FROM items WHERE id = ?', id);

async function adminList(db, section, { q = '', category = 0, status = '', page = 1, pageSize = 25 } = {}) {
  const where = ['i.section = ?']; const params = [section];
  if (q) { where.push("(i.name ILIKE ? ESCAPE '\\' OR i.description ILIKE ? ESCAPE '\\')"); const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`; params.push(like, like); }
  if (category) { where.push('i.category_id = ?'); params.push(category); }
  if (status === 'draft' || status === 'published') { where.push('i.status = ?'); params.push(status); }
  if (status === 'unavailable') where.push("i.availability = 'unavailable'");
  const total = (await db.get(`SELECT COUNT(*) c FROM items i WHERE ${where.join(' AND ')}`, ...params)).c;
  const rows = await db.all(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.sort_order, c.name, i.sort_order, i.name LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// -------------------------------------------------------------------- public
// The ONLY queries used by public pages and the public JSON API. Drafts, and items in
// unpublished categories, are never returned.
const PUBLIC_WHERE = "i.section = ? AND i.status = 'published' AND c.is_published = 1";
async function publicItems(db, section, { q = '' } = {}) {
  const params = [section]; let extra = '';
  if (q) { extra = " AND (i.name ILIKE ? ESCAPE '\\' OR i.description ILIKE ? ESCAPE '\\' OR c.name ILIKE ? ESCAPE '\\')"; const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`; params.push(like, like, like); }
  return await db.all(`${ITEM_SELECT} WHERE ${PUBLIC_WHERE}${extra} ORDER BY c.sort_order, c.name, i.sort_order, i.name`, ...params);
}
const publicItem = async (db, id) => await db.get(`${ITEM_SELECT} WHERE i.id = ? AND i.status = 'published' AND c.is_published = 1`, id);
const featuredItems = async (db, section, limit = 6) => await db.all(`${ITEM_SELECT} WHERE ${PUBLIC_WHERE} AND i.featured = 1 AND i.availability = 'available' AND (i.pricing_type = 'fixed') ORDER BY i.sort_order, i.name LIMIT ?`, section, limit);
const publicCount = async (db, section) => (await db.get(`SELECT COUNT(*) c FROM items i JOIN categories c ON c.id = i.category_id WHERE ${PUBLIC_WHERE}`, section)).c;

function groupByCategory(rows) {
  const groups = [];
  for (const r of rows) {
    let g = groups[groups.length - 1];
    if (!g || g.id !== r.category_id) { g = { id: r.category_id, name: r.category_name, slug: r.category_slug, items: [] }; groups.push(g); }
    g.items.push(r);
  }
  return groups;
}

// Shape returned by the public JSON API: no internal ids of admins, no status fields.
function toPublic(r) {
  return {
    id: r.id, section: r.section, category: r.category_name, name: r.name, slug: r.slug, description: r.description,
    pricing: r.pricing_type === 'fixed' ? { type: 'fixed', amount: (r.price_minor / 100).toFixed(2), currency: r.currency, unit: r.pricing_unit, display: formatKES(r.price_minor) } : { type: 'quote', display: 'Contact us for pricing' },
    conditions: r.conditions, availability: r.availability, image: r.image_path ? { url: `/uploads/${r.image_path}`, alt: r.image_alt } : null,
  };
}

module.exports = { isSection, SECTION_KEYS, UNIT_SUGGESTIONS, listCategories, getCategory, validateCategory, createCategory, updateCategory, deleteCategory,
  getItem, validateItem, createItem, updateItem, setStatus, deleteItem, adminList, publicItems, publicItem, featuredItems, publicCount, groupByCategory, toPublic, minorToInput };
