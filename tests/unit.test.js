'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('../src/util');
const { detectImage } = require('../src/uploads');
const { passwordProblem, hashPassword, verifyPassword, formToken, checkFormToken } = require('../src/security');
const { PNG } = require('./helpers');

test('money parsing and formatting use integer minor units', () => {
  assert.equal(u.parseKES('250'), 25000); assert.equal(u.parseKES('250.5'), 25050); assert.equal(u.parseKES('KES 1,250.50'), 125050);
  for (const bad of ['', 'abc', '-5', '1.234', '1e3', '12,34,5x', '99999999']) assert.equal(u.parseKES(bad), null, bad);
  assert.equal(u.formatKES(25000), 'KES 250'); assert.equal(u.formatKES(25050), 'KES 250.50'); assert.equal(u.formatKES(125000), 'KES 1,250');
  assert.equal(u.minorToInput(25050), '250.50'); assert.equal(u.minorToInput(25000), '250');
  assert.equal(u.parseKES('0.1') + u.parseKES('0.2'), 30, 'no floating point drift');
});

test('phone and e-mail normalisation', () => {
  assert.equal(u.normalizePhone('0712 345 678'), '+254712345678'); assert.equal(u.normalizePhone('+254 712 345 678'), '+254712345678');
  assert.equal(u.normalizePhone('254712345678'), '+254712345678'); assert.equal(u.normalizePhone('0112345678'), '+254112345678');
  assert.equal(u.normalizePhone('+255 713 000 000'), '+255713000000', 'other East African numbers are allowed in international format');
  for (const bad of ['', 'abc', '0612345678', '12', '+254 712 34', '<script>']) assert.equal(u.normalizePhone(bad), null, bad);
  assert.equal(u.formatPhone('+254712345678'), '+254 712 345 678');
  assert.ok(u.isEmail('a@b.co')); for (const bad of ['a@b', 'a b@c.co', '@c.co', 'a@@c.co', 'a@c..co']) assert.ok(!u.isEmail(bad), bad);
  assert.equal(u.whatsappLink('+254712345678', 'Hi & bye'), 'https://wa.me/254712345678?text=Hi%20%26%20bye'); assert.equal(u.whatsappLink('', 'x'), null);
});

test('escaping and slugs', () => {
  assert.equal(u.html`<p>${'<b>"&\''}</p>`.toString(), '<p>&lt;b&gt;&quot;&amp;&#39;</p>');
  assert.equal(u.html`${u.html`<i>ok</i>`}`.toString(), '<i>ok</i>');
  assert.equal(u.slugify('Wash & Fold (Premium)!'), 'wash-and-fold-premium'); assert.equal(u.slugify('!!!'), 'item');
});

test('image type detection ignores names and trusts bytes', () => {
  assert.equal(detectImage(PNG), 'png'); assert.equal(detectImage(Buffer.from('GIF89a'.padEnd(20))), null);
  assert.equal(detectImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])), 'jpg');
  assert.equal(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

test('passwords: policy, hashing, verification', async () => {
  assert.ok(passwordProblem('short')); assert.ok(passwordProblem('aaaaaaaaaaaaaaaa')); assert.ok(passwordProblem('jane.doe-secret-1', 'jane.doe@x.co'));
  assert.equal(passwordProblem('Correct-Horse-Battery-9', 'a@b.co'), null);
  const h = await hashPassword('Correct-Horse-Battery-9');
  assert.ok(await verifyPassword('Correct-Horse-Battery-9', h)); assert.ok(!(await verifyPassword('wrong-password-123', h)));
  assert.notEqual(h, await hashPassword('Correct-Horse-Battery-9'), 'salted');
});

test('public form tokens: signed, time-boxed', () => {
  const t = formToken('secret', Date.now() - 5000);
  assert.equal(checkFormToken('secret', t, { minSeconds: 2 }), 'ok'); assert.equal(checkFormToken('other', t), 'invalid');
  assert.equal(checkFormToken('secret', formToken('secret', Date.now()), { minSeconds: 2 }), 'too_fast');
  assert.equal(checkFormToken('secret', formToken('secret', Date.now() - 7 * 3600e3)), 'expired');
  assert.equal(checkFormToken('secret', 'junk'), 'invalid');
});

test('brand palette meets WCAG AA contrast for the text/background pairs actually used', () => {
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const pairs = [['body text', '#1D1F24', '#F4F4F6'], ['muted text', '#4A4E57', '#F4F4F6'], ['orange button label', '#1D1F24', '#FF6B35'], ['orange link text', '#A63A0F', '#F4F4F6'],
    ['crimson button label', '#FFFFFF', '#B3202D'], ['crimson link text', '#B3202D', '#F4F4F6'], ['footer text', '#FFFFFF', '#1D1F24'], ['footer muted', '#B8BCC6', '#1D1F24'], ['error text', '#A4161A', '#F4F4F6']];
  for (const [name, fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)}`);
  assert.ok(ratio('#767B86', '#FFFFFF') >= 3, 'form control borders reach 3:1');
});
