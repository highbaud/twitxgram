'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Force a small cap for the test before requiring the module.
process.env.RENDER_CONCURRENCY = '2';
const { withLimit, MAX_RENDER_CONCURRENCY, stats } = require('../src/limit');

test('withLimit: caps concurrency and queues the rest', async () => {
  assert.strictEqual(MAX_RENDER_CONCURRENCY, 2);

  let running = 0, peak = 0;
  const defer = () => { let r; const p = new Promise((res) => (r = res)); return { p, r }; };
  const gates = [defer(), defer(), defer(), defer()];

  const task = (i) => withLimit(async () => {
    running++; peak = Math.max(peak, running);
    await gates[i].p;        // hold the slot until released
    running--;
    return i;
  });

  const all = [0, 1, 2, 3].map(task);
  await new Promise((r) => setTimeout(r, 20));

  // Only 2 may run at once; the other 2 are queued.
  assert.strictEqual(stats().active, 2, 'two active');
  assert.strictEqual(stats().queued, 2, 'two queued');

  gates.forEach((g) => g.r());   // release all
  const out = await Promise.all(all);
  assert.deepStrictEqual(out.sort(), [0, 1, 2, 3]);
  assert.strictEqual(peak, 2, 'never exceeded the cap');
  assert.strictEqual(stats().active, 0, 'all released');
});

test('withLimit: releases the slot even when fn throws', async () => {
  await assert.rejects(() => withLimit(async () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(stats().active, 0, 'slot freed after throw');
});
