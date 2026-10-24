'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client, seedAdmin, login, contactToken } = require('./helpers');

const good = { name: 'Test Customer', contact_method: 'phone', contact_value: '0712 345 678', category: 'laundry', message: 'Do you wash duvets? Please advise on the price.' };

test('contact form: validation, success, storage, dedupe, honeypot', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  const c = new Client(env.base);
  let res = await c.post('/contact', { _t: await contactToken(c), name: '', contact_method: 'email', contact_value: 'nope', category: '', message: 'short' });
  assert.equal(res.status, 422);
  for (const msg of [/Please enter your name/, /valid e-mail/, /what your enquiry is about/, /at least 10 characters/]) assert.match(res.text, msg);
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM enquiries')).c, 0);

  res = await c.post('/contact', { _t: await contactToken(c), ...good, contact_value: '12345' });
  assert.equal(res.status, 422); assert.match(res.text, /valid phone number/);
  assert.match(res.text, /Do you wash duvets/, 'the typed message is kept on error');

  env.limiter.reset();
  res = await c.post('/contact', { _t: await contactToken(c), ...good });
  assert.equal(res.status, 303); assert.match(res.location, /^\/contact\/thanks\?ref=MI-[A-Z2-9]{8}$/);
  const row = await env.db.get('SELECT * FROM enquiries');
  assert.equal(row.contact_value, '+254712345678'); assert.equal(row.status, 'new'); assert.match(row.created_at, /Z$/);
  assert.match((await c.get(res.location)).text, new RegExp(row.ref));

  res = await c.post('/contact', { _t: await contactToken(c), ...good });
  assert.equal(res.location.split('=')[1], row.ref, 'repeat submission returns the same reference');
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM enquiries')).c, 1);

  res = await c.post('/contact', { _t: await contactToken(c), ...good, name: 'Bot', website: 'http://spam.example' });
  assert.equal(res.status, 303); assert.equal((await env.db.get('SELECT COUNT(*) c FROM enquiries')).c, 1, 'honeypot stores nothing');

  res = await c.post('/contact', { ...good, name: 'No Token' });
  assert.equal(res.status, 422); assert.match(res.text, /expired/); assert.match(res.text, /No Token/);
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM enquiries')).c, 1);
});

test('contact form: size limits and rate limiting', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  const c = new Client(env.base);
  let res = await c.post('/contact', { _t: await contactToken(c), ...good, message: 'x'.repeat(1001) });
  assert.equal(res.status, 422); assert.match(res.text, /under 1000/);
  res = await c.post('/contact', { _t: await contactToken(c), ...good, message: 'y'.repeat(40 * 1024) });
  assert.equal(res.status, 413);
  env.limiter.reset();
  let last;
  for (let i = 0; i < 11; i++) last = await c.post('/contact', { _t: await contactToken(c), ...good, message: `Distinct enquiry number ${i} for rate test` });
  assert.equal(last.status, 429); assert.ok(last.headers.get('retry-after'));
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM enquiries')).c, 10);
});

