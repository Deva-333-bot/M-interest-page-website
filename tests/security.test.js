'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, Client, seedAdmin, login, PASSWORD, contactToken } = require('./helpers');
const users = require('../src/models/users');

test('unauthenticated visitors cannot read or change anything in /admin', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  const owner = await seedAdmin(env.db);
  const anon = new Client(env.base);
  await env.db.run("INSERT INTO categories (section, name, slug) VALUES ('laundry','Washing','washing')");
  const getUrls = ['/admin', '/admin/items/laundry', '/admin/items/laundry/new', '/admin/items/cyber', '/admin/categories/laundry', '/admin/enquiries', '/admin/enquiries/1', '/admin/settings', '/admin/account', '/admin/items/laundry/1/preview', '/admin/items/laundry/1/delete'];
  for (const u of getUrls) { const r = await anon.get(u); assert.equal(r.status, 303, u); assert.equal(r.location, '/admin/login', u); assert.doesNotMatch(r.text, /Washing/, u); }
  const postUrls = ['/admin/items/laundry', '/admin/items/laundry/1', '/admin/items/laundry/1/status', '/admin/items/laundry/1/delete', '/admin/categories/laundry', '/admin/categories/laundry/1/delete', '/admin/enquiries/1', '/admin/enquiries/1/delete', '/admin/settings', '/admin/account', '/admin/logout'];
  for (const u of postUrls) { const r = await anon.post(u, { name: 'x', status: 'published' }); assert.equal(r.status, 401, u); }
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM items')).c, 0);
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM categories')).c, 1);
  assert.equal(owner.role, 'owner');
});

test('there is no public registration route', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  await seedAdmin(env.db);
  const admin = await login(env.base);
  for (const u of ['/admin/register', '/admin/signup', '/admin/users', '/admin/users/new']) {
    assert.equal((await admin.get(u)).status, 404, u);
    assert.equal((await admin.post(u, { email: 'evil@example.test', password: PASSWORD })).status, 404, u);
  }
  assert.equal((await users.countAdmins(env.db)), 1);
});

test('first-run setup: disabled without token, token-gated, one-time, no default credentials', async (t) => {
  let env = await startApp(); // no SETUP_TOKEN
  assert.equal((await users.countAdmins(env.db)), 0, 'no default account exists');
  assert.equal((await new Client(env.base).get('/admin/setup')).status, 404);
  assert.equal((await new Client(env.base).post('/admin/setup', { setup_token: 'x' })).status, 404);
  await env.stop();

  env = await startApp({ setupToken: 'a-very-long-random-setup-token-123456' });
  t.after(() => env.stop());
  const c = new Client(env.base);
  const form = async () => /name="_t" value="([^"]+)"/.exec((await c.get('/admin/setup')).text)[1];
  assert.equal((await c.get('/admin/setup')).status, 200);
  let res = await c.post('/admin/setup', { _t: await form(), setup_token: 'wrong', email: 'owner@example.test', password: PASSWORD, password2: PASSWORD });
  assert.equal(res.status, 403); assert.equal((await users.countAdmins(env.db)), 0);
  res = await c.post('/admin/setup', { _t: await form(), setup_token: 'a-very-long-random-setup-token-123456', email: 'owner@example.test', password: 'short', password2: 'short' });
  assert.equal(res.status, 422); assert.equal((await users.countAdmins(env.db)), 0);
  res = await c.post('/admin/setup', { _t: await form(), setup_token: 'a-very-long-random-setup-token-123456', email: 'owner@example.test', password: PASSWORD, password2: PASSWORD });
  assert.equal(res.status, 303); assert.equal((await users.countAdmins(env.db)), 1);
  const row = await env.db.get('SELECT * FROM admin_users');
  assert.equal(row.role, 'owner'); assert.match(row.password_hash, /^scrypt\$/); assert.ok(!row.password_hash.includes(PASSWORD));
  assert.equal((await c.get('/admin/setup')).status, 404, 'setup closes once an admin exists');
});

