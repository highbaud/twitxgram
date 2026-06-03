'use strict';

const fs = require('fs');
const path = require('path');
const { renderHtml } = require('./src/renderer');
const { htmlToPng, closeBrowser } = require('./src/screenshotter');
const { renderCarousel } = require('./src/carousel');

const LONG = `This is a deliberately very long tweet to prove the pipeline never chops content. 🧵

When you force a fixed aspect ratio, a tall tweet used to get clipped by the frame. Now it either scales down to fit neatly — or, if it's too long to stay readable, it splits into a clean multi-part carousel.

Each slide is centered, the header rides along on every slide for context, and the first slide shows a clear "Swipe →" hint plus a dot indicator so people know there's more. The stats and timestamp land on the final slide. No more run-off, no more guessing.`;

const mockData = {
  tweet: {
    id: '1234567890',
    text: LONG,
    created_at: '2026-06-02T14:30:00.000Z',
    entities: { hashtags: [], mentions: [], urls: [] },
    public_metrics: { reply_count: 42, retweet_count: 318, like_count: 2900, impression_count: 184000, bookmark_count: 77 },
  },
  author: { name: 'Ada Lovelace', username: 'adalovelace', profile_image_url: '', verified: true, verified_type: 'blue' },
  media: [],
  quoteTweet: null,
};

(async () => {
  const outDir = path.join(__dirname, 'test-output');
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Fit-to-frame: long tweet forced into 1:1, should scale to fit (not chop)
  const fitHtml = renderHtml(mockData, { theme: 'light', background: 'twilight', aspectRatio: '1:1', containerPadding: 40 });
  const fitPng = await htmlToPng(fitHtml, 410);
  fs.writeFileSync(path.join(outDir, 'fit-1x1.png'), fitPng);
  console.log(`✓ fit-1x1.png (${(fitPng.length/1024).toFixed(1)} KB) — whole tweet scaled to fit`);

  // 2. Carousel: same long tweet, 4:5 portrait slides
  const slides = await renderCarousel(mockData, { theme: 'light', background: 'ocean', aspectRatio: '4:5', containerPadding: 36, carousel: 'true', showStats: true, showTimestamp: true, showViews: true });
  slides.forEach((buf, i) => {
    fs.writeFileSync(path.join(outDir, `carousel-${i + 1}.png`), buf);
  });
  console.log(`✓ carousel: ${slides.length} slides (carousel-1..${slides.length}.png)`);

  await closeBrowser();
})().catch(err => { console.error(err); process.exit(1); });
