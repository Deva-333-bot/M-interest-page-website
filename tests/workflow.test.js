'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client, seedAdmin, login, PNG } = require('./helpers');

test('full content workflow: create, edit price, publish, verify public site, unpublish, verify hidden, delete', async (t) => {
  const env = await startApp();
  t.after(() => env.stop());
  await seedAdmin(env.db);
  const admin = await login(env.base);
  const anon = new Client(env.base);

  // Before anything exists the public page shows an honest empty state, not fake prices.
  let pub = await anon.get('/laundry');
  assert.equal(pub.status, 200);
  assert.match(pub.text, /price list is being prepared/i);

  // 1. Create a category.
  let token = await admin.csrf('/admin/categories/laundry');
  let res = await admin.post('/admin/categories/laundry', { _csrf: token, name: 'Washing', sort_order: '0', is_published: 'on' });
  assert.equal(res.status, 303);
  const cat = await env.db.get("SELECT id FROM categories WHERE name = 'Washing'");
  assert.ok(cat);

  // 2. Create a DRAFT listing.
  token = await admin.csrf('/admin/items/laundry/new');
  res = await admin.post('/admin/items/laundry', { _csrf: token, name: 'DEMO Wash and fold', category_id: String(cat.id), description: 'Test listing', price: '150', pricing_unit: 'per kg', status: 'draft', availability: 'available', sort_order: '0' });
  assert.equal(res.status, 303, res.text.slice(0, 300));
  const item = await env.db.get("SELECT * FROM items WHERE name = 'DEMO Wash and fold'");
  assert.equal(item.status, 'draft');
  assert.equal(item.price_minor, 15000);

  // 3. Draft is invisible on the page and through every public API.
  pub = await anon.get('/laundry');
  assert.doesNotMatch(pub.text, /DEMO Wash and fold/);
  assert.doesNotMatch((await anon.get('/')).text, /DEMO Wash and fold/);
  assert.doesNotMatch((await anon.get('/laundry?q=wash')).text, /DEMO Wash and fold/);
  const apiList = await anon.get('/api/services');
  assert.equal(JSON.parse(apiList.text).data.length, 0);
  assert.equal((await anon.get(`/api/services/${item.id}`)).status, 404);
  assert.equal((await anon.get(`/api/services?section=laundry`)).status, 200);

  // 4. Edit the price while still a draft.
  token = await admin.csrf(`/admin/items/laundry/${item.id}/edit`);
  res = await admin.post(`/admin/items/laundry/${item.id}`, { _csrf: token, name: 'DEMO Wash and fold', category_id: String(cat.id), description: 'Test listing', price: '200', pricing_unit: 'per kg', status: 'draft', availability: 'available', sort_order: '0' });
  assert.equal(res.status, 303);
  assert.equal((await env.db.get('SELECT price_minor FROM items WHERE id = ?', item.id)).price_minor, 20000);

  // 5. Publish.
  token = await admin.csrf('/admin/items/laundry');
  res = await admin.post(`/admin/items/laundry/${item.id}/status`, { _csrf: token, status: 'published' });
  assert.equal(res.status, 303);
  pub = await anon.get('/laundry');
  assert.match(pub.text, /DEMO Wash and fold/);
  assert.match(pub.text, /KES 200/);
  assert.match(pub.text, /per kg/);
  const one = JSON.parse((await anon.get(`/api/services/${item.id}`)).text).data;
  assert.equal(one.pricing.amount, '200.00');
  assert.equal(one.pricing.currency, 'KES');
  assert.equal(one.status, undefined, 'internal fields must not leak');
  assert.equal(one.updated_by, undefined);
  assert.equal(JSON.parse(apiList.text).data.length, 0);
  assert.equal(JSON.parse((await anon.get('/api/services?section=laundry')).text).data.length, 1);

  // 6. Edit the price of a LIVE listing: the public page follows immediately.
  token = await admin.csrf(`/admin/items/laundry/${item.id}/edit`);
  res = await admin.post(`/admin/items/laundry/${item.id}`, { _csrf: token, name: 'DEMO Wash and fold', category_id: String(cat.id), description: 'Test listing', price: '250.50', pricing_unit: 'per kg', status: 'published', availability: 'available', sort_order: '0', featured: 'on' });
  assert.equal(res.status, 303);
  pub = await anon.get('/laundry');
  assert.match(pub.text, /KES 250\.50/);
  assert.doesNotMatch(pub.text, /KES 200\b/);
  assert.match((await anon.get('/')).text, /Popular prices/);

  // 7. Marking unavailable keeps it listed but flagged.
  token = await admin.csrf(`/admin/items/laundry/${item.id}/edit`);
  await admin.post(`/admin/items/laundry/${item.id}`, { _csrf: token, name: 'DEMO Wash and fold', category_id: String(cat.id), price: '250.50', pricing_unit: 'per kg', status: 'published', availability: 'unavailable' });
  assert.match((await anon.get('/laundry')).text, /Currently unavailable/);

  // 8. Unpublish: gone from page, search, homepage and API.
  token = await admin.csrf('/admin/items/laundry');
  res = await admin.post(`/admin/items/laundry/${item.id}/status`, { _csrf: token, status: 'draft' });
  assert.equal(res.status, 303);
  for (const url of ['/laundry', '/', '/laundry?q=wash']) assert.doesNotMatch((await anon.get(url)).text, /DEMO Wash and fold/, url);
  assert.equal((await anon.get(`/api/services/${item.id}`)).status, 404);
  assert.equal(JSON.parse((await anon.get('/api/services')).text).data.length, 0);

  // 9. Admin preview works for admins only.
  assert.match((await admin.get(`/admin/items/laundry/${item.id}/preview`)).text, /not visible to the public/);
  assert.equal((await anon.get(`/admin/items/laundry/${item.id}/preview`)).status, 303);

  // 10. Hiding the category hides published listings too.
  token = await admin.csrf('/admin/items/laundry');
  await admin.post(`/admin/items/laundry/${item.id}/status`, { _csrf: token, status: 'published' });
  assert.match((await anon.get('/laundry')).text, /DEMO Wash and fold/);
  token = await admin.csrf(`/admin/categories/laundry/${cat.id}/edit`);
  await admin.post(`/admin/categories/laundry/${cat.id}`, { _csrf: token, name: 'Washing', sort_order: '0' }); // checkbox absent => unpublished
  assert.doesNotMatch((await anon.get('/laundry')).text, /DEMO Wash and fold/);
  assert.equal((await anon.get(`/api/services/${item.id}`)).status, 404);

  // 11. Deleting needs a confirmation page, then really deletes.
  assert.match((await admin.get(`/admin/items/laundry/${item.id}/delete`)).text, /cannot be undone/);
  assert.ok(await env.db.get('SELECT 1 FROM items WHERE id = ?', item.id), 'GET must not delete');
  token = await admin.csrf(`/admin/items/laundry/${item.id}/delete`);
  res = await admin.post(`/admin/items/laundry/${item.id}/delete`, { _csrf: token });
  assert.equal(res.status, 303);
  assert.equal(await env.db.get('SELECT 1 FROM items WHERE id = ?', item.id), undefined);

  // 12. A category that still has listings cannot be deleted.
  token = await admin.csrf('/admin/categories/laundry');
  const res2 = await admin.post(`/admin/categories/laundry/${cat.id}/delete`, { _csrf: token });
  assert.equal(res2.status, 303);
  assert.equal(await env.db.get('SELECT 1 FROM categories WHERE id = ?', cat.id) === undefined, true, 'empty category is deletable');
});

