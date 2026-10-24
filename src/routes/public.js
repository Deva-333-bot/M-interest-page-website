'use strict';
const catalog = require('../models/catalog');
const enquiries = require('../models/enquiries');
const v = require('../views/public');
const { formToken, checkFormToken } = require('../security');
const { qs, clean, SECTIONS } = require('../util');

module.exports = function publicRoutes(app, { cfg, db, limiter }) {
  const send = (res, status, page) => res.status(status).type('html').send(page.toString());
  const page = (req, res, opts, status = 200) => send(res, status, v.layout({ s: req.settings, cfg, ...opts }));

  const describe = (s, extra) => `${s.business_name} offers laundry and cyber café services${s.area ? ' in ' + s.area : ''}. ${extra}`.trim();

  app.get('/', async (req, res) => {
    const s = req.settings;
    const counts = {}; const cats = {}; const featured = {};
    for (const k of ['laundry', 'cyber', 'food']) {
      counts[k] = await catalog.publicCount(db, k);
      cats[k] = catalog.groupByCategory(await catalog.publicItems(db, k)).map((g) => ({ name: g.name, slug: g.slug }));
      featured[k] = await catalog.featuredItems(db, k);
    }
    page(req, res, { title: s.business_name, path: '/', description: describe(s, s.whatsapp_number ? 'Check prices, then contact us on WhatsApp.' : 'Check prices and send us an enquiry.'), structured: true, body: v.homePage({ s, counts, cats, featured }) });
  });

  app.get('/about', async (req, res) => {
    const s = req.settings;
    page(req, res, { title: 'About', path: '/about', description: `About ${s.business_name}.`, body: v.aboutPage({ s }) });
  });

  const catalogueRoute = (section, intro) => async (req, res) => {
    const s = req.settings;
    if (section === 'food' && !s.food_enabled) return notFound(req, res);
    const q = clean(qs(req.query.q), 60);
    const rows = await catalog.publicItems(db, section, { q });
    const categories = catalog.groupByCategory(await catalog.publicItems(db, section));
    page(req, res, { title: SECTIONS[section].label, path: SECTIONS[section].path, noindex: Boolean(q), description: `${SECTIONS[section].label} services and prices at ${s.business_name}.`,
      body: v.cataloguePage({ s, section, groups: catalog.groupByCategory(rows), q, intro, categories }) });
  };
  app.get('/laundry', catalogueRoute('laundry'));
  app.get('/cyber-cafe', catalogueRoute('cyber'));
  app.get('/menu', catalogueRoute('food'));

  // ---------------------------------------------------------------- contact form
  app.get('/contact', async (req, res) => {
    const s = req.settings; const values = {};
    const id = /^\d{1,9}$/.test(qs(req.query.service)) ? Number(qs(req.query.service)) : 0;
    const item = id ? await catalog.publicItem(db, id) : null;
    if (item && (item.section !== 'food' || s.food_enabled)) { values.category = item.section; values.message = `I would like to enquire about ${item.name}.`; }
    page(req, res, { title: 'Contact', path: '/contact', description: `Contact ${s.business_name} by WhatsApp, phone or enquiry form.`, body: v.contactPage({ s, values, token: formToken(cfg.sessionSecret) }) });
  });

  app.post('/contact', async (req, res) => {
    const s = req.settings; const b = req.body;
    const rl = limiter.hit(`contact:${req.ip}`, 10, 60 * 60 * 1000);
    if (!rl.ok) { res.set('Retry-After', String(rl.retryAfter)); return page(req, res, { title: 'Too many requests', noindex: true, path: '/contact', description: '', body: v.errorPage({ s, code: 429, title: 'Please try again later', message: 'You have sent several enquiries in a short time. Please wait a while, or contact us by phone or WhatsApp.' }) }, 429); }
    if (clean(b.website, 200)) return res.redirect(303, '/contact/thanks'); // honeypot: pretend success, store nothing
    const { errors, values } = enquiries.validate(b, { foodEnabled: s.food_enabled });
    const tokenState = checkFormToken(cfg.sessionSecret, b._t, { minSeconds: cfg.minFormSeconds });
    const rerender = (status, notice) => page(req, res, { title: 'Contact', path: '/contact', noindex: true, description: '', body: v.contactPage({ s, values, errors: notice ? {} : errors, notice, token: formToken(cfg.sessionSecret) }) }, status);
    if (tokenState !== 'ok') return rerender(422, tokenState === 'too_fast' ? 'That was very quick. Please check your details and send again.' : 'This form has expired. Your message is kept below; please send it again.');
    if (Object.keys(errors).length) return rerender(422);
    const result = await enquiries.create(db, values);
    res.redirect(303, `/contact/thanks?ref=${result.ref}`);
  });

  app.get('/contact/thanks', async (req, res) => {
    const ref = /^MI-[A-Z2-9]{8}$/.test(qs(req.query.ref)) ? qs(req.query.ref) : '';
    page(req, res, { title: 'Thank you', path: '/contact/thanks', noindex: true, description: 'Enquiry received.', body: v.thanksPage({ s: req.settings, ref }) });
  });

  app.get('/privacy', async (req, res) => page(req, res, { title: 'Privacy notice', path: '/privacy', description: `How ${req.settings.business_name} handles enquiry information.`, body: v.privacyPage({ s: req.settings }) }));

  // ------------------------------------------------------------------- public API
  const apiLimit = async (req, res, next) => {
    const rl = limiter.hit(`api:${req.ip}`, 120, 60 * 1000);
    if (!rl.ok) { res.set('Retry-After', String(rl.retryAfter)); return res.status(429).json({ error: 'Too many requests' }); }
    res.set('Cache-Control', 'no-cache');
    next();
  };
  const notFoundJson = (res) => res.status(404).json({ error: 'Not found' });
  app.get('/api/services', apiLimit, async (req, res) => {
    const section = qs(req.query.section);
    const sections = section ? [section] : ['laundry', 'cyber'];
    if (sections.some((k) => !['laundry', 'cyber'].includes(k))) return res.status(400).json({ error: 'section must be laundry or cyber' });
    res.json({ data: (await Promise.all(sections.map((k) => catalog.publicItems(db, k)))).flat().map(catalog.toPublic) });
  });
  app.get('/api/menu', apiLimit, async (req, res) => (req.settings.food_enabled ? res.json({ data: (await catalog.publicItems(db, 'food')).map(catalog.toPublic) }) : notFoundJson(res)));
  app.get('/api/services/:id', apiLimit, async (req, res) => {
    if (!/^\d{1,9}$/.test(req.params.id)) return notFoundJson(res);
    const item = await catalog.publicItem(db, Number(req.params.id));
    if (!item || (item.section === 'food' && !req.settings.food_enabled)) return notFoundJson(res);
    res.json({ data: catalog.toPublic(item) });
  });

  // ----------------------------------------------------------------- SEO / ops
  app.get('/robots.txt', async (req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /contact/thanks\nAllow: /\n\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`));
  app.get('/sitemap.xml', async (req, res) => {
    const paths = ['/', '/about', '/laundry', '/cyber-cafe', ...(req.settings.food_enabled ? ['/menu'] : []), '/contact', '/privacy'];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url><loc>${cfg.siteUrl}${p === '/' ? '/' : p}</loc></url>`).join('\n')}\n</urlset>\n`);
  });
  app.get('/healthz', async (req, res) => { await db.get('SELECT 1'); res.json({ ok: true }); });

  function notFound(req, res) {
    page(req, res, { title: 'Page not found', noindex: true, path: req.path, description: '', body: v.errorPage({ s: req.settings, code: 404, title: 'Page not found', message: 'The page you are looking for does not exist or is no longer available.' }) }, 404);
  }
  return { notFound, page };
};
