'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Configure creds before requiring the client (it reads env at call time, so we
// can set them here and they'll apply).
process.env.METRICOOL_USER_TOKEN = 'test-token';
process.env.METRICOOL_USER_ID = '99999';
process.env.METRICOOL_BLOCKED_BLOG_IDS = '900900'; // a blocked id for the guard test

const client = require('../src/metricoolClient');

function mockFetch(captured, { ok = true, status = 200, body = { id: 555 } } = {}) {
  global.fetch = async (url, opts) => {
    captured.url = url;
    captured.opts = opts;
    return {
      ok, status,
      text: async () => JSON.stringify(body),
      headers: new Map(),
    };
  };
}

test('isConfigured reflects env', () => {
  assert.strictEqual(client.isConfigured(), true);
});

test('schedulePost: correct URL, auth header, query params, body', async () => {
  const cap = {};
  mockFetch(cap);
  const info = { text: 'hi', media: ['https://h/0.png'], providers: [{ network: 'instagram' }], draft: true };
  const result = await client.schedulePost({ blogId: '123456', info });

  assert.ok(cap.url.includes('/v2/scheduler/posts'), 'hits the scheduler path');
  assert.ok(cap.url.includes('userId=99999'), 'userId query param');
  assert.ok(cap.url.includes('blogId=123456'), 'blogId query param');
  assert.strictEqual(cap.opts.method, 'POST');
  assert.strictEqual(cap.opts.headers['X-Mc-Auth'], 'test-token', 'auth header');
  assert.deepStrictEqual(JSON.parse(cap.opts.body), info, 'sends the info payload');
  assert.deepStrictEqual(result, { id: 555 });
});

test('schedulePost: refuses a blocked blogId BEFORE any request', async () => {
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, text: async () => '{}' }; };
  await assert.rejects(() => client.schedulePost({ blogId: '900900', info: {} }), /blocked/);
  assert.strictEqual(called, false, 'no network call for a blocked blog');
});

test('schedulePost: surfaces Metricool API errors', async () => {
  const cap = {};
  mockFetch(cap, { ok: false, status: 422, body: { message: 'bad payload' } });
  await assert.rejects(() => client.schedulePost({ blogId: '123456', info: {} }), /bad payload/);
});

test('listBrands: GET with userId + auth header', async () => {
  const cap = {};
  mockFetch(cap, { body: [{ id: 1, label: 'Jake' }] });
  const brands = await client.listBrands();
  assert.ok(cap.url.includes('/admin/simpleProfiles'));
  assert.ok(cap.url.includes('userId=99999'));
  assert.strictEqual(cap.opts.headers['X-Mc-Auth'], 'test-token');
  assert.deepStrictEqual(brands, [{ id: 1, label: 'Jake' }]);
});
