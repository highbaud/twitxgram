'use strict';

// Hosts we accept a /status/<id> path from (X + common mirrors/proxies).
const TWEET_HOSTS = new Set([
  'twitter.com', 'www.twitter.com', 'mobile.twitter.com',
  'x.com', 'www.x.com', 'mobile.x.com',
  'vxtwitter.com', 'fxtwitter.com', 'fixupx.com', 'fixvx.com',
  'nitter.net',
]);

/**
 * Resolve a tweet status ID from either a bare numeric ID or a tweet URL.
 * Accepts:
 *   123456789012345678
 *   https://x.com/jack/status/20
 *   https://twitter.com/u/status/20?s=46&t=xyz
 *   http://www.fxtwitter.com/u/status/20/photo/1
 *   x.com/u/status/20            (scheme optional)
 * Throws on anything else.
 */
function extractStatusId(input) {
  if (input === undefined || input === null) throw new Error('Missing tweet ID or URL');
  const raw = String(input).trim();

  // Bare numeric ID.
  if (/^\d{1,25}$/.test(raw)) return raw;

  // Try to parse as a URL (tolerate a missing scheme).
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error('Invalid tweet ID or URL');
  }

  const host = url.hostname.toLowerCase();
  if (!TWEET_HOSTS.has(host)) {
    throw new Error(`Unsupported host "${url.hostname}" — provide an x.com/twitter.com tweet URL or a numeric ID`);
  }

  // .../status/<id>  or  .../statuses/<id>
  const m = url.pathname.match(/\/status(?:es)?\/(\d{1,25})/);
  if (!m) throw new Error('Could not find a /status/<id> in the URL');
  return m[1];
}

module.exports = { extractStatusId, TWEET_HOSTS };
