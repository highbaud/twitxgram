'use strict';

/*
 * Watchers — follow Twitter accounts and, when they post, auto-render the tweet
 * (or whole self-thread) and create a Metricool DRAFT for review. In-app poller.
 *
 * Safety: drafts only (never auto-publishes); dedupes by conversation so a thread
 * is drafted once; advances a per-watch since_id so nothing is reprocessed.
 */

const path = require('path');
const fs = require('fs');
const { fetchUserId, fetchTimeline } = require('./fetcher');
const { renderToBuffers, saveBuffers } = require('./pipeline');
const { buildScheduledPostPayload, assertBlogAllowed } = require('./metricool');
const metricoolClient = require('./metricoolClient');
const notifier = require('./notifier');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'watches.json');
const MAX_PER_POLL = Number(process.env.WATCH_MAX_PER_POLL || 8);
const PROCESSED_CAP = 500;

let state = null;
function load() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { state = { watches: [] }; }
  if (!Array.isArray(state.watches)) state.watches = [];
  return state;
}
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function listWatches() {
  return load().watches.map(w => ({
    username: w.username, userId: w.userId, blogId: w.blogId, networks: w.networks,
    enabled: w.enabled !== false, sinceId: w.sinceId || null, render: w.render || {},
    lastRun: w.lastRun || null, lastError: w.lastError || null,
  }));
}

async function addWatch({ username, blogId, networks = ['instagram'], render = {} }) {
  load();
  if (!username) throw new Error('username is required');
  if (!blogId) throw new Error('blogId is required');
  assertBlogAllowed(blogId); // refuse blocked targets up front
  const handle = String(username).trim().replace(/^@/, '');
  const userId = await fetchUserId(handle);
  const existing = state.watches.find(w => w.userId === userId);
  const watch = existing || { processedConversations: [] };
  Object.assign(watch, {
    username: handle, userId, blogId: String(blogId),
    networks: Array.isArray(networks) ? networks : [networks],
    render, enabled: true,
  });
  if (!existing) state.watches.push(watch);
  save();
  return { username: handle, userId, blogId: String(blogId) };
}

function removeWatch(username) {
  load();
  const handle = String(username).trim().replace(/^@/, '');
  const before = state.watches.length;
  state.watches = state.watches.filter(w => w.username !== handle);
  save();
  return state.watches.length < before;
}

/**
 * PURE: given a newest-first timeline + watch state, decide what to render.
 * Returns ordered jobs (oldest→newest) of new conversations to process, each
 * tagged isThread, plus the highest tweet id seen. No network / side effects.
 */
function planConversations(tweets, { userId, processedConversations = [], threadEnabled = true }) {
  if (!tweets || !tweets.length) return { jobs: [], maxSeenId: null };
  const seen = new Set(processedConversations.map(String));
  const oldestFirst = [...tweets].reverse();

  // Drop replies to OTHER accounts (keep originals + self-replies).
  const mine = oldestFirst.filter(t => !t.in_reply_to_user_id || String(t.in_reply_to_user_id) === String(userId));

  // Group by conversation, preserving first-seen order.
  const groups = new Map();
  for (const t of mine) {
    const cid = String(t.conversation_id || t.id);
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid).push(t);
  }

  const jobs = [];
  for (const [cid, group] of groups) {
    if (seen.has(cid)) continue;
    const maxId = group.reduce((m, t) => (BigInt(t.id) > BigInt(m) ? t.id : m), group[0].id);
    const rep = group.find(t => t.id === maxId) || group[group.length - 1];
    const isThread = threadEnabled &&
      (group.length > 1 || (rep.conversation_id && String(rep.conversation_id) !== String(rep.id)));
    jobs.push({ conversationId: cid, renderId: maxId, isThread, maxId });
  }
  jobs.sort((a, b) => (BigInt(a.maxId) < BigInt(b.maxId) ? -1 : 1));
  const maxSeenId = tweets.reduce((m, t) => (BigInt(t.id) > BigInt(m) ? t.id : m), tweets[0].id);
  return { jobs, maxSeenId };
}

function watchRenderOpts(watch, isThread) {
  const r = watch.render || {};
  const showMeta = r.showMeta !== false;
  return {
    format: r.format || 'png', scale: r.scale || 2, quality: 90,
    theme: r.theme === 'dark' ? 'dark' : 'light',
    aspectRatio: r.aspectRatio || 'auto', logo: r.logo || 'x',
    showFullText: true,
    showTimestamp: showMeta, showViews: showMeta, showStats: showMeta, showMeta, showMedia: true,
    shadow: r.shadow !== false, mediaLayout: 'grid', timeZoneOffset: r.timeZoneOffset || 'UTC+0',
    background: r.background || null, containerBackground: null, backgroundImage: null,
    containerPadding: r.containerPadding ?? 16, borderRadius: r.borderRadius ?? 16, width: r.width || 410,
    carousel: 'false', thread: !!isThread,
    threadStyle: r.threadStyle === 'carousel' ? 'carousel' : 'stack', include: [],
    style: r.style === 'quote' ? 'quote' : 'tweet', quoteFont: r.quoteFont === 'serif' ? 'serif' : 'sans',
  };
}

async function processWatch(watch, baseUrl) {
  const tweets = await fetchTimeline(watch.userId, { sinceId: watch.sinceId, max: 30 });
  const { jobs } = planConversations(tweets, {
    userId: watch.userId,
    processedConversations: watch.processedConversations || [],
    threadEnabled: true,
  });

  let drafted = 0;
  for (const job of jobs.slice(0, MAX_PER_POLL)) {
    try {
      const opts = watchRenderOpts(watch, job.isThread);
      const { buffers, ext, caption } = await renderToBuffers(job.renderId, opts);
      const media = saveBuffers(buffers, job.renderId, ext, baseUrl);
      const info = buildScheduledPostPayload({
        mediaUrls: media, text: caption || '', networks: watch.networks,
        draft: true, autoPublish: false,
      });
      await metricoolClient.schedulePost({ blogId: watch.blogId, info });

      // Queue a review nudge (batched into the daily digest).
      notifier.queueDraft({
        username: watch.username, blogId: watch.blogId, tweetId: job.renderId,
        caption, isThread: job.isThread, media,
      });

      // Advance only after success (monotonic) so a failure can retry next poll.
      watch.sinceId = job.maxId;
      watch.processedConversations = [...(watch.processedConversations || []), job.conversationId].slice(-PROCESSED_CAP);
      drafted++;
    } catch (e) {
      watch.lastError = e.message;
      break; // preserve ordering; retry from here next poll
    }
  }
  watch.lastRun = new Date().toISOString();
  if (drafted) watch.lastError = null;
  return drafted;
}

/** Poll every enabled watch once. `baseUrl` must be publicly reachable for Metricool. */
async function runOnce(baseUrl) {
  load();
  if (!metricoolClient.isConfigured()) return { ran: 0, drafted: 0, skipped: 'metricool-unconfigured' };
  let drafted = 0, ran = 0;
  for (const watch of state.watches) {
    if (watch.enabled === false) continue;
    ran++;
    try { drafted += await processWatch(watch, baseUrl); }
    catch (e) { watch.lastError = e.message; }
  }
  save();
  return { ran, drafted };
}

module.exports = {
  listWatches, addWatch, removeWatch, runOnce, planConversations, watchRenderOpts,
  STATE_FILE, MAX_PER_POLL,
};
