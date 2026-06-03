'use strict';

/*
 * Metricool-ready output helpers.
 *
 * This service does NOT call Metricool directly — scheduling goes through the
 * Metricool MCP tool `createScheduledPost(blogId, date, info)` (the same path
 * Shortsmith uses). Our job is to produce (1) public media URLs and (2) a valid
 * `info` payload skeleton the caller fills with text/date/blogId.
 */

// Optional safety guard: blog IDs that must NEVER be posted to. Configure via
// METRICOOL_BLOCKED_BLOG_IDS (comma-separated). Empty by default — set it to any
// brand you want to be impossible to publish/draft to (e.g. a client you manage
// but must not auto-post to).
function blockedBlogIds() {
  const fromEnv = (process.env.METRICOOL_BLOCKED_BLOG_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return new Set(fromEnv);
}

/**
 * Throw if a blogId is on the block list. Call this before any scheduling.
 */
function assertBlogAllowed(blogId) {
  if (blogId == null) throw new Error('blogId is required');
  if (blockedBlogIds().has(String(blogId))) {
    throw new Error(`blogId ${blogId} is blocked and must not be posted to`);
  }
  return String(blogId);
}

const VALID_NETWORKS = new Set([
  'instagram', 'facebook', 'twitter', 'tiktok', 'youtube', 'linkedin', 'threads', 'pinterest', 'gmb',
]);

/**
 * Build the Metricool `createScheduledPost` `info` payload.
 * Multiple mediaUrls → a multi-image (carousel) post. Defaults to DRAFT so
 * nothing auto-publishes by accident — the caller flips `draft`/`autoPublish`.
 */
function buildScheduledPostPayload({
  mediaUrls,
  text = '',
  dateTime = null,
  timezone = process.env.METRICOOL_TZ || 'America/Chicago',
  networks = ['instagram'],
  draft = true,
  autoPublish = false,
} = {}) {
  if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) {
    throw new Error('mediaUrls must be a non-empty array of public image URLs');
  }
  const nets = (networks || ['instagram'])
    .map(n => String(n).toLowerCase().trim())
    .filter(n => VALID_NETWORKS.has(n));
  if (nets.length === 0) throw new Error('No valid networks specified');

  const info = {
    autoPublish,
    draft,
    text,
    media: mediaUrls,
    mediaAltText: [],
    shortener: false,
    providers: nets.map(network => ({ network })),
  };
  if (dateTime) info.publicationDate = { dateTime, timezone };
  return info;
}

module.exports = { buildScheduledPostPayload, assertBlogAllowed, blockedBlogIds, VALID_NETWORKS };
