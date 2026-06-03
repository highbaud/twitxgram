'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildScheduledPostPayload, assertBlogAllowed } = require('../src/metricool');

test('buildScheduledPostPayload: shape + defaults (safe draft)', () => {
  const info = buildScheduledPostPayload({ mediaUrls: ['https://h/a.png'], networks: ['instagram'] });
  assert.deepStrictEqual(info.media, ['https://h/a.png']);
  assert.deepStrictEqual(info.providers, [{ network: 'instagram' }]);
  assert.strictEqual(info.draft, true, 'defaults to draft for safety');
  assert.strictEqual(info.autoPublish, false);
  assert.ok(!('publicationDate' in info), 'no schedule unless dateTime given');
});

test('buildScheduledPostPayload: multi-image carousel + schedule + networks', () => {
  const info = buildScheduledPostPayload({
    mediaUrls: ['https://h/0.png', 'https://h/1.png', 'https://h/2.png'],
    text: 'hello', dateTime: '2026-06-10T09:00:00', timezone: 'America/Chicago',
    networks: ['instagram', 'facebook'],
  });
  assert.strictEqual(info.media.length, 3, '3 images → IG carousel');
  assert.strictEqual(info.text, 'hello');
  assert.deepStrictEqual(info.providers, [{ network: 'instagram' }, { network: 'facebook' }]);
  assert.deepStrictEqual(info.publicationDate, { dateTime: '2026-06-10T09:00:00', timezone: 'America/Chicago' });
});

test('buildScheduledPostPayload: rejects empty media / bad networks', () => {
  assert.throws(() => buildScheduledPostPayload({ mediaUrls: [] }), /non-empty/);
  assert.throws(() => buildScheduledPostPayload({ mediaUrls: ['https://h/a.png'], networks: ['myspace'] }), /No valid networks/);
});

test('assertBlogAllowed: blocks ids configured via METRICOOL_BLOCKED_BLOG_IDS', () => {
  const prev = process.env.METRICOOL_BLOCKED_BLOG_IDS;
  process.env.METRICOOL_BLOCKED_BLOG_IDS = '900900, 900901';
  try {
    assert.throws(() => assertBlogAllowed('900900'), /blocked/);
    assert.throws(() => assertBlogAllowed(900901), /blocked/);     // numeric coerced
    assert.strictEqual(assertBlogAllowed('123456'), '123456');      // not on the list → allowed
    assert.throws(() => assertBlogAllowed(null), /required/);
  } finally {
    if (prev === undefined) delete process.env.METRICOOL_BLOCKED_BLOG_IDS;
    else process.env.METRICOOL_BLOCKED_BLOG_IDS = prev;
  }
});

test('assertBlogAllowed: nothing blocked by default', () => {
  const prev = process.env.METRICOOL_BLOCKED_BLOG_IDS;
  delete process.env.METRICOOL_BLOCKED_BLOG_IDS;
  try {
    assert.strictEqual(assertBlogAllowed('123456'), '123456');
  } finally {
    if (prev !== undefined) process.env.METRICOOL_BLOCKED_BLOG_IDS = prev;
  }
});