test('enquiries are private and manageable by admins', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  await seedAdmin(env.db);
  const c = new Client(env.base);
  await c.post('/contact', { _t: await contactToken(c), ...good });
  const e = await env.db.get('SELECT * FROM enquiries');
  for (const u of ['/api/enquiries', '/api/enquiries/1', '/enquiries', '/admin/enquiries']) { const r = await c.get(u); assert.notEqual(r.status, 200, u); assert.doesNotMatch(r.text, /Test Customer|254712345678/, u); }
  for (const u of ['/', '/laundry', '/sitemap.xml', '/api/services']) assert.doesNotMatch((await c.get(u)).text, /Test Customer/);
  const admin = await login(env.base);
  assert.match((await admin.get('/admin/enquiries')).text, new RegExp(e.ref));
  assert.match((await admin.get('/admin/enquiries?q=duvets')).text, new RegExp(e.ref));
  assert.doesNotMatch((await admin.get('/admin/enquiries?q=zzzz')).text, new RegExp(e.ref));
  assert.match((await admin.get('/admin')).text, /New enquiries/);
  let token = await admin.csrf(`/admin/enquiries/${e.id}`);
  let res = await admin.post(`/admin/enquiries/${e.id}`, { _csrf: token, status: 'in_progress', notes: 'Called back' });
  assert.equal(res.status, 303);
  let row = await env.db.get('SELECT * FROM enquiries');
  assert.equal(row.status, 'in_progress'); assert.equal(row.internal_notes, 'Called back');
  await admin.post(`/admin/enquiries/${e.id}`, { _csrf: token, status: 'bogus', notes: '' });
  assert.equal((await env.db.get('SELECT status FROM enquiries')).status, 'in_progress');
  await admin.post(`/admin/enquiries/${e.id}`, { _csrf: token, status: 'archived', notes: '' });
  assert.doesNotMatch((await admin.get('/admin/enquiries')).text, new RegExp(e.ref), 'archived hidden from the default list');
  assert.match((await admin.get('/admin/enquiries?status=archived')).text, new RegExp(e.ref));
  assert.match((await admin.get(`/admin/enquiries/${e.id}/delete`)).text, /cannot be undone/);
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM enquiries')).c, 1);
  await admin.post(`/admin/enquiries/${e.id}/delete`, { _csrf: token });
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM enquiries')).c, 0);
});

