'use strict';
require('./load-env');
const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
(async () => {
  const cfg = loadConfig();
  const db = await openDb(cfg.databaseUrl, { ssl: cfg.databaseSsl });
  console.log('Database is up to date.');
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
