'use strict';
async function audit(db, actor, action, entityType, entityId, detail = '') {
  await db.run('INSERT INTO audit_events (actor_id, actor_email, action, entity_type, entity_id, detail) VALUES (?,?,?,?,?,?)', actor?.id ?? null, actor?.email ?? null, action, entityType, entityId === undefined || entityId === null ? null : String(entityId), String(detail).slice(0, 200));
}
const recent = async (db, n = 8) => await db.all('SELECT * FROM audit_events ORDER BY id DESC LIMIT ?', n);
module.exports = { audit, recent };