test('fresh site publishes no placeholders or invented business facts', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  const c = new Client(env.base);
  for (const u of ['/', '/about', '/laundry', '/cyber-cafe', '/contact', '/privacy']) {
    const body = (await c.get(u)).text;
    assert.doesNotMatch(body, /\[[A-Z][A-Z /,'-]+\]/, `${u} shows a [PLACEHOLDER]`);
    assert.doesNotMatch(body, /wa\.me|href="tel:|application\/ld\+json|mailto:/, `${u} exposes unset contact data`);
    assert.doesNotMatch(body, /guarantee|same-day|24 hours|lowest price|since 20\d\d|years of experience/i, `${u} makes an unverified claim`);
  }
  assert.match((await c.get('/privacy')).text, /awaiting owner review/);
  assert.equal((await c.get('/menu')).status, 404);
  assert.doesNotMatch(await (await fetch(env.base + '/sitemap.xml')).text(), /\/menu/);
});

test('settings drive the public site: WhatsApp links, contact details, hours, structured data', async (t) => {
  const env = await startApp({ siteUrl: 'https://www.example.test' }); t.after(() => env.stop());
  await seedAdmin(env.db);
  const admin = await login(env.base); const anon = new Client(env.base);
  let token = await admin.csrf('/admin/settings');
  const base = { _csrf: token, business_name: 'M-Interest', hero_headline: 'Clean clothes, quick browsing', accent: 'orange' };
  let res = await admin.post('/admin/settings', { ...base, whatsapp_number: '12', address: 'x' });
  assert.equal(res.status, 422); assert.match(res.text, /valid phone number/);
  res = await admin.post('/admin/settings', { ...base, map_url: 'http://insecure.example' });
  assert.equal(res.status, 422); assert.match(res.text, /https/);
  res = await admin.post('/admin/settings', { ...base, hero_headline: '' });
  assert.equal(res.status, 422);
  res = await admin.post('/admin/settings', { ...base, whatsapp_number: '0712 345 678', phone_number: '+254 733 000 111', email: 'hello@example.test', address: 'TEST ADDRESS 1', area: 'TEST AREA', opening_hours: 'Mon-Fri: 8-6\nSat: 9-2', map_url: 'https://maps.example.test/x', retention_months: '12', privacy_reviewed: '1' });
  assert.equal(res.status, 303);
  assert.equal((await env.db.get("SELECT value FROM settings WHERE key='whatsapp_number'")).value, '+254712345678');

  token = await admin.csrf('/admin/categories/laundry');
  await admin.post('/admin/categories/laundry', { _csrf: token, name: 'Washing', is_published: 'on' });
  const cat = await env.db.get('SELECT id FROM categories');
  token = await admin.csrf('/admin/items/laundry/new');
  await admin.post('/admin/items/laundry', { _csrf: token, name: 'DEMO Duvet wash', category_id: String(cat.id), price: '800', pricing_unit: 'per item', status: 'published' });
  const item = await env.db.get('SELECT id FROM items');

  const page = (await anon.get('/laundry')).text;
  const expected = 'https://wa.me/254712345678?text=' + encodeURIComponent('Hello M-Interest, I would like to enquire about DEMO Duvet wash. Could you please share more information?');
  assert.ok(page.includes(`href="${expected}"`), 'service WhatsApp link has the right recipient and encoded message');
  assert.match(page, /target="_blank" rel="noopener noreferrer"/);
  assert.match(page, /tel:\+254733000111/);
  const home = (await anon.get('/')).text;
  assert.match(home, /Clean clothes, quick browsing/); assert.match(home, /TEST ADDRESS 1/); assert.match(home, /Mon-Fri: 8-6/); assert.match(home, /Get directions/);
  const ld = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(home);
  const data = JSON.parse(ld[1].replace(/\\u003c/g, '<'));
  assert.equal(data['@type'], 'LocalBusiness'); assert.equal(data.address.streetAddress, 'TEST ADDRESS 1'); assert.equal(data.telephone, '+254733000111');
  assert.equal(data.aggregateRating, undefined); assert.equal(data.geo, undefined); assert.equal(data.openingHours, undefined);
  assert.match(home, /<link rel="canonical" href="https:\/\/www\.example\.test\/">/);
  assert.doesNotMatch((await anon.get('/privacy')).text, /awaiting owner review/);
  assert.match((await anon.get('/privacy')).text, /up to 12 months/);

  const form = (await anon.get(`/contact?service=${item.id}`)).text;
  assert.match(form, /enquire about DEMO Duvet wash/); assert.match(form, /<option value="laundry" selected>/);
  assert.match(await (await fetch(env.base + '/sitemap.xml')).text(), /<loc>https:\/\/www\.example\.test\/laundry<\/loc>/);
  assert.match(await (await fetch(env.base + '/robots.txt')).text(), /Sitemap: https:\/\/www\.example\.test\/sitemap\.xml/);
  assert.match((await anon.get('/laundry?q=duvet')).text, /noindex/);
});

test('searching and filtering lists in the dashboard', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  await seedAdmin(env.db);
  const admin = await login(env.base);
  let token = await admin.csrf('/admin/categories/cyber');
  await admin.post('/admin/categories/cyber', { _csrf: token, name: 'Printing', is_published: 'on' });
  const cat = await env.db.get('SELECT id FROM categories');
  token = await admin.csrf('/admin/items/cyber/new');
  for (const [name, status] of [['DEMO Print A4', 'published'], ['DEMO Scan page', 'draft']]) await admin.post('/admin/items/cyber', { _csrf: token, name, category_id: String(cat.id), price: '20', pricing_unit: 'per page', status });
  await admin.get('/admin'); // consume flash messages
  let list = (await admin.get('/admin/items/cyber?q=scan')).text;
  assert.match(list, /DEMO Scan page/); assert.doesNotMatch(list, /DEMO Print A4/);
  list = (await admin.get('/admin/items/cyber?status=published')).text;
  assert.match(list, /DEMO Print A4/); assert.doesNotMatch(list, /DEMO Scan page/);
  list = (await admin.get(`/admin/items/cyber?category=${cat.id}`)).text;
  assert.match(list, /DEMO Print A4/); assert.match(list, /DEMO Scan page/);
});
