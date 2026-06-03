'use strict';

const dns = require('dns').promises;
const net = require('net');

/**
 * NaN-safe integer parse with default + optional clamp.
 * Returns `def` when value is missing or not a finite number.
 */
function toInt(value, def, { min, max } = {}) {
  if (value === undefined || value === null || value === '') return def;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return def;
  let out = n;
  if (typeof min === 'number') out = Math.max(min, out);
  if (typeof max === 'number') out = Math.min(max, out);
  return out;
}

/**
 * Whitelist a CSS background/color value. Accepts:
 *   - hex (#rgb, #rrggbb, #rrggbbaa)
 *   - rgb()/rgba()/hsl()/hsla()
 *   - a single linear-gradient(...) / radial-gradient(...) (possibly comma-stacked)
 *   - a handful of plain CSS color keywords
 * Rejects anything containing CSS-context-breaking chars (`;`, `}`, `{`, stray `)`).
 * Returns true if safe to interpolate into `background: <value>;`.
 */
function isSafeCssBackground(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length === 0 || v.length > 2000) return false;
  // Hard reject anything that could break out of the declaration.
  if (/[;{}]/.test(v)) return false;
  if (v.includes('/*') || v.includes('*/')) return false;
  // url() is handled separately (backgroundImage), never via containerBackground.
  if (/url\s*\(/i.test(v)) return false;
  // Parentheses must be balanced (no stray `)` to break the rule).
  let depth = 0;
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth < 0) return false; }
  }
  if (depth !== 0) return false;

  const hex = /^#([0-9a-fA-F]{3,8})$/;
  const func = /^(rgb|rgba|hsl|hsla|linear-gradient|radial-gradient|conic-gradient)\(/i;
  const keyword = /^[a-zA-Z]{3,20}$/; // e.g. "white", "transparent"

  // Allow comma-stacked gradients/colors: each top-level segment must match.
  // Simplest robust check: the whole string starts with an allowed token and
  // contains only chars from a safe set.
  if (!(hex.test(v) || func.test(v) || keyword.test(v))) return false;
  // Safe character set: letters, digits, whitespace, and CSS value punctuation.
  if (!/^[#a-zA-Z0-9\s().,%\-+]*$/.test(v)) return false;
  return true;
}

function isPrivateIpv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true; // treat malformed as unsafe
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;           // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16/12
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true;                          // multicast / reserved
  return false;
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80')) return true;         // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
  if (lower.startsWith('::ffff:')) {                 // IPv4-mapped
    const v4 = lower.split(':').pop();
    if (net.isIPv4(v4)) return isPrivateIpv4(v4);
  }
  return false;
}

/**
 * SSRF guard for caller-supplied URLs (backgroundImage). Requires HTTPS and a
 * public host. Resolves DNS for hostnames and rejects any private/loopback/
 * link-local target. Throws an Error (message safe to surface) on rejection.
 */
async function validateExternalUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid backgroundImage URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('backgroundImage must be an https:// URL');
  }
  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip ipv6 brackets

  const lowerHost = host.toLowerCase();
  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost') ||
      lowerHost.endsWith('.internal') || lowerHost.endsWith('.local')) {
    throw new Error('backgroundImage host is not allowed');
  }

  // Literal IPs: check directly.
  if (net.isIPv4(host)) {
    if (isPrivateIpv4(host)) throw new Error('backgroundImage host is not allowed');
    return raw;
  }
  if (net.isIPv6(host)) {
    if (isPrivateIpv6(host)) throw new Error('backgroundImage host is not allowed');
    return raw;
  }

  // Hostname: resolve and verify every record is public.
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('backgroundImage host could not be resolved');
  }
  for (const { address, family } of addrs) {
    const priv = family === 6 ? isPrivateIpv6(address) : isPrivateIpv4(address);
    if (priv) throw new Error('backgroundImage host is not allowed');
  }
  return raw;
}

const MAX_BG_BYTES = 8 * 1024 * 1024; // 8 MB cap on a background image

/**
 * Safely fetch a caller-supplied background image SERVER-SIDE and return it as a
 * data: URI, so the headless browser never makes the request itself. This closes
 * SSRF via HTTP redirects and most DNS-rebinding (we validate the host, then
 * fetch with redirects disabled, a content-type check, a size cap, and a timeout).
 */
async function fetchImageAsDataUri(rawUrl) {
  await validateExternalUrl(rawUrl); // https + public host (DNS-checked)

  let resp;
  try {
    resp = await fetch(rawUrl, {
      redirect: 'error',                       // any redirect → throw (no SSRF hop)
      signal: AbortSignal.timeout(6000),
      headers: { Accept: 'image/*' },
    });
  } catch {
    throw new Error('backgroundImage could not be fetched');
  }
  if (!resp.ok) throw new Error('backgroundImage fetch failed');

  const ct = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ct.startsWith('image/')) throw new Error('backgroundImage is not an image');

  const len = Number(resp.headers.get('content-length') || 0);
  if (len && len > MAX_BG_BYTES) throw new Error('backgroundImage too large');

  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_BG_BYTES) throw new Error('backgroundImage too large');

  return `data:${ct};base64,${buf.toString('base64')}`;
}

// True only for loopback addresses. Used on the raw TCP peer (req.socket.
// remoteAddress), which — unlike the Host header or X-Forwarded-For — cannot be
// spoofed by a remote client.
function isLoopbackIp(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

module.exports = { toInt, isSafeCssBackground, validateExternalUrl, fetchImageAsDataUri, isLoopbackIp, MAX_BG_BYTES };
