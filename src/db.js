'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Pool, types } = require('pg');

// Return bigint counts as numbers and timestamps as ISO-8601 UTC strings.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1184, (v) => new Date(v).toISOString());

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// SQL in this project is written with "?" placeholders; PostgreSQL wants $1, $2, ...
const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

class Db {
  constructor(runner, pool) { this.runner = runner; this.pool = pool; }
  async all(sql, ...params) { return (await this.runner.query(toPg(sql), params)).rows; }
  async get(sql, ...params) { return (await this.all(sql, ...params))[0]; }
  async run(sql, ...params) { const r = await this.runner.query(toPg(sql), params); return { changes: r.rowCount, rows: r.rows }; }
  async tx(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(new Db(client, this.pool));
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }
  async close() { this.pool.removeAllListeners('error'); this.pool.on('error', () => {}); await this.pool.end(); }
}

async function migrate(db) {
  await db.run('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const file of files) {
    await db.tx(async (t) => {
      await t.run('SELECT pg_advisory_xact_lock(7165001)'); // two starting instances cannot migrate at once
      if (await t.get('SELECT 1 AS x FROM schema_migrations WHERE name = ?', file)) return;
      await t.runner.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await t.run('INSERT INTO schema_migrations (name) VALUES (?)', file);
      ran.push(file);
    }).catch((e) => { throw new Error(`Migration ${file} failed: ${e.message}`); });
  }
  return ran;
}

// ssl: 'off' | 'require' (encrypted, certificate not verified) | 'verify'.
// Default: off for localhost and Render-internal hostnames (no dots), require otherwise.
function sslFor(url, mode) {
  const host = new URL(url).hostname;
  const m = mode && mode !== 'auto' ? mode : (host === 'localhost' || host === '127.0.0.1' || !host.includes('.') ? 'off' : 'require');
  return m === 'off' ? false : m === 'verify' ? { rejectUnauthorized: true } : { rejectUnauthorized: false };
}

async function openDb(url, { ssl = 'auto', max = 8 } = {}) {
  if (!url) throw new Error('DATABASE_URL is not set. Point it at a PostgreSQL database.');
  const pool = new Pool({ connectionString: url.replace(/[?&]sslmode=[^&]*/g, ''), ssl: sslFor(url, ssl), max, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  const db = new Db(pool, pool);
  await migrate(db);
  return db;
}

const nowIso = () => new Date().toISOString();

module.exports = { openDb, migrate, nowIso, Db, toPg };
