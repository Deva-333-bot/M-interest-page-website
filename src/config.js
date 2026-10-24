'use strict';
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');

function loadConfig(env = process.env, overrides = {}) {
  const isProd = env.NODE_ENV === 'production';
  const port = Number(env.PORT) || 3000;
  const cfg = {
    root,
    isProd,
    isTest: env.NODE_ENV === 'test',
    port,
    databaseUrl: env.DATABASE_URL || '',
    databaseSsl: env.DATABASE_SSL || 'auto',
    siteUrl: (env.SITE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    sessionSecret: env.SESSION_SECRET || '',
    setupToken: env.SETUP_TOKEN || '',
    trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY === 'true' ? 1 : false) : false,
    minFormSeconds: env.MIN_FORM_SECONDS === undefined ? 2 : Number(env.MIN_FORM_SECONDS),
    sessionIdleMs: 2 * 60 * 60 * 1000,
    sessionMaxMs: 12 * 60 * 60 * 1000,
    maxImageBytes: 1024 * 1024,
    ...overrides,
  };
  if (!cfg.sessionSecret) {
    if (isProd) throw new Error('SESSION_SECRET must be set (32+ characters) in production.');
    cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
  }
  if (isProd && !cfg.databaseUrl) throw new Error('DATABASE_URL must be set (PostgreSQL connection string).');
  if (isProd && cfg.sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
  if (isProd && !/^https:\/\//.test(cfg.siteUrl)) throw new Error('SITE_URL must be an https:// URL in production.');
  return cfg;
}

module.exports = { loadConfig };
