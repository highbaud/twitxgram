'use strict';

const os = require('os');

// Cap concurrent Playwright renders so the watcher + playground + multiple
// callers can't spawn unbounded Chromium contexts (memory blowup). Excess
// renders queue and run as slots free up.
const MAX = Math.max(1, Number(process.env.RENDER_CONCURRENCY || Math.min(4, (os.cpus() || []).length || 4)));

let active = 0;
const queue = [];

function acquire() {
  return new Promise((resolve) => {
    if (active < MAX) { active++; resolve(); }
    else queue.push(resolve);
  });
}
function release() {
  active = Math.max(0, active - 1);
  const next = queue.shift();
  if (next) { active++; next(); }
}

/** Run fn() while holding a render slot; releases even if fn throws. */
async function withLimit(fn) {
  await acquire();
  try { return await fn(); }
  finally { release(); }
}

function stats() { return { active, queued: queue.length, max: MAX }; }

module.exports = { withLimit, stats, MAX_RENDER_CONCURRENCY: MAX };
