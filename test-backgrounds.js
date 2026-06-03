'use strict';

// Visual smoke test — renders mock tweets with various backgrounds to PNG.
// No Twitter token needed; uses fabricated tweet data.

const fs = require('fs');
const path = require('path');
const { renderHtml } = require('./src/renderer');
const { htmlToPng, closeBrowser } = require('./src/screenshotter');
const { listPresets } = require('./src/backgrounds');

const mockData = {
  tweet: {
    id: '1234567890',
    text: 'just shipped the background presets 🚀\n\ncurated gradients + a tasteful default when none is provided. no more flat gray cards.',
    created_at: '2026-06-02T14:30:00.000Z',
    entities: { hashtags: [], mentions: [], urls: [] },
    public_metrics: { reply_count: 42, retweet_count: 318, like_count: 2900, impression_count: 184000, bookmark_count: 77 },
  },
  author: {
    name: 'Ada Lovelace',
    username: 'adalovelace',
    profile_image_url: '',
    verified: true,
    verified_type: 'blue',
  },
  media: [],
  quoteTweet: null,
};

(async () => {
  const outDir = path.join(__dirname, 'test-output');
  fs.mkdirSync(outDir, { recursive: true });

  // Test: a few presets + the no-background default (light & dark)
  const cases = [
    { label: 'default-light', opts: { theme: 'light' } },
    { label: 'default-dark',  opts: { theme: 'dark' } },
    { label: 'preset-sunset', opts: { theme: 'light', background: 'sunset', aspectRatio: '1:1', containerPadding: 48 } },
    { label: 'preset-twilight', opts: { theme: 'dark', background: 'twilight', aspectRatio: '1:1', containerPadding: 48 } },
    { label: 'preset-ocean',  opts: { theme: 'dark', background: 'ocean', containerPadding: 40 } },
    { label: 'custom-css',    opts: { theme: 'light', containerBackground: 'linear-gradient(45deg,#000,#333)' } },
  ];

  for (const c of cases) {
    const html = renderHtml(mockData, c.opts);
    const png = await htmlToPng(html, c.opts.width || 410);
    const file = path.join(outDir, `${c.label}.png`);
    fs.writeFileSync(file, png);
    console.log(`✓ ${c.label}.png (${(png.length / 1024).toFixed(1)} KB)`);
  }

  console.log(`\nAll presets available: ${listPresets().join(', ')}`);
  await closeBrowser();
})().catch(err => { console.error(err); process.exit(1); });