test('a too-short SETUP_TOKEN keeps /admin/setup disabled', async (t) => {
  const env = await startApp({ setupToken: 'short' }); t.after(() => env.stop());
  assert.equal((await new Client(env.base).get('/admin/setup')).status, 404);
});

test('sign-in: generic errors, lockout after repeated failures, rate limiting, cookie flags', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  await seedAdmin(env.db);
  const attempt = async (email, password) => {
    const c = new Client(env.base);
    const tk = /name="_t" value="([^"]+)"/.exec((await c.get('/admin/login')).text)[1];
    return c.post('/admin/login', { _t: tk, email, password });
  };
  const wrongUser = await attempt('nobody@example.test', 'whatever-password-1');
  const wrongPass = await attempt('owner@example.test', 'whatever-password-1');
  assert.equal(wrongUser.status, 401); assert.equal(wrongPass.status, 401);
  assert.match(wrongUser.text, /Incorrect e-mail or password/); assert.match(wrongPass.text, /Incorrect e-mail or password/);
  for (let i = 0; i < 4; i++) await attempt('owner@example.test', 'whatever-password-1');
  const locked = await attempt('owner@example.test', PASSWORD);
  assert.equal(locked.status, 401, 'correct password is refused while locked');
  await env.db.run('UPDATE admin_users SET locked_until = NULL, failed_attempts = 0');
  env.limiter.reset();
  const ok = new Client(env.base);
  const tk = /name="_t" value="([^"]+)"/.exec((await ok.get('/admin/login')).text)[1];
  const res = await fetch(env.base + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _t: tk, email: 'OWNER@example.test', password: PASSWORD }) });
  assert.equal(res.status, 303);
  const cookie = res.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
  env.limiter.reset();
  let last;
  for (let i = 0; i < 11; i++) last = await attempt('x@example.test', 'abcdefghijklm');
  assert.equal(last.status, 429);
});

test('CSRF: state-changing admin requests without the session token are rejected', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  await seedAdmin(env.db);
  const admin = await login(env.base);
  let res = await admin.post('/admin/categories/laundry', { name: 'Sneaky' });
  assert.equal(res.status, 403);
  res = await admin.post('/admin/categories/laundry', { _csrf: 'forged', name: 'Sneaky' });
  assert.equal(res.status, 403);
  assert.equal((await env.db.get('SELECT COUNT(*) c FROM categories')).c, 0);
  res = await admin.post('/admin/logout', {});
  assert.equal(res.status, 403);
  assert.match((await admin.get('/admin')).text, /Dashboard/, 'still signed in');
});

test('sessions: sign-out invalidates the cookie; password change signs out other devices', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  await seedAdmin(env.db);
  const a = await login(env.base); const b = await login(env.base);
  const stale = a.cookie;
  const token = await a.csrf('/admin/account');
  const NEW = 'An-Entirely-New-Passphrase-42';
  let res = await a.post('/admin/account', { _csrf: token, current: 'wrong-current-password', password: NEW, password2: NEW });
  assert.equal(res.status, 422);
  res = await a.post('/admin/account', { _csrf: token, current: PASSWORD, password: NEW, password2: NEW });
  assert.equal(res.status, 303);
  assert.equal((await b.get('/admin')).status, 303, 'other session was revoked');
  assert.equal((await a.get('/admin')).status, 200);
  res = await a.post('/admin/logout', { _csrf: await a.csrf('/admin') });
  assert.equal(res.status, 303);
  const replay = new Client(env.base); replay.cookie = stale;
  assert.equal((await replay.get('/admin')).status, 303);
  await login(env.base, 'owner@example.test', NEW);
});

