'use strict';
const { hashPassword, passwordProblem } = require('../security');
const { isEmail } = require('../util');

async function createAdmin(db, { email, password, role = 'owner' }) {
  email = String(email || '').trim().toLowerCase();
  if (!isEmail(email)) throw new Error('Enter a valid e-mail address.');
  if (!['owner', 'staff'].includes(role)) throw new Error('Role must be owner or staff.');
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(problem);
  const hash = await hashPassword(password);
  try {
    const r = await db.run('INSERT INTO admin_users (email, password_hash, role) VALUES (?,?,?) RETURNING id', email, hash, role);
    return { id: r.rows[0].id, email, role };
  } catch (e) {
    if (e.code === '23505') throw new Error('An administrator with that e-mail already exists.');
    throw e;
  }
}
const countAdmins = async (db) => (await db.get('SELECT COUNT(*) c FROM admin_users')).c;
const findByEmail = async (db, email) => await db.get('SELECT * FROM admin_users WHERE email = ?', String(email || '').trim().toLowerCase());

module.exports = { createAdmin, countAdmins, findByEmail };