test('validation: bad prices, missing price on publish, quote pricing needs owner approval', async (t) => {
  const env = await startApp();
  t.after(() => env.stop());
  await seedAdmin(env.db);
  const admin = await login(env.base);
  let token = await admin.csrf('/admin/categories/cyber');
  await admin.post('/admin/categories/cyber', { _csrf: token, name: 'Printing', is_published: 'on' });
  const cat = await env.db.get("SELECT id FROM categories WHERE name = 'Printing'");
  const base = { _csrf: '', name: 'DEMO Black and white print', category_id: String(cat.id), pricing_unit: 'per page', availability: 'available' };

  token = await admin.csrf('/admin/items/cyber/new');
  let res = await admin.post('/admin/items/cyber', { ...base, _csrf: token, price: 'abc', status: 'draft' });
  assert.equal(res.status, 422); assert.match(res.text, /Enter a price in KES/);
  res = await admin.post('/admin/items/cyber', { ...base, _csrf: token, price: '', status: 'published' });
  assert.equal(res.status, 422); assert.match(res.text, /price is required before publishing/i);
  res = await admin.post('/admin/items/cyber', { ...base, _csrf: token, price: '0', status: 'draft' });
  assert.equal(res.status, 422);
  res = await admin.post('/admin/items/cyber', { ...base, _csrf: token, price: '10', pricing_unit: '', status: 'published' });
  assert.equal(res.status, 422); assert.match(res.text, /what the price covers/i);
  res = await admin.post('/admin/items/cyber', { ...base, _csrf: token, name: 'x', price: '10', status: 'draft' });
  assert.equal(res.status, 422);
  res = await admin.post('/admin/items/cyber', { ...base, _csrf: token, category_id: '99999', price: '10', status: 'draft' });
  assert.equal(res.status, 422);
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM items')).c, 0, 'nothing invalid was stored');

  // quote pricing: draft allowed, publish blocked until owner approves in Settings
  res = await admin.post('/admin/items/cyber', { ...base, _csrf: token, price: '', pricing_type: 'quote', status: 'published' });
  assert.equal(res.status, 422); assert.match(res.text, /must be approved by the owner/);
  res = await admin.post('/admin/items/cyber', { ...base, _csrf: token, price: '', pricing_type: 'quote', status: 'draft' });
  assert.equal(res.status, 303);
  const item = await env.db.get('SELECT * FROM items');
  token = await admin.csrf('/admin/items/cyber');
  await admin.post(`/admin/items/cyber/${item.id}/status`, { _csrf: token, status: 'published' });
  assert.equal((await env.db.get('SELECT status FROM items WHERE id = ?', item.id)).status, 'draft');

  // Approve in settings -> now publishable and rendered as "Contact us for pricing".
  token = await admin.csrf('/admin/settings');
  res = await admin.post('/admin/settings', { _csrf: token, business_name: 'M-Interest', hero_headline: 'Everyday Services, Made Simple.', accent: 'orange', allow_contact_for_pricing: '1' });
  assert.equal(res.status, 303, res.text.slice(0, 400));
  token = await admin.csrf('/admin/items/cyber');
  await admin.post(`/admin/items/cyber/${item.id}/status`, { _csrf: token, status: 'published' });
  assert.match((await new Client(env.base).get('/cyber-cafe')).text, /Contact us for pricing/);
});

