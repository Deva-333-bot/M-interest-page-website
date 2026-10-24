'use strict';
require('../scripts/load-env');
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { openDb } = require('./db');
const users = require('./models/users');

async function main() {
  const cfg = loadConfig();
  const db = await openDb(cfg.databaseUrl, { ssl: cfg.databaseSsl });
  const app = createApp(cfg, db);
  const server = app.listen(cfg.port, '0.0.0.0', async () => {
    console.log(`M-Interest site listening on port ${cfg.port} (${cfg.isProd ? 'production' : 'development'})`);
    if ((await users.countAdmins(db)) === 0) {
      console.log(cfg.setupToken.length >= 24
        ? 'No administrator exists yet: open /admin/setup and use your SETUP_TOKEN, or run "npm run create-admin".'
        : 'No administrator exists yet: set a SETUP_TOKEN of 24+ characters and open /admin/setup, or run "npm run create-admin".');
    }
  });
  const stop = () => server.close(async () => { await db.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main().catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
