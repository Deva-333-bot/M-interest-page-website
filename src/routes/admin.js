'use strict';
const express = require('express');
const multer = require('multer');
const catalog = require('../models/catalog');
const enquiries = require('../models/enquiries');
const settingsModel = require('../models/settings');
const users = require('../models/users');
const { audit, recent } = require('../models/audit');
const a = require('../views/admin');
const pub = require('../views/public');
const { hashPassword, verifyPassword, burnPasswordCheck, passwordProblem, safeEqual, formToken, checkFormToken } = require('../security');
const { saveImage, removeImage, detectImage } = require('../uploads');
const { qs, clean, html, SECTIONS } = require('../util');
const { nowIso } = require('../db');

module.exports = function adminRoutes(app, { cfg, db, sessions, limiter }) {
  const r = express.Router();
  const mem = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxImageBytes, files: 1, fields: 40, fieldSize: 10 * 1024, parts: 50 } });
  const withUpload = (field) => async (req, res, next) => mem.single(field)(req, res, (err) => {
    if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? `Images must be under ${cfg.maxImageBytes / 1024 / 1024} MB.` : 'The upload could not be processed.';
    req.body = req.body || {};
    next();
  });

  // Everything under /admin: never cached, never indexed, session loaded.
  r.use(async (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    req.auth = await sessions.load(req);
    next();
  });

  const render = async (req, res, { title, body, active, status = 200 }) => {
    const flash = req.auth ? await sessions.takeFlash(req.auth.hash) : [];
    res.status(status).type('html').send(a.layout({ title, body, active, user: req.auth?.user, s: req.settings, csrf: req.auth?.csrf, flash, newEnquiries: req.auth ? await enquiries.countNew(db) : 0 }).toString());
  };
  const flash = async (req, type, text) => await sessions.addFlash(req.auth.hash, type, text);

  const requireAuth = async (req, res, next) => {
    if (req.auth) return next();
    if (req.method === 'GET') return res.redirect(303, '/admin/login');
    return res.status(401).type('text').send('Sign in required.');
  };
  const requireOwner = async (req, res, next) => {
    if (req.auth.user.role === 'owner') return next();
    return await render(req, res, { title: 'Not allowed', status: 403, body: html`<p>Only the owner can change this. Ask the owner if you need access.</p>` });
  };
  const csrf = async (req, res, next) => {
    if (req.uploadError && !req.body._csrf) return res.status(400).type('text').send('Upload failed.');
    if (safeEqual(String(req.body._csrf || ''), req.auth.csrf)) return next();
    return res.status(403).type('text').send('Invalid or missing security token. Go back, reload the page and try again.');
  };
  const protectedPost = [requireAuth, csrf];
  const id = (req) => (/^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : 0);
  const notFound = async (req, res) => render(req, res, { title: 'Not found', status: 404, body: html`<p>That record does not exist.</p><p><a href="/admin">Back to the dashboard</a></p>` });

  const sectionGuard = async (req, res, next) => {
    if (!req.auth) return req.method === 'GET' ? res.redirect(303, '/admin/login') : res.status(401).type('text').send('Sign in required.');
    const val = req.params.section;
    if (!catalog.isSection(val) || (val === 'food' && !req.settings.food_enabled)) return notFound(req, res);
    next();
  };
  r.use('/items/:section', sectionGuard);
  r.use('/categories/:section', sectionGuard);

  // ------------------------------------------------------------------ auth
  const setupEnabled = async () => cfg.setupToken.length >= 24 && (await users.countAdmins(db)) === 0;
  r.get('/login', async (req, res) => {
    if (req.auth) return res.redirect(303, '/admin');
    await render(req, res, { title: 'Sign in', body: a.loginPage({ token: formToken(cfg.sessionSecret, Date.now() - 5000) }) });
  });
  r.post('/login', async (req, res) => {
    const fail = (status, msg) => render(req, res, { title: 'Sign in', status, body: a.loginPage({ error: msg, token: formToken(cfg.sessionSecret, Date.now() - 5000) }) });
    const rl = limiter.hit(`login:${req.ip}`, 10, 15 * 60 * 1000);
    if (!rl.ok) { res.set('Retry-After', String(rl.retryAfter)); return fail(429, 'Too many sign-in attempts. Please wait a few minutes and try again.'); }
    if (checkFormToken(cfg.sessionSecret, req.body._t, { minSeconds: 0 }) !== 'ok') return fail(400, 'This form has expired. Please try again.');
    const password = String(req.body.password || '').slice(0, 200);
    const user = await users.findByEmail(db, clean(req.body.email, 254));
    const locked = user?.locked_until && Date.parse(user.locked_until) > Date.now();
    let ok = false;
    if (user && !locked) ok = await verifyPassword(password, user.password_hash); else await burnPasswordCheck(password);
    if (!ok || !user.active) {
      if (user && !locked) {
        const attempts = user.failed_attempts + 1;
        await db.run('UPDATE admin_users SET failed_attempts = ?, locked_until = ? WHERE id = ?', attempts >= 5 ? 0 : attempts, attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null, user.id);
        await audit(db, null, 'sign-in failed', 'admin_user', user.id, attempts >= 5 ? 'account locked for 15 minutes' : '');
      }
      return fail(401, 'Incorrect e-mail or password, or the account is temporarily locked.');
    }
    await db.run('UPDATE admin_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', user.id);
    const token = await sessions.create(user.id);
    res.set('Set-Cookie', sessions.cookie(token, cfg.sessionMaxMs));
    await audit(db, user, 'signed in', 'admin_user', user.id);
    res.redirect(303, '/admin');
  });
  r.post('/logout', requireAuth, csrf, async (req, res) => {
    await sessions.destroyHash(req.auth.hash);
    res.set('Set-Cookie', sessions.cookie('', 0));
    res.redirect(303, '/admin/login');
  });

  // First-run owner creation. Only exists while NO administrator exists AND a long SETUP_TOKEN is configured.
  r.get('/setup', async (req, res) => {
    if (!(await setupEnabled())) return await notFound(req, res);
    await render(req, res, { title: 'Create owner account', body: a.setupPage({ token: formToken(cfg.sessionSecret, Date.now() - 5000) }) });
  });
  r.post('/setup', async (req, res) => {
    if (!(await setupEnabled())) return await notFound(req, res);
    const again = (status, extra) => render(req, res, { title: 'Create owner account', status, body: a.setupPage({ values: { email: clean(req.body.email, 254) }, token: formToken(cfg.sessionSecret, Date.now() - 5000), ...extra }) });
    const rl = limiter.hit(`setup:${req.ip}`, 5, 15 * 60 * 1000);
    if (!rl.ok) return again(429, { error: 'Too many attempts. Wait a few minutes.' });
    if (checkFormToken(cfg.sessionSecret, req.body._t, { minSeconds: 0 }) !== 'ok') return again(400, { error: 'This form has expired. Please try again.' });
    if (!safeEqual(String(req.body.setup_token || ''), cfg.setupToken)) return again(403, { errors: { setup_token: 'The setup token is not correct.' } });
    const email = clean(req.body.email, 254); const pw = String(req.body.password || '');
    if (pw !== String(req.body.password2 || '')) return again(422, { errors: { password2: 'The passwords do not match.' } });
    try {
      const user = await users.createAdmin(db, { email, password: pw, role: 'owner' });
      await audit(db, user, 'created owner account', 'admin_user', user.id, 'first-run setup');
      res.redirect(303, '/admin/login');
    } catch (e) { again(422, { errors: { password: e.message } }); }
  });

  // -------------------------------------------------------------- dashboard
  r.get('/', requireAuth, async (req, res) => {
    const s = req.settings;
    const secs = ['laundry', 'cyber', ...(s.food_enabled ? ['food'] : [])];
    const stats = await Promise.all(secs.map(async (k) => ({ href: `/admin/items/${k}`, label: SECTIONS[k].label,
      published: (await db.get("SELECT COUNT(*) c FROM items WHERE section=? AND status='published'", k)).c,
      drafts: (await db.get("SELECT COUNT(*) c FROM items WHERE section=? AND status='draft'", k)).c,
      unavailable: (await db.get("SELECT COUNT(*) c FROM items WHERE section=? AND availability='unavailable'", k)).c })));
    const recentItems = await db.all('SELECT i.*, c.is_published AS category_published FROM items i JOIN categories c ON c.id=i.category_id ORDER BY i.updated_at DESC LIMIT 5');
    const total = (await db.get('SELECT COUNT(*) c FROM enquiries')).c;
    await render(req, res, { title: 'Dashboard', active: 'dash', body: a.dashboardPage({ stats, recentItems, warnings: (await settingsModel.configWarnings(db, s)).map((w) => (req.auth.user.role === 'owner' ? w : { ...w, href: w.href.startsWith('/admin/settings') ? null : w.href })), activity: await recent(db, 8), enquiries: { newCount: await enquiries.countNew(db), total } }) });
  });

  // ---------------------------------------------------------------- listings
  const listPath = (s) => `/admin/items/${s}`;
  r.get('/items/:section', requireAuth, async (req, res) => {
    const section = req.params.section;
    const filters = { q: clean(qs(req.query.q), 60), category: /^\d+$/.test(qs(req.query.category)) ? Number(qs(req.query.category)) : 0, status: ['draft', 'published', 'unavailable'].includes(qs(req.query.status)) ? qs(req.query.status) : '' };
    const page = /^\d+$/.test(qs(req.query.page)) ? Math.max(1, Number(qs(req.query.page))) : 1;
    await render(req, res, { title: SECTIONS[section].label, active: section, body: a.itemsPage({ section, data: await catalog.adminList(db, section, { ...filters, page }), categories: await catalog.listCategories(db, section), filters, csrf: req.auth.csrf }) });
  });
  r.get('/items/:section/new', requireAuth, async (req, res) => {
    const section = req.params.section;
    await render(req, res, { title: `Add ${SECTIONS[section].singular}`, active: section, body: a.itemForm({ section, categories: await catalog.listCategories(db, section), csrf: req.auth.csrf, isNew: true, settings: req.settings }) });
  });

  async function saveItem(req, res, existing) {
    const section = req.params.section;
    const categories = await catalog.listCategories(db, section);
    const { errors, values } = catalog.validateItem(req.body, { section, categories, settings: req.settings });
    const file = req.file;
    let hasImage = existing?.image_path && req.body.remove_image !== '1';
    if (req.uploadError) errors.image = req.uploadError;
    else if (file) { if (file.size > cfg.maxImageBytes) errors.image = `Images must be under ${cfg.maxImageBytes / 1024 / 1024} MB.`; else if (!detectImage(file.buffer)) errors.image = 'Upload a JPG, PNG or WebP image.'; else hasImage = true; }
    if (hasImage && !values.image_alt && !errors.image_alt) errors.image_alt = 'Describe the image briefly for screen-reader users.';
    if (Object.keys(errors).length) {
      return await render(req, res, { title: existing ? `Edit ${existing.name}` : `Add ${SECTIONS[section].singular}`, active: section, status: 422,
        body: a.itemForm({ section, item: existing || {}, values: { ...req.body, ...values, price: clean(req.body.price, 20) }, errors, categories, csrf: req.auth.csrf, isNew: !existing, settings: req.settings }) });
    }
    let image_path = existing?.image_path || null;
    if (existing && (req.body.remove_image === '1' || file) && image_path) { await removeImage(db, image_path); image_path = null; }
    if (file) image_path = (await saveImage(db, cfg, file.buffer)).name;
    values.image_path = image_path;
    if (!image_path) values.image_alt = '';
    const uid = req.auth.user.id;
    if (existing) {
      await catalog.updateItem(db, existing.id, values, uid);
      const change = existing.status !== values.status ? (values.status === 'published' ? 'published' : 'unpublished') : 'updated';
      await audit(db, req.auth.user, change, section + ' listing', existing.id, values.name);
      await flash(req, 'success', `Saved “${values.name}”${change === 'published' ? ' and published it to the website' : change === 'unpublished' ? ' and removed it from the website' : ''}.`);
    } else {
      const newId = await catalog.createItem(db, section, values, uid);
      await audit(db, req.auth.user, values.status === 'published' ? 'created and published' : 'created', section + ' listing', newId, values.name);
      await flash(req, 'success', `Created “${values.name}”${values.status === 'published' ? ' and published it.' : ' as a draft.'}`);
    }
    res.redirect(303, listPath(section));
  }
  r.post('/items/:section', requireAuth, withUpload('image'), csrf, async (req, res) => await saveItem(req, res, null));
  const loadItem = async (req, res) => { const it = await catalog.getItem(db, id(req)); if (!it || it.section !== req.params.section) { await notFound(req, res); return null; } return it; };
  r.get('/items/:section/:id/edit', requireAuth, async (req, res) => {
    const it = await loadItem(req, res); if (!it) return;
    await render(req, res, { title: `Edit ${it.name}`, active: it.section, body: a.itemForm({ section: it.section, item: it, categories: await catalog.listCategories(db, it.section), csrf: req.auth.csrf, settings: req.settings }) });
  });
  r.post('/items/:section/:id', requireAuth, withUpload('image'), csrf, async (req, res) => { const it = await loadItem(req, res); if (it) await saveItem(req, res, it); });
  r.post('/items/:section/:id/status', ...protectedPost, async (req, res) => {
    const it = await loadItem(req, res); if (!it) return;
    const status = req.body.status === 'published' ? 'published' : 'draft';
    const result = await catalog.setStatus(db, it, status, req.settings, req.auth.user.id);
    if (!result.ok) await flash(req, 'error', `Could not publish “${it.name}”: ${result.reason}`);
    else { await audit(db, req.auth.user, status === 'published' ? 'published' : 'unpublished', it.section + ' listing', it.id, it.name); await flash(req, 'success', status === 'published' ? `“${it.name}” is now live on the website.` : `“${it.name}” has been removed from the website (saved as a draft).`); }
    res.redirect(303, listPath(it.section));
  });
  r.get('/items/:section/:id/preview', requireAuth, async (req, res) => {
    const it = await loadItem(req, res); if (!it) return;
    const live = it.status === 'published' && it.category_published;
    const body = html`<section class="page-head"><div class="wrap"><p class="alert alert-warn" role="note">Preview for administrators. This listing is <strong>${live ? 'live' : it.status === 'published' ? 'published but hidden because its category is unpublished' : 'a draft and not visible to the public'}</strong>. <a href="/admin/items/${it.section}/${it.id}/edit">Back to editing</a></p><h1>${SECTIONS[it.section].label}</h1></div></section><div class="wrap catalogue"><section class="cat"><h2>${it.category_name}</h2><ul class="entries">${pub.entry(it, req.settings, { preview: true })}</ul></section></div>`;
    res.status(200).type('html').send(pub.layout({ s: req.settings, cfg, title: `Preview: ${it.name}`, path: '/', noindex: true, description: '', body }).toString());
  });
  r.get('/items/:section/:id/delete', requireAuth, async (req, res) => {
    const it = await loadItem(req, res); if (!it) return;
    await render(req, res, { title: 'Delete listing', active: it.section, body: a.confirmPage({ question: `Delete “${it.name}”?`, detail: it.status === 'published' ? 'It is currently live and will disappear from the website. To hide it temporarily, unpublish it instead.' : '', action: `/admin/items/${it.section}/${it.id}/delete`, csrf: req.auth.csrf, back: listPath(it.section) }) });
  });
  r.post('/items/:section/:id/delete', ...protectedPost, async (req, res) => {
    const it = await loadItem(req, res); if (!it) return;
    await catalog.deleteItem(db, it.id); await removeImage(db, it.image_path);
    await audit(db, req.auth.user, 'deleted', it.section + ' listing', it.id, it.name);
    await flash(req, 'success', `Deleted “${it.name}”.`);
    res.redirect(303, listPath(it.section));
  });

  // -------------------------------------------------------------- categories
  r.get('/categories/:section', requireAuth, async (req, res) => {
    const section = req.params.section;
    await render(req, res, { title: `${SECTIONS[section].label} categories`, active: section, body: a.categoriesPage({ section, categories: await catalog.listCategories(db, section), csrf: req.auth.csrf }) });
  });
  r.post('/categories/:section', ...protectedPost, async (req, res) => {
    const section = req.params.section;
    const { errors, values } = catalog.validateCategory(req.body);
    if (Object.keys(errors).length) return await render(req, res, { title: `${SECTIONS[section].label} categories`, active: section, status: 422, body: a.categoriesPage({ section, categories: await catalog.listCategories(db, section), csrf: req.auth.csrf, values: req.body, errors }) });
    const cid = await catalog.createCategory(db, section, values);
    await audit(db, req.auth.user, 'created', 'category', cid, values.name);
    await flash(req, 'success', `Category “${values.name}” added.`);
    res.redirect(303, `/admin/categories/${section}`);
  });
  const loadCat = async (req, res) => { const c = await catalog.getCategory(db, id(req)); if (!c || c.section !== req.params.section) { await notFound(req, res); return null; } return c; };
  r.get('/categories/:section/:id/edit', requireAuth, async (req, res) => {
    const c = await loadCat(req, res); if (!c) return;
    await render(req, res, { title: `Edit ${c.name}`, active: c.section, body: a.categoryForm({ action: `/admin/categories/${c.section}/${c.id}`, csrf: req.auth.csrf, values: c, errors: {}, label: 'Save category', cancel: `/admin/categories/${c.section}` }) });
  });
  r.post('/categories/:section/:id', ...protectedPost, async (req, res) => {
    const c = await loadCat(req, res); if (!c) return;
    const { errors, values } = catalog.validateCategory(req.body);
    if (Object.keys(errors).length) return await render(req, res, { title: `Edit ${c.name}`, active: c.section, status: 422, body: a.categoryForm({ action: `/admin/categories/${c.section}/${c.id}`, csrf: req.auth.csrf, values: req.body, errors, label: 'Save category', cancel: `/admin/categories/${c.section}` }) });
    await catalog.updateCategory(db, c.id, values);
    await audit(db, req.auth.user, 'updated', 'category', c.id, values.name);
    await flash(req, 'success', `Category “${values.name}” saved.`);
    res.redirect(303, `/admin/categories/${c.section}`);
  });
  r.get('/categories/:section/:id/delete', requireAuth, async (req, res) => {
    const c = await loadCat(req, res); if (!c) return;
    await render(req, res, { title: 'Delete category', active: c.section, body: a.confirmPage({ question: `Delete the category “${c.name}”?`, action: `/admin/categories/${c.section}/${c.id}/delete`, csrf: req.auth.csrf, back: `/admin/categories/${c.section}` }) });
  });
  r.post('/categories/:section/:id/delete', ...protectedPost, async (req, res) => {
    const c = await loadCat(req, res); if (!c) return;
    const result = await catalog.deleteCategory(db, c.id);
    if (!result.ok) await flash(req, 'error', result.reason);
    else { await audit(db, req.auth.user, 'deleted', 'category', c.id, c.name); await flash(req, 'success', `Category “${c.name}” deleted.`); }
    res.redirect(303, `/admin/categories/${c.section}`);
  });

  // --------------------------------------------------------------- enquiries
  r.get('/enquiries', requireAuth, async (req, res) => {
    const filters = { status: qs(req.query.status) in enquiries.STATUSES ? qs(req.query.status) : '', q: clean(qs(req.query.q), 60) };
    const page = /^\d+$/.test(qs(req.query.page)) ? Math.max(1, Number(qs(req.query.page))) : 1;
    await render(req, res, { title: 'Enquiries', active: 'enq', body: a.enquiriesPage({ data: await enquiries.list(db, { ...filters, page }), filters }) });
  });
  const loadEnq = async (req, res) => { const e = await enquiries.get(db, id(req)); if (!e) { await notFound(req, res); return null; } return e; };
  r.get('/enquiries/:id', requireAuth, async (req, res) => { const e = await loadEnq(req, res); if (e) await render(req, res, { title: `Enquiry ${e.ref}`, active: 'enq', body: a.enquiryPage({ e, csrf: req.auth.csrf }) }); });
  r.post('/enquiries/:id', ...protectedPost, async (req, res) => {
    const e = await loadEnq(req, res); if (!e) return;
    if (!await enquiries.update(db, e.id, { status: req.body.status, notes: req.body.notes })) { await flash(req, 'error', 'Choose a valid status.'); return res.redirect(303, `/admin/enquiries/${e.id}`); }
    await audit(db, req.auth.user, 'updated', 'enquiry', e.id, `status: ${req.body.status}`);
    await flash(req, 'success', 'Enquiry updated.');
    res.redirect(303, `/admin/enquiries/${e.id}`);
  });
  r.get('/enquiries/:id/delete', requireAuth, async (req, res) => {
    const e = await loadEnq(req, res); if (!e) return;
    await render(req, res, { title: 'Delete enquiry', active: 'enq', body: a.confirmPage({ question: `Delete enquiry ${e.ref} from ${e.name}?`, detail: 'Consider marking it Archived if you may need it later.', action: `/admin/enquiries/${e.id}/delete`, csrf: req.auth.csrf, back: `/admin/enquiries/${e.id}` }) });
  });
  r.post('/enquiries/:id/delete', ...protectedPost, async (req, res) => {
    const e = await loadEnq(req, res); if (!e) return;
    await enquiries.remove(db, e.id);
    await audit(db, req.auth.user, 'deleted', 'enquiry', e.id, e.ref);
    await flash(req, 'success', `Enquiry ${e.ref} deleted.`);
    res.redirect(303, '/admin/enquiries');
  });

  // ---------------------------------------------------------------- settings
  r.get('/settings', requireAuth, requireOwner, async (req, res) => {
    await render(req, res, { title: 'Settings', active: 'settings', body: a.settingsPage({ values: req.settings, csrf: req.auth.csrf, settings: req.settings }) });
  });
  r.post('/settings', requireAuth, requireOwner, withUpload('logo'), csrf, async (req, res) => {
    const { errors, values } = settingsModel.validate(req.body);
    const file = req.file;
    if (req.uploadError) errors.logo = req.uploadError;
    else if (file && !detectImage(file.buffer)) errors.logo = 'Upload a JPG, PNG or WebP image.';
    if (Object.keys(errors).length) return await render(req, res, { title: 'Settings', active: 'settings', status: 422, body: a.settingsPage({ values: { ...req.body, ...values, food_enabled: values.food_enabled === '1', allow_contact_for_pricing: values.allow_contact_for_pricing === '1', privacy_reviewed: values.privacy_reviewed === '1' }, errors, csrf: req.auth.csrf, settings: req.settings }) });
    await settingsModel.save(db, values, req.auth.user.id);
    if (req.body.remove_logo === '1' || file) { await removeImage(db, req.settings.logo_path); await settingsModel.setRaw(db, 'logo_path', '', req.auth.user.id); }
    if (file) await settingsModel.setRaw(db, 'logo_path', (await saveImage(db, cfg, file.buffer)).name, req.auth.user.id);
    await audit(db, req.auth.user, 'updated', 'settings', null);
    await flash(req, 'success', 'Settings saved. The public website now shows the new details.');
    res.redirect(303, '/admin/settings');
  });

  // ----------------------------------------------------------------- account
  r.get('/account', requireAuth, async (req, res) => render(req, res, { title: 'Account', active: 'account', body: a.accountPage({ csrf: req.auth.csrf }) }));
  r.post('/account', ...protectedPost, async (req, res) => {
    const rl = limiter.hit(`pw:${req.auth.user.id}`, 8, 15 * 60 * 1000);
    const again = (errors, status = 422) => render(req, res, { title: 'Account', active: 'account', status, body: a.accountPage({ csrf: req.auth.csrf, errors }) });
    if (!rl.ok) return again({ current: 'Too many attempts. Wait a few minutes.' }, 429);
    const user = await db.get('SELECT * FROM admin_users WHERE id = ?', req.auth.user.id);
    if (!(await verifyPassword(String(req.body.current || '').slice(0, 200), user.password_hash))) return again({ current: 'Your current password is not correct.' });
    const pw = String(req.body.password || '');
    if (pw !== String(req.body.password2 || '')) return again({ password2: 'The passwords do not match.' });
    const problem = passwordProblem(pw, user.email);
    if (problem) return again({ password: problem });
    await db.run('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?', await hashPassword(pw), nowIso(), user.id);
    await sessions.destroyOthers(user.id, req.auth.hash);
    await audit(db, req.auth.user, 'changed password', 'admin_user', user.id);
    await flash(req, 'success', 'Password changed. Other signed-in devices were signed out.');
    res.redirect(303, '/admin/account');
  });

  // Anything else under /admin: 404 (there is deliberately no registration route).
  r.use(async (req, res) => (req.auth ? await notFound(req, res) : res.redirect(303, '/admin/login')));
  app.use('/admin', r);
};
