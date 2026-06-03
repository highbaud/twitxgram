'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { fetchTweet, fetchThread, selectThreadTweets } = require('./fetcher');
const { renderHtml, renderThreadHtml } = require('./renderer');
const { htmlToPng, htmlToSvg, encodeImage, getBrowser, closeBrowser } = require('./screenshotter');
const { renderCarousel, renderThreadCarousel } = require('./carousel');
const { listPresets } = require('./backgrounds');
const { toInt, isSafeCssBackground, fetchImageAsDataUri, isLoopbackIp } = require('./validate');
const { extractStatusId } = require('./url');
const { buildScheduledPostPayload, assertBlogAllowed } = require('./metricool');
const metricoolClient = require('./metricoolClient');
const { renderToBuffers, saveBuffers, OUTPUT_DIR } = require('./pipeline');
const watcher = require('./watcher');
const notifier = require('./notifier');
const backgroundStore = require('./backgroundStore');

const app = express();
app.set('trust proxy', 1); // behind a reverse proxy in production
app.disable('x-powered-by');

// Baseline security headers (no external dep). CSP is permissive enough for the
// playground (self scripts, inline styles, images from anywhere + data/blob) while
// blocking framing and content-type sniffing.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // images embeddable elsewhere
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; img-src * data: blob:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'");
  next();
});
const PORT = process.env.PORT || 3030;
const API_KEY = process.env.API_KEY || null;
const OUTPUT_TTL_MS = Number(process.env.OUTPUT_TTL_MS || 24 * 60 * 60 * 1000); // 24h
const RENDER_CEILING_MS = Number(process.env.RENDER_CEILING_MS || 30000);

// ── Caches ──────────────────────────────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Tweet DATA cache: tweetId → { data, ts }
const tweetCache = new Map();
function getCachedTweet(id) {
  const entry = tweetCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { tweetCache.delete(id); return null; }
  return entry.data;
}
function setCachedTweet(id, data) { tweetCache.set(id, { data, ts: Date.now() }); }

