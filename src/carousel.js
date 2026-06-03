'use strict';

const { renderHtml, INDICATOR_RESERVE } = require('./renderer');
const { getBrowser, fitCardToFrame, waitForImages, OP_TIMEOUT_MS } = require('./screenshotter');
const { toInt } = require('./validate');
const { withLimit } = require('./limit');

// height / width factor for each aspect ratio
const RATIO_FACTOR = { '1:1': 1, '4:5': 1.25, '5:4': 0.8, '16:9': 9/16, '9:16': 16/9 };
const MAX_SLIDES = 12;

/**
 * Split the tweet text into page-sized chunks by measuring real rendered
 * height in the page. Breaks are chosen at the most logical boundary that
 * still fits: paragraph (blank line) → sentence (. ! ?) → newline → word.
 * This keeps each slide starting on a clean thought instead of mid-sentence.
 */
async function paginateText(page, fullText, textWidth, budget) {
  return await page.evaluate(({ fullText, textWidth, budget }) => {
    const m = document.createElement('div');
    m.className = 'tweet-text';
    m.style.position = 'absolute';
    m.style.visibility = 'hidden';
    m.style.left = '-9999px';
    m.style.width = textWidth + 'px';
    m.style.whiteSpace = 'pre-wrap';
    document.body.appendChild(m);

    const fits = (s) => { m.textContent = s; return m.scrollHeight <= budget; };

    // Break the text into sentence/paragraph-ish segments, KEEPING the trailing
    // punctuation and whitespace so reflow + newlines are preserved. Each segment
    // runs up to and including a `.`/`!`/`?` (＋ any closing quote/bracket) or a
    // run of newlines, or the end of the string.
    const segments = fullText.match(/[^.!?\n]*(?:[.!?]+["')\]]*\s*|\n+|$)/g)
      ?.filter(s => s.length > 0) || [fullText];

    const pages = [];
    let current = '';

    // Fallback: pack a single over-long segment word by word.
    const packWordwise = (text) => {
      const words = text.split(/(\s+)/);
      for (const w of words) {
        const cand = current + w;
        if (current.trim() === '' || fits(cand)) current = cand;
        else { pages.push(current.trim()); current = w.replace(/^\s+/, ''); }
      }
    };

    for (const seg of segments) {
      const candidate = current + seg;
      if (current.trim() === '' || fits(candidate)) {
        current = candidate;                 // segment fits on the current slide
      } else if (fits(seg)) {
        pages.push(current.trim());          // clean break: start a new slide here
        current = seg;
      } else {
        if (current.trim()) { pages.push(current.trim()); current = ''; }
        packWordwise(seg);                   // a single sentence too long for a slide
      }
    }
    if (current.trim()) pages.push(current.trim());

    m.remove();
    return pages;
  }, { fullText, textWidth, budget });
}

/**
 * Render a long tweet as a multi-slide carousel.
 * Returns an array of PNG buffers (one per slide). A single-element array
 * means the whole tweet fit in one slide.
 */
async function renderCarousel(data, opts) {
  return withLimit(async () => {
  const browser = await getBrowser();
  const context = await browser.newContext({ deviceScaleFactor: Math.min(3, Math.max(1, opts.scale || 2)) });
  context.setDefaultTimeout(OP_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(OP_TIMEOUT_MS);
  const page = await context.newPage();

  try {
    const width = toInt(opts.width, 410, { min: 300, max: 1000 });
    // Mirror the renderer's shadow-aware minimum padding so the text budget
    // matches what actually gets rendered.
    const shadow = opts.shadow !== false;
    const padding = Math.max(toInt(opts.containerPadding, 16, { min: 0 }), shadow ? 28 : 0);
    const ratio = (opts.aspectRatio && opts.aspectRatio !== 'auto') ? opts.aspectRatio : '4:5';
    const factor = RATIO_FACTOR[ratio] || 1.25;
    const frameH = Math.round(width * factor);
    // Top pad + reserved indicator band at the bottom (matches renderer layout).
    const availCardH = frameH - padding - INDICATOR_RESERVE;

    // 1. Probe: render one slide with footer + empty text to measure "chrome"
    //    (everything that isn't the tweet text) and the text column width.
    const probeOpts = {
      ...opts,
      aspectRatio: ratio,
      slide: { index: 0, total: 2, text: '​', isFirst: true, isLast: true },
    };
    await page.setContent(renderHtml(data, probeOpts), { waitUntil: 'load' });
    await waitForImages(page);

    const metrics = await page.evaluate(() => {
      const card = document.querySelector('.tweet-card');
      const text = document.querySelector('.tweet-text');
      return {
        chrome: card.scrollHeight - text.scrollHeight,
        textWidth: text.clientWidth,
      };
    });

    const textBudget = Math.max(80, availCardH - metrics.chrome - 20);

    // 2. Paginate
    let pages = await paginateText(page, data.tweet.text || '', metrics.textWidth, textBudget);
    if (pages.length === 0) pages = [''];
    if (pages.length > MAX_SLIDES) {
      // collapse overflow into the last allowed slide
      const head = pages.slice(0, MAX_SLIDES - 1);
      const tail = pages.slice(MAX_SLIDES - 1).join(' ');
      pages = [...head, tail];
    }

    // 3. Render each slide
    const slides = [];
    for (let i = 0; i < pages.length; i++) {
      const slideOpts = {
        ...opts,
        aspectRatio: ratio,
        slide: {
          index: i,
          total: pages.length,
          text: pages[i],
          isFirst: i === 0,
          isLast: i === pages.length - 1,
        },
      };
      await page.setContent(renderHtml(data, slideOpts), { waitUntil: 'load' });
      await waitForImages(page);
      await fitCardToFrame(page); // safety net for last slide's media/footer
      const el = await page.$('.container');
      const buf = await el.screenshot({ type: 'png', omitBackground: true });
      slides.push(buf);
    }

    return slides;
  } finally {
    await context.close();
  }
  });
}

/**
 * Render a thread as a carousel — one full tweet per slide, with a swipe
 * indicator. `items` = [{ tweet, author, media, quoteTweet }] oldest→newest.
 * Returns an array of PNG buffers.
 */
async function renderThreadCarousel(items, opts) {
  return withLimit(async () => {
  const browser = await getBrowser();
  const context = await browser.newContext({ deviceScaleFactor: Math.min(3, Math.max(1, opts.scale || 2)) });
  context.setDefaultTimeout(OP_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(OP_TIMEOUT_MS);
  const page = await context.newPage();

  try {
    const ratio = (opts.aspectRatio && opts.aspectRatio !== 'auto') ? opts.aspectRatio : '4:5';
    const total = items.length;
    const slides = [];
    for (let i = 0; i < total; i++) {
      const slideOpts = {
        ...opts,
        aspectRatio: ratio,
        slide: { index: i, total, isFirst: i === 0, isLast: i === total - 1, fullTweet: true },
      };
      await page.setContent(renderHtml(items[i], slideOpts), { waitUntil: 'load' });
      await waitForImages(page);
      await fitCardToFrame(page);
      const el = await page.$('.container');
      slides.push(await el.screenshot({ type: 'png', omitBackground: true }));
    }
    return slides;
  } finally {
    await context.close();
  }
  });
}

module.exports = { renderCarousel, renderThreadCarousel };
