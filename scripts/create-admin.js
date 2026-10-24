'use strict';
// Creates an administrator. Passwords are never stored in files and there are no defaults.
//   Interactive:  npm run create-admin
//   Non-interactive (CI/provisioning):  ADMIN_EMAIL=... ADMIN_PASSWORD=... [ADMIN_ROLE=staff] npm run create-admin
require('./load-env');
const readline = require('node:readline');
const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
const users = require('../src/models/users');

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write(/[\r\n]/.test(s) ? s : '*'); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const cfg = loadConfig();
  const db = await openDb(cfg.databaseUrl, { ssl: cfg.databaseSsl });
  let { ADMIN_EMAIL: email, ADMIN_PASSWORD: password, ADMIN_ROLE: role } = process.env;
  const first = (await users.countAdmins(db)) === 0;
  if (!email) email = await ask('Administrator e-mail: ');
  if (!password) {
    password = await ask('Password (min 12 characters): ', true);
    const again = await ask('Repeat password: ', true);
    if (password !== again) { console.error('Passwords do not match.'); process.exit(1); }
  }
  role = role || (first ? 'owner' : await ask('Role (owner/staff) [staff]: ') || 'staff');
  try {
    const u = await users.createAdmin(db, { email, password, role });
    console.log(`Created ${u.role} account for ${u.email}. Sign in at /admin/login.`);
  } catch (e) { console.error(e.message); process.exit(1); }
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