// Rendered-IMAGE cache (buffer responses, non-carousel): key → { buf, type, ts }
const RENDER_CACHE_MAX = 200;
const renderCache = new Map();
function renderCacheKey(statusId, opts) {
  const keys = Object.keys(opts).filter(k => k !== 'returnType').sort();
  const raw = statusId + '|' + keys.map(k => `${k}=${opts[k]}`).join('&');
  // Hash so an inlined (data-URI) backgroundImage can't bloat the key.
  return crypto.createHash('sha1').update(raw).digest('hex');
}
function getCachedRender(key) {
  const entry = renderCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { renderCache.delete(key); return null; }
  // refresh LRU position
  renderCache.delete(key);
  renderCache.set(key, entry);
  return entry;
}
function setCachedRender(key, buf, type) {
  renderCache.set(key, { buf, type, ts: Date.now() });
  if (renderCache.size > RENDER_CACHE_MAX) {
    renderCache.delete(renderCache.keys().next().value); // evict oldest
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Constant-time string compare (avoids timing side-channel on the API key).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function auth(req, res, next) {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing X-API-KEY header' });
  if (!safeEqual(key, API_KEY)) return res.status(403).json({ error: 'Invalid API key' });
  next();
}

// Loopback = the real TCP peer is local. Uses the socket address (not req.ip /
// Host / X-Forwarded-For), so a remote client can't spoof its way past.
function isLoopback(req) {
  return isLoopbackIp((req.socket && req.socket.remoteAddress) || '');
}

// Guard for state-changing / outbound-posting / upload endpoints. Requires the
// API key when one is configured; when no key is set, allows only local requests
// so a public deploy can't post to your Metricool or accept uploads anonymously.
function writeGuard(req, res, next) {
  if (API_KEY) return auth(req, res, next);
  if (isLoopback(req)) return next();
  return res.status(403).json({
    error: 'Write endpoints require an API key when reached remotely — set API_KEY.',
  });
}

function parseBool(val, def) {
  if (val === undefined || val === null) return def;
  return val === 'false' ? false : Boolean(val);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const MIME_MAP = { png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXT_MAP  = { png: 'png', svg: 'svg', jpg: 'jpg', jpeg: 'jpg', webp: 'webp' };

// Absolute, publicly-reachable base URL for /output links (Metricool must be able
// to fetch them). Falls back to the request host when PUBLIC_BASE_URL is unset.
function publicHost(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

// Write a buffer to /output and return its public URL.
function saveOutput(buffer, name, ext, req) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filename = `${name}.${ext}`;
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), buffer);
  return `${publicHost(req)}/output/${filename}`;
}

// Send one image as a binary response or as a saved /output URL.
function respondImage(req, res, buffer, statusId, opts, { cacheKey } = {}) {
  if (opts.returnType === 'url') {
    const url = saveOutput(buffer, `${statusId}-${Date.now()}`, EXT_MAP[opts.format] || 'png', req);
    return res.json({ url, format: opts.format, tweetId: statusId });
  }
  const contentType = MIME_MAP[opts.format] || 'image/png';
  if (cacheKey) { setCachedRender(cacheKey, buffer, contentType); res.setHeader('X-Render-Cache', 'MISS'); }
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600'); // deterministic per id+opts
  return res.send(buffer);
}

// Send a multi-image carousel/thread as JSON (data URIs, or saved /output URLs).
function respondCarousel(req, res, slides, statusId, opts) {
  const ts = Date.now();
  const payload = slides.map((buf, i) => {
    const meta = { index: i, total: slides.length };
    if (opts.returnType === 'url') meta.url = saveOutput(buf, `${statusId}-${ts}-${i}`, 'png', req);
    else meta.dataUri = `data:image/png;base64,${buf.toString('base64')}`;
    return meta;
  });
  return res.json({ type: 'carousel', tweetId: statusId, count: slides.length, slides: payload });
}

// Build the render options object from a query/body source (shared by the GET
// screenshot route and the POST publish route).
function buildRenderOpts(q = {}) {
  const opts = {
    format:             ['svg','png','html','jpg','jpeg','webp'].includes(q.format) ? q.format : 'png',
    scale:              toInt(q.scale, 2, { min: 1, max: 3 }),
    quality:            toInt(q.quality, 90, { min: 1, max: 100 }),
    theme:              q.theme === 'dark' ? 'dark' : 'light',
    returnType:         q.returnType === 'url' ? 'url' : 'buffer',
    aspectRatio:        q.aspectRatio || 'auto',
    logo:               ['x','bluebird','none'].includes(q.logo) ? q.logo : 'x',
    showFullText:       parseBool(q.showFullText, true),
    showTimestamp:      parseBool(q.showTimestamp, true),
    showViews:          parseBool(q.showViews, true),
    showStats:          parseBool(q.showStats, true),
    showMeta:           parseBool(q.showMeta, true),
    showMedia:          parseBool(q.showMedia, true),
    shadow:             parseBool(q.shadow, true),
    mediaLayout:        q.mediaLayout === 'vertical' ? 'vertical' : 'grid',
    timeZoneOffset:     q.timeZoneOffset || 'UTC+0',
    background:         q.background || null,
    containerBackground: q.containerBackground || null,
    backgroundImage:    q.backgroundImage || null,
    containerPadding:   toInt(q.containerPadding, 16, { min: 0 }),
    borderRadius:       toInt(q.borderRadius, 16, { min: 0 }),
    width:              toInt(q.width, 410, { min: 300, max: 1000 }),
    carousel:           ['true','auto','false'].includes(q.carousel) ? q.carousel : 'false',
    thread:             parseBool(q.thread, false),
    threadStyle:        q.threadStyle === 'carousel' ? 'carousel' : 'stack',
    include:            q.include ? String(q.include).split(',').map(s => s.trim()).filter(Boolean).slice(0, 20) : [],
    metricool:          parseBool(q.metricool, false),
    networks:           (q.networks || q.network) ? String(q.networks || q.network).split(',').map(s => s.trim()).filter(Boolean) : ['instagram'],
    style:              q.style === 'quote' ? 'quote' : 'tweet',
    quoteFont:          q.quoteFont === 'serif' ? 'serif' : 'sans',
  };
  // showMeta=false drops ALL post meta at once (granular flags still work alone).
  if (opts.showMeta === false) { opts.showTimestamp = false; opts.showStats = false; opts.showViews = false; }
  // Quote-poster is a single-tweet artifact — thread/carousel don't apply.
  if (opts.style === 'quote') { opts.thread = false; opts.carousel = 'false'; }
  return opts;
}

// Render a tweet/thread/carousel to public /output URL(s) via the shared pipeline.
// Used by ?metricool=1 (returns payload) and POST /publish (schedules).
async function produceMediaUrls(req, statusId, opts) {
  const { buffers, ext } = await renderToBuffers(statusId, opts);
  return saveBuffers(buffers, statusId, ext, publicHost(req));
}

// Rate limiter: keyed by API key when auth is on, else by client IP.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT || 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Only bucket by the API key when it's the VALID key — otherwise a forged
    // header would mint a fresh quota per request and bypass the limiter.
    const k = req.headers['x-api-key'];
    if (API_KEY && k && safeEqual(k, API_KEY)) return 'key:primary';
    return ipKeyGenerator(req.ip);
  },
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.get('/api/v1/screenshot/:statusId', limiter, auth, async (req, res) => {
  // Accept a bare ID OR a full tweet URL — via the path param or ?url=.
  let statusId;
  try {
    statusId = extractStatusId(req.query.url || req.params.statusId);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const opts = buildRenderOpts(req.query);

  // Surface real quota from the rate limiter (no more fake 9999s).
  if (req.rateLimit) {
    res.setHeader('X-Quota-Remaining', String(req.rateLimit.remaining));
    res.setHeader('X-Quota-Limit', String(req.rateLimit.limit));
  }

  // ── Input security validation ──
  if (opts.containerBackground && !isSafeCssBackground(opts.containerBackground)) {
    return res.status(400).json({ error: 'Invalid containerBackground value' });
  }
  // SSRF-safe: fetch the background server-side (no redirects, size/type capped)
  // and inline it as a data: URI, so the headless browser never makes the request.
  if (opts.backgroundImage) {
    try {
      opts.backgroundImage = await fetchImageAsDataUri(opts.backgroundImage);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  try {
    // ── Metricool-ready path ── render to PUBLIC URLs + return a ready payload.
    if (opts.metricool) {
      const media = await produceMediaUrls(req, statusId, opts);
      const info = buildScheduledPostPayload({ mediaUrls: media, networks: opts.networks });
      return res.json({ type: 'metricool', tweetId: statusId, count: media.length, media, info });
    }

    // ── Thread path ──
    if (opts.thread) {
      const thread = await fetchThread(statusId, { extraIds: opts.include });
      const selected = selectThreadTweets(thread, opts.include);

      if (opts.threadStyle === 'carousel') {
        const slides = await withTimeout(renderThreadCarousel(selected, opts), RENDER_CEILING_MS, 'thread carousel');
        return respondCarousel(req, res, slides, statusId, opts);
      }
      const tHtml = renderThreadHtml({ tweets: selected, mainAuthor: thread.mainAuthor }, opts);
      if (opts.format === 'html') { res.setHeader('Content-Type', 'text/html'); return res.send(tHtml); }
      const png = await withTimeout(htmlToPng(tHtml, { scale: opts.scale }), RENDER_CEILING_MS, 'thread render');
      const buffer = await encodeImage(png, opts.format, opts.quality);
      return respondImage(req, res, buffer, statusId, opts);
    }

    // Fetch tweet data (with cache)
    let tweetData = getCachedTweet(statusId);
    if (!tweetData) {
      tweetData = await fetchTweet(statusId);
      setCachedTweet(statusId, tweetData);
    }

    const html = renderHtml(tweetData, opts);

    if (opts.format === 'html') {
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    // ── Carousel path ──
    const carouselRequested =
      opts.carousel === 'true' ||
      (opts.carousel === 'auto' && opts.aspectRatio !== 'auto');

    let carouselSingle;
    if (carouselRequested) {
      const slides = await withTimeout(renderCarousel(tweetData, opts), RENDER_CEILING_MS, 'carousel render');
      const isRealCarousel = slides.length > 1 || opts.carousel === 'true';
      if (isRealCarousel) return respondCarousel(req, res, slides, statusId, opts);
      carouselSingle = slides[0]; // auto-carousel that fit in one slide
    }

    // ── Single-image path ──
    // Serve from the render cache for repeat buffer requests (skip url/carousel).
    const cacheable = opts.returnType === 'buffer' && typeof carouselSingle === 'undefined';
    const cKey = cacheable ? renderCacheKey(statusId, opts) : null;
    if (cacheable) {
      const hit = getCachedRender(cKey);
      if (hit) {
        res.setHeader('Content-Type', hit.type);
        res.setHeader('X-Render-Cache', 'HIT');
        return res.send(hit.buf);
      }
    }

    let buffer;
    if (typeof carouselSingle !== 'undefined') {
      buffer = await encodeImage(carouselSingle, opts.format, opts.quality);
    } else if (opts.format === 'svg') {
      buffer = await withTimeout(htmlToSvg(html), RENDER_CEILING_MS, 'svg render');
    } else {
      const png = await withTimeout(htmlToPng(html, { scale: opts.scale }), RENDER_CEILING_MS, 'png render');
      buffer = await encodeImage(png, opts.format, opts.quality); // png passes through; jpg/webp converted
    }

    return respondImage(req, res, buffer, statusId, opts, { cacheKey: cacheable ? cKey : null });

  } catch (err) {
    console.error(`[screenshot] ${statusId}:`, err.stack || err.message);
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ error: 'Tweet not found' });
    }
    if (err.message && err.message.includes('timed out')) {
      return res.status(504).json({ error: 'Render timed out' });
    }
    // Don't leak internal error details (file paths, upstream API internals).
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve saved output files with a sane cache header.
app.use('/output', express.static(OUTPUT_DIR, { maxAge: '1h' }));

// Serve the interactive playground at / (static files won't shadow /api routes).
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve saved custom background images (thumbnails + preview).
app.use('/backgrounds', express.static(backgroundStore.BG_DIR, { maxAge: '7d' }));

// Thread discovery / approval surface: resolve a thread without rendering, so a
// caller (or the playground) can choose which other-account replies to include.
app.get('/api/v1/thread/:statusId', limiter, auth, async (req, res) => {
  let statusId;
  try { statusId = extractStatusId(req.query.url || req.params.statusId); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  try {
    const thread = await fetchThread(statusId);
    res.json({
      mainAuthor: { name: thread.mainAuthor.name, username: thread.mainAuthor.username },
      count: thread.tweets.length,
      tweets: thread.tweets.map(t => ({
        id: t.id,
        isMainAuthor: t.isMainAuthor,
        author: { name: t.author.name, username: t.author.username },
        textPreview: (t.tweet.text || '').slice(0, 140),
      })),
      candidates: thread.candidates, // other-account reply ids needing approval
    });
  } catch (err) {
    console.error(`[thread] ${statusId}:`, err.stack || err.message);
    if (err.message && err.message.includes('not found')) return res.status(404).json({ error: 'Tweet not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List the Metricool brands/blogs on the account (discover blogIds).
app.get('/api/v1/metricool/brands', limiter, auth, async (req, res) => {
  if (!metricoolClient.isConfigured()) {
    return res.status(503).json({ error: 'Metricool not configured (set METRICOOL_USER_TOKEN and METRICOOL_USER_ID)' });
  }
  try {
    res.json({ brands: await metricoolClient.listBrands() });
  } catch (err) {
    console.error('[metricool/brands]', err.status || '', err.message);
    res.status(502).json({ error: 'Could not fetch Metricool brands' });
  }
});

// Schedule a post to Metricool directly from the app (renders → hosts → schedules).
// Body: { url|tweet, text, dateTime, timezone, networks[], blogId, draft, autoPublish, render:{...} }
app.post('/api/v1/publish', limiter, writeGuard, express.json({ limit: '16kb' }), async (req, res) => {
  const body = req.body || {};

  if (!metricoolClient.isConfigured()) {
    return res.status(503).json({ error: 'Metricool not configured (set METRICOOL_USER_TOKEN and METRICOOL_USER_ID)' });
  }
  if (!body.blogId) return res.status(400).json({ error: 'blogId is required' });
  // Fail fast on a blocked target (METRICOOL_BLOCKED_BLOG_IDS) — before any rendering.
  try { assertBlogAllowed(body.blogId); }
  catch (e) { return res.status(403).json({ error: e.message }); }

  let statusId;
  try { statusId = extractStatusId(body.url || body.tweet || body.statusId); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  // Render options come from body.render (same keys as the screenshot query).
  const opts = buildRenderOpts(body.render || {});
  opts.returnType = 'url'; // Metricool needs public URLs

  if (opts.containerBackground && !isSafeCssBackground(opts.containerBackground)) {
    return res.status(400).json({ error: 'Invalid containerBackground value' });
  }
  if (opts.backgroundImage) {
    try { opts.backgroundImage = await fetchImageAsDataUri(opts.backgroundImage); }
    catch (e) { return res.status(400).json({ error: e.message }); }
  }

  try {
    const media = await produceMediaUrls(req, statusId, opts);
    const info = buildScheduledPostPayload({
      mediaUrls: media,
      text: typeof body.text === 'string' ? body.text : '',
      dateTime: body.dateTime || null,
      timezone: body.timezone,
      networks: Array.isArray(body.networks) ? body.networks : opts.networks,
      draft: body.draft !== false,        // default DRAFT for safety
      autoPublish: body.autoPublish === true,
    });
    const result = await metricoolClient.schedulePost({ blogId: body.blogId, info }); // refuses blocked ids
    res.json({ scheduled: true, draft: info.draft, blogId: String(body.blogId), media, info, metricool: result });
  } catch (err) {
    console.error(`[publish] ${statusId}:`, err.status || '', err.stack || err.message);
    if (/blocked/.test(err.message)) return res.status(403).json({ error: err.message });
    if (err.message && err.message.includes('not found')) return res.status(404).json({ error: 'Tweet not found' });
    if (err.message && err.message.includes('timed out')) return res.status(504).json({ error: 'Render timed out' });
    if (err.status) return res.status(502).json({ error: `Metricool rejected the post (${err.status})` });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Watchers (follow an account → auto-draft to Metricool) ──
function watchBaseUrl(req) { return process.env.PUBLIC_BASE_URL || publicHost(req); }

app.get('/api/v1/watches', limiter, auth, (req, res) => {
  res.json({ watches: watcher.listWatches(), metricoolConfigured: metricoolClient.isConfigured() });
});

app.post('/api/v1/watches', limiter, writeGuard, express.json({ limit: '16kb' }), async (req, res) => {
  try {
    const added = await watcher.addWatch(req.body || {});
    res.json({ added });
  } catch (err) {
    if (/blocked/.test(err.message)) return res.status(403).json({ error: err.message });
    if (/required|not found/.test(err.message)) return res.status(400).json({ error: err.message });
    console.error('[watches/add]', err.message);
    res.status(500).json({ error: 'Could not add watch' });
  }
});

app.delete('/api/v1/watches/:username', limiter, writeGuard, (req, res) => {
  res.json({ removed: watcher.removeWatch(req.params.username) });
});

// Manually trigger a poll now (the in-app poller calls this same routine).
app.post('/api/v1/watch/run', limiter, writeGuard, async (req, res) => {
  try {
    res.json(await watcher.runOnce(watchBaseUrl(req)));
  } catch (err) {
    console.error('[watch/run]', err.message);
    res.status(500).json({ error: 'Watch run failed' });
  }
});

// Review-digest status + manual send (the daily scheduler calls the same sender).
app.get('/api/v1/digest', limiter, auth, (req, res) => {
  res.json({ pending: notifier.pendingCount(), channelsConfigured: notifier.anyChannelConfigured() });
});
app.post('/api/v1/digest/run', limiter, writeGuard, async (req, res) => {
  try { res.json(await notifier.sendDigestNow()); }
  catch (err) { console.error('[digest/run]', err.message); res.status(502).json({ error: 'Digest send failed' }); }
});

// List available background presets
app.get('/api/v1/backgrounds', (req, res) => res.json({ presets: listPresets(), custom: backgroundStore.list() }));

// Upload a custom background (base64 data URI) → processed, saved, reusable.
app.post('/api/v1/backgrounds/custom', limiter, writeGuard, express.json({ limit: '16mb' }), async (req, res) => {
  try {
    const entry = await backgroundStore.add({ name: req.body && req.body.name, dataUri: req.body && req.body.dataUri });
    res.json({ added: entry });
  } catch (err) {
    if (/valid|large|limit|Empty/.test(err.message)) return res.status(400).json({ error: err.message });
    console.error('[backgrounds/add]', err.message);
    res.status(500).json({ error: 'Could not save background' });
  }
});

app.delete('/api/v1/backgrounds/custom/:id', limiter, writeGuard, (req, res) => {
  res.json({ removed: backgroundStore.remove(req.params.id) });
});

// Liveness vs readiness
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));
app.get('/health/ready', async (req, res) => {
  try {
    const b = await getBrowser();
    return b && b.isConnected()
      ? res.json({ status: 'ready' })
      : res.status(503).json({ status: 'browser not connected' });
  } catch {
    return res.status(503).json({ status: 'browser unavailable' });
  }
});

// ── Output TTL sweep ──
function sweepOutput() {
  fs.readdir(OUTPUT_DIR, (err, files) => {
    if (err) return; // dir may not exist yet
    const cutoff = Date.now() - OUTPUT_TTL_MS;
    for (const f of files) {
      const fp = path.join(OUTPUT_DIR, f);
      fs.stat(fp, (e, st) => {
        if (!e && st.mtimeMs < cutoff) fs.unlink(fp, () => {});
      });
    }
  });
}

// Boot readiness summary — surfaces misconfig loudly (errors are otherwise
// generic by design, so a missing token would fail silently without this).
function logReadiness() {
  const ok = (b) => (b ? 'OK' : 'MISSING');
  const hasTwitter = Boolean(process.env.TWITTER_BEARER_TOKEN);
  const hasMetricool = metricoolClient.isConfigured();
  const hasPublic = Boolean(process.env.PUBLIC_BASE_URL);
  const lines = [
    `  Twitter token .......... ${ok(hasTwitter)}${hasTwitter ? '' : '  ⚠ all rendering will fail until TWITTER_BEARER_TOKEN is set'}`,
    `  Metricool creds ........ ${hasMetricool ? 'OK' : 'not set'}${hasMetricool ? '' : '  (publish + auto-follow drafting disabled)'}`,
    `  PUBLIC_BASE_URL ........ ${hasPublic ? process.env.PUBLIC_BASE_URL : 'not set'}${(!hasPublic && hasMetricool) ? '  ⚠ Metricool can’t fetch images without a public URL' : ''}`,
    `  API key (auth) ......... ${API_KEY ? 'enabled' : 'DISABLED'}${API_KEY ? '' : '  ⚠ before exposing publicly, set API_KEY — /publish, /watches & uploads are otherwise open'}`,
    `  Review notifications ... ${notifier.anyChannelConfigured() ? 'enabled' : 'off'}`,
  ];
  console.log(`TwitXGram running at http://localhost:${PORT}\nReadiness:\n${lines.join('\n')}`);
}

// ── Boot ──
const server = app.listen(PORT, async () => {
  logReadiness();
  try { await getBrowser(); console.log('Chromium warmed up.'); }
  catch (e) { console.error('Browser warmup failed:', e.message); }
  sweepOutput();
});

const sweepTimer = setInterval(sweepOutput, 60 * 60 * 1000);
sweepTimer.unref();

// ── Watcher poller ── poll followed accounts and auto-draft new tweets.
const WATCH_INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS || 5 * 60 * 1000); // 5 min
const WATCH_ENABLED = process.env.WATCH_ENABLED !== 'false';
if (WATCH_ENABLED) {
  const base = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
  const tick = () => watcher.runOnce(base)
    .then(r => { if (r && r.drafted) console.log(`[watcher] drafted ${r.drafted} post(s)`); })
    .catch(e => console.error('[watcher]', e.message));
  const watchTimer = setInterval(tick, Math.max(60 * 1000, WATCH_INTERVAL_MS));
  watchTimer.unref();
}

// ── Daily review digest ── checks every 15 min, fires once past DIGEST_HOUR.
if (notifier.anyChannelConfigured()) {
  const digestTimer = setInterval(
    () => notifier.maybeSendDigest().catch(e => console.error('[digest]', e.message)),
    15 * 60 * 1000,
  );
  digestTimer.unref();
  console.log('[digest] review notifications enabled.');
}

// ── Graceful shutdown ──
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down…`);
  server.close(async () => {
    await closeBrowser();
    process.exit(0);
  });
  // Hard exit if draining hangs.
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

module.exports = { app, server };
