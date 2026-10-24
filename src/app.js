'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { Sessions, RateLimiter } = require('./security');
const settingsModel = require('./models/settings');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const { errorPage } = require('./views/public');
const { serveImages } = require('./uploads');
const adminViews = require('./views/admin');
const { html } = require('./util');

function createApp(cfg, db) {
  const sessions = new Sessions(db, cfg);
  const limiter = new RateLimiter();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  app.use(helmet({
    useDefaults: false,
    contentSecurityPolicy: { useDefaults: false, directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"],
      connectSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'self'"], objectSrc: ["'none'"],
      ...(cfg.isProd ? { upgradeInsecureRequests: [] } : {}) } },
    strictTransportSecurity: cfg.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    xContentTypeOptions: true, referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' }, crossOriginResourcePolicy: { policy: 'same-origin' },
    xFrameOptions: { action: 'deny' },
  }));
  app.use((req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'); next(); });

  const pub = path.join(cfg.root, 'public');
  app.use('/fonts', express.static(path.join(pub, 'fonts'), { maxAge: '365d', immutable: true, index: false }));
  app.use(express.static(pub, { maxAge: '1h', index: false, dotfiles: 'ignore' }));
  app.get('/uploads/:name', serveImages(db));

  app.use(express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 100 }));
  app.use(async (req, res, next) => { req.body = req.body || {}; req.settings = await settingsModel.getAll(db); next(); });

  const ctx = { cfg, db, sessions, limiter };
  const { notFound, page } = publicRoutes(app, ctx);
  adminRoutes(app, ctx);
  app.use(notFound);

  // eslint-disable-next-line no-unused-vars
  app.use(async (err, req, res, next) => {
    req.settings = req.settings || await settingsModel.getAll(db).catch(() => settingsModel.defaults());
    const status = err.type === 'entity.too.large' ? 413 : err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500 && !cfg.isTest) console.error(`[error] ${req.method} ${req.path}: ${err.message}`); // no bodies, no cookies
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) return res.status(status).json({ error: status === 500 ? 'Server error' : 'Request rejected' });
    const message = status === 413 ? 'That request was too large.' : status === 500 ? 'Something went wrong on our side. Please try again shortly.' : 'That request could not be processed.';
    if (req.path.startsWith('/admin')) return res.status(status).type('html').send(adminViews.layout({ title: 'Error', body: html`<p>${message}</p><p><a href="/admin">Back to the dashboard</a></p>`, s: req.settings || {} }).toString());
    return page(req, res, { title: 'Error', noindex: true, path: '/', description: '', body: errorPage({ s: req.settings, code: status, title: status === 500 ? 'Something went wrong' : 'Request problem', message }) }, status);
  });

  app.locals.db = db; app.locals.sessions = sessions; app.locals.limiter = limiter;
  return app;
}

module.exports = { createApp };