test('roles: staff manage content and enquiries but not settings', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  await seedAdmin(env.db);
  await seedAdmin(env.db, { email: 'staff@example.test', role: 'staff' });
  const staff = await login(env.base, 'staff@example.test');
  assert.equal((await staff.get('/admin/items/laundry')).status, 200);
  assert.equal((await staff.get('/admin/enquiries')).status, 200);
  assert.equal((await staff.get('/admin/settings')).status, 403);
  const token = await staff.csrf('/admin');
  assert.equal((await staff.post('/admin/settings', { _csrf: token, business_name: 'Hacked', hero_headline: 'x', accent: 'orange' })).status, 403);
  assert.equal((await env.db.get("SELECT COUNT(*) c FROM settings WHERE key='business_name'")).c, 0);
  assert.doesNotMatch((await staff.get('/admin')).text, /href="\/admin\/settings"/);
});

test('XSS: hostile text is escaped on public pages and in the dashboard', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  await seedAdmin(env.db);
  const admin = await login(env.base); const anon = new Client(env.base);
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  let token = await admin.csrf('/admin/categories/laundry');
  await admin.post('/admin/categories/laundry', { _csrf: token, name: 'Cat', is_published: 'on' });
  const cat = await env.db.get('SELECT id FROM categories');
  token = await admin.csrf('/admin/items/laundry/new');
  await admin.post('/admin/items/laundry', { _csrf: token, name: evil, category_id: String(cat.id), description: evil, price: '10', pricing_unit: 'per kg', status: 'published' });
  for (const [c, url] of [[anon, '/laundry'], [anon, '/'], [admin, '/admin/items/laundry'], [admin, '/admin']]) {
    const body = (await c.get(url)).text;
    assert.doesNotMatch(body, /<script>alert\(1\)/, url); assert.doesNotMatch(body, /<img src=x/, url);
  }
  assert.match((await anon.get('/laundry')).text, /&lt;script&gt;alert\(1\)/);
  const sd = await anon.post('/contact', { _t: await contactToken(anon), name: evil, contact_method: 'email', contact_value: 'a@b.co', category: 'other', message: evil + ' long enough' });
  assert.equal(sd.status, 303);
  const e = await env.db.get('SELECT id FROM enquiries');
  const view = (await admin.get(`/admin/enquiries/${e.id}`)).text;
  assert.doesNotMatch(view, /<script>alert\(1\)/); assert.match(view, /&lt;script&gt;/);
});

test('SQL injection strings are treated as data', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  const anon = new Client(env.base);
  for (const q of ["' OR 1=1 --", "%' ; DROP TABLE items; --", '\\']) {
    assert.equal((await anon.get('/laundry?q=' + encodeURIComponent(q))).status, 200);
  }
  assert.equal((await anon.get('/api/services/1%20OR%201=1')).status, 404);
  assert.equal((await env.db.get("SELECT COUNT(*) c FROM information_schema.tables WHERE table_name='items'")).c, 1);
});

test('security headers and cache rules', async (t) => {
  const env = await startApp(); t.after(() => env.stop());
  const r = await fetch(env.base + '/');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
  const a = await fetch(env.base + '/admin/login');
  assert.equal(a.headers.get('cache-control'), 'no-store'); assert.match(a.headers.get('x-robots-tag'), /noindex/);
  assert.match(await (await fetch(env.base + '/robots.txt')).text(), /Disallow: \/admin/);
});

test('production config refuses to start without secrets', () => {
  const { loadConfig } = require('../src/config');
  assert.throws(() => loadConfig({ NODE_ENV: 'production', SITE_URL: 'https://x.test' }), /SESSION_SECRET/);
  const ok = { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/db', SITE_URL: 'https://x.test', SESSION_SECRET: 'x'.repeat(40) };
  assert.throws(() => loadConfig({ ...ok, SESSION_SECRET: 'short' }), /32/);
  assert.throws(() => loadConfig({ ...ok, SITE_URL: 'http://x.test' }), /https/);
  assert.throws(() => loadConfig({ ...ok, DATABASE_URL: '' }), /DATABASE_URL/);
  assert.doesNotThrow(() => loadConfig(ok));
});