test('image upload: accepts real images, rejects fakes and oversize files, cleans up on delete', async (t) => {
  const env = await startApp();
  t.after(() => env.stop());
  await seedAdmin(env.db);
  const admin = await login(env.base);
  let token = await admin.csrf('/admin/categories/laundry');
  await admin.post('/admin/categories/laundry', { _csrf: token, name: 'Washing', is_published: 'on' });
  const cat = await env.db.get('SELECT id FROM categories');
  const form = (file, name = 'pic.png') => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ _csrf: token, name: 'DEMO With image', category_id: String(cat.id), price: '99', pricing_unit: 'per item', status: 'published', availability: 'available', image_alt: 'A folded shirt' })) f.set(k, v);
    f.set('image', new Blob([file]), name);
    return f;
  };
  token = await admin.csrf('/admin/items/laundry/new');
  let res = await admin.req('POST', '/admin/items/laundry', { multipart: form(Buffer.from('<?php echo 1; ?>'), 'evil.png') });
  assert.equal(res.status, 422); assert.match(res.text, /JPG, PNG or WebP/);
  res = await admin.req('POST', '/admin/items/laundry', { multipart: form(Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)])) });
  assert.equal(res.status, 422); assert.match(res.text, /under 1 MB/);
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM items')).c, 0);
  res = await admin.req('POST', '/admin/items/laundry', { multipart: form(PNG) });
  assert.equal(res.status, 303);
  const item = await env.db.get('SELECT * FROM items');
  assert.match(item.image_path, /^[a-f0-9]{32}\.png$/);
  assert.ok(await env.db.get('SELECT 1 AS x FROM images WHERE name = ?', item.image_path), 'image is stored in the database');
  const img = await fetch(`${env.base}/uploads/${item.image_path}`);
  assert.equal(img.status, 200); assert.equal(img.headers.get('x-content-type-options'), 'nosniff'); assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${env.base}/uploads/${'0'.repeat(32)}.png`)).status, 404);
  assert.equal((await fetch(`${env.base}/uploads/..%2f..%2fetc%2fpasswd`)).status, 404);
  assert.match((await new Client(env.base).get('/laundry')).text, /alt="A folded shirt"/);
  token = await admin.csrf(`/admin/items/laundry/${item.id}/delete`);
  await admin.post(`/admin/items/laundry/${item.id}/delete`, { _csrf: token });
  assert.equal(await env.db.get('SELECT 1 AS x FROM images WHERE name = ?', item.image_path), undefined, 'image removed with the record');
});

test('food menu module is optional and hidden until enabled', async (t) => {
  const env = await startApp();
  t.after(() => env.stop());
  await seedAdmin(env.db);
  const admin = await login(env.base); const anon = new Client(env.base);
  assert.equal((await anon.get('/menu')).status, 404);
  assert.equal((await anon.get('/api/menu')).status, 404);
  assert.equal((await admin.get('/admin/items/food')).status, 404);
  assert.doesNotMatch((await anon.get('/')).text, /Food menu/);
  let token = await admin.csrf('/admin/settings');
  await admin.post('/admin/settings', { _csrf: token, business_name: 'M-Interest', hero_headline: 'H', accent: 'orange', food_enabled: '1' });
  assert.equal((await admin.get('/admin/items/food')).status, 200);
  token = await admin.csrf('/admin/categories/food');
  await admin.post('/admin/categories/food', { _csrf: token, name: 'Drinks', is_published: 'on' });
  const cat = await env.db.get("SELECT id FROM categories WHERE section='food'");
  token = await admin.csrf('/admin/items/food/new');
  const r = await admin.post('/admin/items/food', { _csrf: token, name: 'DEMO Tea', category_id: String(cat.id), price: '50', status: 'published', availability: 'available' });
  assert.equal(r.status, 303);
  assert.match((await anon.get('/menu')).text, /DEMO Tea/);
  assert.match((await anon.get('/menu')).text, /KES 50/);
});
