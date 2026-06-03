'use strict';

const { TwitterApi } = require('twitter-api-v2');

let client = null;

function getClient() {
  if (!client) {
    const token = process.env.TWITTER_BEARER_TOKEN;
    if (!token) throw new Error('TWITTER_BEARER_TOKEN not set in environment');
    client = new TwitterApi(token);
  }
  return client.readOnly;
}

async function fetchTweet(tweetId) {
  const api = getClient();

  const result = await api.v2.singleTweet(tweetId, {
    'tweet.fields': [
      'text', 'created_at', 'author_id', 'public_metrics',
      'attachments', 'entities', 'lang', 'possibly_sensitive'
    ],
    'expansions': [
      'author_id', 'attachments.media_keys',
      'referenced_tweets.id', 'referenced_tweets.id.author_id'
    ],
    'user.fields': [
      'name', 'username', 'profile_image_url', 'verified',
      'verified_type', 'public_metrics', 'description'
    ],
    'media.fields': [
      'url', 'preview_image_url', 'type', 'width', 'height',
      'alt_text', 'variants'
    ],
  });

  if (!result.data) throw new Error('Tweet not found');

  const tweet = result.data;
  const includes = result.includes || {};

  // Twitter returns the tiny 48px `_normal` avatar by default; request the
  // larger variant so it stays crisp at 2× device scale.
  const upscaleAvatar = (user) => {
    if (user && typeof user.profile_image_url === 'string') {
      user.profile_image_url = user.profile_image_url.replace('_normal', '_400x400');
    }
    return user;
  };
  const mediaFor = (t) => {
    const keys = t?.attachments?.media_keys || [];
    return (includes.media || []).filter(m => keys.includes(m.media_key));
  };

  // Resolve author
  const author = upscaleAvatar((includes.users || []).find(u => u.id === tweet.author_id) || {});

  // Resolve media
  const mediaItems = mediaFor(tweet);

  // Resolve quote tweet if present
  let quoteTweet = null;
  const quotedRef = (tweet.referenced_tweets || []).find(r => r.type === 'quoted');
  if (quotedRef) {
    const qtData = (includes.tweets || []).find(t => t.id === quotedRef.id);
    if (qtData) {
      const qtAuthor = upscaleAvatar((includes.users || []).find(u => u.id === qtData.author_id) || {});
      quoteTweet = { tweet: qtData, author: qtAuthor, media: mediaFor(qtData) };
    }
  }

  return { tweet, author, media: mediaItems, quoteTweet };
}

/**
 * Reconstruct a thread by walking `replied_to` ancestors UP from the given
 * tweet to the conversation root. Robust on every API tier (no search needed):
 * the user typically pastes the LAST tweet of a thread and we rebuild upward.
 *
 * Returns { mainAuthor, tweets[], candidates[] } where:
 *   - tweets are ordered oldest→newest, each tagged { id, isMainAuthor }.
 *   - mainAuthor is the author of the REQUESTED tweet.
 *   - candidates = ids of tweets NOT by the main author (replies from other
 *     accounts) — these render only when explicitly approved by the caller.
 */
// Dedupe thread nodes by id and order oldest→newest (pure; tweet ids are
// monotonic snowflakes, so numeric id order == chronological order).
function dedupeSortNodes(nodes) {
  const byId = new Map();
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

async function fetchThread(statusId, { maxDepth = 25, extraIds = [] } = {}) {
  const head = await fetchTweet(statusId);
  const mainAuthorId = head.author.id || head.tweet.author_id;

  const chain = [head];
  let cur = head;
  for (let depth = 0; depth < maxDepth; depth++) {
    const repliedTo = (cur.tweet.referenced_tweets || []).find(r => r.type === 'replied_to');
    if (!repliedTo) break;
    let parent;
    try { parent = await fetchTweet(repliedTo.id); }
    catch { break; } // deleted/protected ancestor → stop gracefully
    chain.push(parent);
    cur = parent;
  }

  // Explicitly-included replies (e.g. pasted by the user) that aren't on the
  // ancestor chain — fetch and merge them so they actually render.
  const have = new Set(chain.map(n => n.tweet.id));
  for (const id of extraIds || []) {
    if (!id || have.has(String(id))) continue;
    try { const node = await fetchTweet(String(id)); chain.push(node); have.add(node.tweet.id); }
    catch { /* skip unfetchable include */ }
  }

  const tweets = dedupeSortNodes(chain.map(n => ({
    ...n,
    id: n.tweet.id,
    isMainAuthor: (n.author.id || n.tweet.author_id) === mainAuthorId,
  })));

  const candidates = tweets.filter(t => !t.isMainAuthor).map(t => t.id);
  return { mainAuthor: head.author, tweets, candidates };
}

/**
 * Filter a thread to the tweets that should actually render: every main-author
 * tweet, plus only the other-account replies whose ids the caller approved.
 * Pure — safe to unit-test without an API token.
 */
function selectThreadTweets(thread, includeIds = []) {
  const inc = new Set((includeIds || []).map(String));
  return (thread.tweets || []).filter(t => t.isMainAuthor || inc.has(String(t.id)));
}

/** Resolve a @username (or bare handle) to its numeric user id. */
async function fetchUserId(username) {
  const api = getClient();
  const handle = String(username).trim().replace(/^@/, '');
  const u = await api.v2.userByUsername(handle);
  if (!u || !u.data) throw new Error(`Account @${handle} not found`);
  return u.data.id;
}

/**
 * Fetch an account's recent tweets (newest first), excluding retweets. Returns
 * lightweight descriptors — enough to filter/group; rendering uses fetchTweet/
 * fetchThread by id. `sinceId` returns only tweets newer than it.
 */
async function fetchTimeline(userId, { sinceId, max = 20 } = {}) {
  const api = getClient();
  const params = {
    max_results: Math.min(100, Math.max(5, max)),
    exclude: ['retweets'],
    'tweet.fields': ['created_at', 'author_id', 'conversation_id', 'in_reply_to_user_id', 'referenced_tweets'],
  };
  if (sinceId) params.since_id = sinceId;
  const res = await api.v2.userTimeline(userId, params);
  return res.tweets || []; // newest-first
}

module.exports = { fetchTweet, fetchThread, selectThreadTweets, dedupeSortNodes, fetchUserId, fetchTimeline };
