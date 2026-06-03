'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { toInt, isSafeCssBackground, validateExternalUrl, isLoopbackIp } = require('../src/validate');

test('toInt: returns default for missing/NaN', () => {
  assert.strictEqual(toInt(undefined, 16), 16);
  assert.strictEqual(toInt(null, 16), 16);
  assert.strictEqual(toInt('', 16), 16);
  assert.strictEqual(toInt('abc', 16), 16);
  assert.strictEqual(toInt('xyz', 410, { min: 300, max: 1000 }), 410);
});

test('toInt: parses and clamps', () => {
  assert.strictEqual(toInt('500', 410, { min: 300, max: 1000 }), 500);
  assert.strictEqual(toInt('50', 410, { min: 300, max: 1000 }), 300);   // clamp up to min
  assert.strictEqual(toInt('5000', 410, { min: 300, max: 1000 }), 1000); // clamp to max
  assert.strictEqual(toInt('-5', 16, { min: 0 }), 0);
  assert.strictEqual(toInt('24px', 16), 24); // parseInt tolerance
});

test('isSafeCssBackground: accepts safe values', () => {
  assert.ok(isSafeCssBackground('#fff'));
  assert.ok(isSafeCssBackground('#ff6b6b'));
  assert.ok(isSafeCssBackground('rgb(255, 0, 0)'));
  assert.ok(isSafeCssBackground('rgba(0,0,0,.5)'));
  assert.ok(isSafeCssBackground('linear-gradient(135deg, #667eea 0%, #764ba2 100%)'));
  assert.ok(isSafeCssBackground('white'));
  assert.ok(isSafeCssBackground('transparent'));
});

test('isSafeCssBackground: rejects injection attempts', () => {
  assert.ok(!isSafeCssBackground('red); position:fixed; top:0'));
  assert.ok(!isSafeCssBackground('#fff; } body {'));
  assert.ok(!isSafeCssBackground("url('https://evil.com/x.png')"));
  assert.ok(!isSafeCssBackground('red /* comment */'));
  assert.ok(!isSafeCssBackground('rgb(0,0,0))')); // unbalanced parens
  assert.ok(!isSafeCssBackground(''));
  assert.ok(!isSafeCssBackground('a'.repeat(3000)));
});

test('isLoopbackIp: only loopback peers count as local (write-guard gate)', () => {
  assert.ok(isLoopbackIp('127.0.0.1'));
  assert.ok(isLoopbackIp('::1'));
  assert.ok(isLoopbackIp('::ffff:127.0.0.1'));
  assert.ok(!isLoopbackIp('8.8.8.8'));
  assert.ok(!isLoopbackIp('10.0.0.5'));
  assert.ok(!isLoopbackIp('192.168.1.20'));
  assert.ok(!isLoopbackIp(''));
});

test('validateExternalUrl: rejects non-https and private targets', async () => {
  await assert.rejects(() => validateExternalUrl('http://example.com/x.png'), /https/);
  await assert.rejects(() => validateExternalUrl('https://localhost/x.png'), /not allowed/);
  await assert.rejects(() => validateExternalUrl('https://127.0.0.1/x.png'), /not allowed/);
  await assert.rejects(() => validateExternalUrl('https://10.0.0.5/x.png'), /not allowed/);
  await assert.rejects(() => validateExternalUrl('https://169.254.169.254/latest/meta-data'), /not allowed/);
  await assert.rejects(() => validateExternalUrl('https://192.168.1.1/x.png'), /not allowed/);
  await assert.rejects(() => validateExternalUrl('https://foo.internal/x.png'), /not allowed/);
  await assert.rejects(() => validateExternalUrl('not a url'), /Invalid/);
});
