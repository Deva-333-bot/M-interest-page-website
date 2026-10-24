'use strict';
const crypto = require('node:crypto');

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

// Detect the real image type from magic bytes - never trust the client-supplied name/type.
function detectImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// Images are stored in PostgreSQL (the host has no persistent disk) and served from /uploads/<name>.
async function saveImage(db, cfg, buf) {
  const ext = detectImage(buf);
  if (!ext) return { error: 'Upload a JPG, PNG or WebP image.' };
  if (buf.length > cfg.maxImageBytes) return { error: `Images must be under ${cfg.maxImageBytes / 1024 / 1024} MB.` };
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await db.run('INSERT INTO images (name, content_type, data) VALUES (?,?,?)', name, TYPES[ext], buf);
  return { name };
}
async function removeImage(db, name) {
  if (name && NAME_RE.test(name)) await db.run('DELETE FROM images WHERE name = ?', name);
}
function serveImages(db) {
  return async (req, res) => {
    if (!NAME_RE.test(req.params.name)) return res.status(404).end();
    const row = await db.get('SELECT content_type, data FROM images WHERE name = ?', req.params.name);
    if (!row) return res.status(404).end();
    res.set({ 'Content-Type': row.content_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Disposition': 'inline' });
    res.send(row.data);
  };
}

module.exports = { detectImage, saveImage, removeImage, serveImages };
