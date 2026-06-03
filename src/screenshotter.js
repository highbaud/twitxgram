'use strict';

const { chromium } = require('playwright');
const sharp = require('sharp');
const { withLimit } = require('./limit');

let browser = null;

// Per-operation Playwright timeout (selectors, screenshots, setContent).
const OP_TIMEOUT_MS = 8000;
// Hard cap on waiting for images to decode, so a slow/broken CDN can't hang us.
const IMAGE_WAIT_CAP_MS = 3000;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

/**
 * Wait for in-page images to decode, but never longer than `capMs`. Replaces a
 * fixed sleep so we don't block forever on a broken/slow image URL.
 */
async function waitForImages(page, capMs = IMAGE_WAIT_CAP_MS) {
  await page.evaluate(async (cap) => {
    const imgs = Array.from(document.images);
    const decodes = imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return img.decode().catch(() => {}); // ignore decode failures
    });
    const timeout = new Promise((r) => setTimeout(r, cap));
    await Promise.race([Promise.all(decodes), timeout]);
  }, capMs);
}

/**
 * Fit-to-frame: if the container has a fixed height (forced aspect ratio) and
 * the card overflows it, scale the card down so the WHOLE tweet fits — never
 * chopped. No-op when the container is auto-height (card already fits).
 */
async function fitCardToFrame(page) {
  await page.evaluate(() => {
    const container = document.querySelector('.container');
    const card = document.querySelector('.stack') || document.querySelector('.tweet-card');
    if (!container || !card) return;

    const cs = getComputedStyle(container);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padRight = parseFloat(cs.paddingRight) || 0;

    const availH = container.clientHeight - padTop - padBottom;
    const availW = container.clientWidth - padLeft - padRight;
    if (availH <= 0) return;

    const naturalH = card.scrollHeight;
    const naturalW = card.scrollWidth;
    if (naturalH <= availH && naturalW <= availW) return; // already fits

    const scale = Math.min(availH / naturalH, availW / naturalW, 1);
    card.style.transform = `scale(${scale})`;
  });
}

async function newPreparedContext(deviceScaleFactor) {
  const b = await getBrowser();
  const context = await b.newContext({ deviceScaleFactor });
  context.setDefaultTimeout(OP_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(OP_TIMEOUT_MS);
  return context;
}

async function htmlToPng(html, { scale = 2 } = {}) {
  return withLimit(async () => {
  const dsf = Math.min(3, Math.max(1, scale || 2));
  const context = await newPreparedContext(dsf);
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await waitForImages(page);
    await fitCardToFrame(page);

    const element = await page.$('.container');
    if (!element) throw new Error('Could not find .container element in rendered HTML');

    return await element.screenshot({ type: 'png', omitBackground: true });
  } finally {
    await context.close();
  }
  });
}

/**
 * Convert a PNG buffer to another raster format. PNG passes through untouched;
 * jpg/jpeg and webp are re-encoded via sharp (jpg gets a white matte since it
 * has no alpha). Used for smaller, social-ready files.
 */
async function encodeImage(pngBuffer, format, quality = 90) {
  const q = Math.min(100, Math.max(1, quality || 90));
  if (format === 'jpg' || format === 'jpeg') {
    return sharp(pngBuffer).flatten({ background: '#ffffff' }).jpeg({ quality: q }).toBuffer();
  }
  if (format === 'webp') {
    return sharp(pngBuffer).webp({ quality: q }).toBuffer();
  }
  return pngBuffer; // png
}

async function htmlToSvg(html) {
  return withLimit(async () => {
  // Wrap the rendered HTML snapshot in a foreignObject SVG.
  const context = await newPreparedContext(1);
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await waitForImages(page);
    await fitCardToFrame(page);

    const element = await page.$('.container');
    if (!element) throw new Error('Could not find .container element');

    const box = await element.boundingBox();
    const w = Math.ceil(box.width);
    const h = Math.ceil(box.height);

    const cardHtml = await page.evaluate(() => {
      const el = document.querySelector('.container');
      return el ? el.outerHTML : '';
    });

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml"
     width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <foreignObject width="${w}" height="${h}">
    <xhtml:div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;">
      ${cardHtml}
    </xhtml:div>
  </foreignObject>
</svg>`;

    return Buffer.from(svg, 'utf8');
  } finally {
    await context.close();
  }
  });
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

module.exports = {
  htmlToPng, htmlToSvg, encodeImage, closeBrowser, getBrowser, fitCardToFrame, waitForImages,
  OP_TIMEOUT_MS, IMAGE_WAIT_CAP_MS,
};
