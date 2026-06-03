'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { extractStatusId } = require('../src/url');

test('extractStatusId: bare numeric IDs', () => {
  assert.strictEqual(extractStatusId('20'), '20');
  assert.strictEqual(extractStatusId('1617979122625712128'), '1617979122625712128');
  assert.strictEqual(extractStatusId('  20  '), '20'); // trimmed
});

test('extractStatusId: x.com / twitter.com URLs', () => {
  assert.strictEqual(extractStatusId('https://x.com/jack/status/20'), '20');
  assert.strictEqual(extractStatusId('https://twitter.com/u/status/1617979122625712128'), '1617979122625712128');
  assert.strictEqual(extractStatusId('https://twitter.com/u/status/20?s=46&t=xyz'), '20');
  assert.strictEqual(extractStatusId('http://www.x.com/u/status/20/photo/1'), '20');
  assert.strictEqual(extractStatusId('https://mobile.twitter.com/u/statuses/20'), '20');
});

test('extractStatusId: scheme-less and mirror hosts', () => {
  assert.strictEqual(extractStatusId('x.com/u/status/20'), '20');
  assert.strictEqual(extractStatusId('https://fxtwitter.com/u/status/20'), '20');
  assert.strictEqual(extractStatusId('https://vxtwitter.com/u/status/20'), '20');
});

test('extractStatusId: rejects bad input', () => {
  assert.throws(() => extractStatusId('not a tweet'), /Invalid|Unsupported|Could not/);
  assert.throws(() => extractStatusId('https://example.com/u/status/20'), /Unsupported host/);
  assert.throws(() => extractStatusId('https://x.com/jack'), /status/);
  assert.throws(() => extractStatusId(''), /Missing|Invalid/);
  assert.throws(() => extractStatusId(null), /Missing/);
});
