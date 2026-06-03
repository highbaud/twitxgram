'use strict';

/*
 * Shared render pipeline: tweet/thread/carousel → image buffer(s) → saved public
 * URLs. Used by both the HTTP routes (server.js) and the background watcher
 * (watcher.js) so there's one code path for rendering + hosting.
 */

const path = require('path');
const fs = require('fs');
const { fetchTweet, fetchThread, selectThreadTweets } = require('./fetcher');
const { renderHtml, renderThreadHtml } = require('./renderer');
const { htmlToPng, encodeImage } = require('./screenshotter');
const { renderCarousel, renderThreadCarousel } = require('./carousel');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const EXT_MAP = { png: 'png', svg: 'svg', jpg: 'jpg', jpeg: 'jpg', webp: 'webp' };
const RENDER_CEILING_MS = Number(process.env.RENDER_CEILING_MS || 30000);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Render to image buffer(s). Returns { buffers, ext, caption } where `caption`
 * is the (first) tweet's text — handy for prefilling a post caption.
 */
async function renderToBuffers(statusId, opts) {
  const cap = (p, label) => withTimeout(p, RENDER_CEILING_MS, label);

  if (opts.thread) {
    const thread = await fetchThread(statusId, { extraIds: opts.include });
    const selected = selectThreadTweets(thread, opts.include);
    const caption = (selected[0] && selected[0].tweet.text) || '';
    if (opts.threadStyle === 'carousel') {
      return { buffers: await cap(renderThreadCarousel(selected, opts), 'thread carousel'), ext: 'png', caption };
    }
    const tHtml = renderThreadHtml({ tweets: selected, mainAuthor: thread.mainAuthor }, opts);
    const png = await cap(htmlToPng(tHtml, { scale: opts.scale }), 'thread render');
    return { buffers: [await encodeImage(png, opts.format, opts.quality)], ext: EXT_MAP[opts.format] || 'png', caption };
  }

  const data = await fetchTweet(statusId);
  const caption = data.tweet.text || '';
  const realCarousel = opts.carousel === 'true' || (opts.carousel === 'auto' && opts.aspectRatio !== 'auto');
  if (realCarousel) {
    const slides = await cap(renderCarousel(data, opts), 'carousel render');
    if (slides.length > 1 || opts.carousel === 'true') return { buffers: slides, ext: 'png', caption };
    return { buffers: [await encodeImage(slides[0], opts.format, opts.quality)], ext: EXT_MAP[opts.format] || 'png', caption };
  }
  const png = await cap(htmlToPng(renderHtml(data, opts), { scale: opts.scale }), 'png render');
  return { buffers: [await encodeImage(png, opts.format, opts.quality)], ext: EXT_MAP[opts.format] || 'png', caption };
}

/** Persist buffers to /output and return their public URLs (given a base origin). */
function saveBuffers(buffers, statusId, ext, baseUrl) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const ts = Date.now();
  return buffers.map((b, i) => {
    const filename = `${statusId}-${ts}-${i}.${ext}`;
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), b);
    return `${base}/output/${filename}`;
  });
}

module.exports = { renderToBuffers, saveBuffers, withTimeout, OUTPUT_DIR, EXT_MAP, RENDER_CEILING_MS };
