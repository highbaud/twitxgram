'use strict';

const fs = require('fs');
const path = require('path');
const { resolveBackground } = require('./backgrounds');
const { toInt } = require('./validate');

const TEMPLATE = fs.readFileSync(
  path.join(__dirname, 'templates', 'tweet.html'),
  'utf8'
);

const X_LOGO = `<svg class="logo" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.254 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" fill="currentColor"/>
</svg>`;

const BLUEBIRD_LOGO = `<svg class="logo" width="28" height="24" viewBox="0 0 300 250" fill="none">
  <path d="M282 2.5c-13.7 6.1-28.4 10.2-43.8 12C252 6.7 262 -7.1 268.2-22c-15.4 9.1-32.4 15.7-50.5 19.2C203-18.8 183.1-27 161-27c-43.1 0-78 35-78 78.1 0 6.1.7 12.1 2 17.8C55.3 65.5 13.4 44 -14 10.5c-6.7 11.5-10.5 24.8-10.5 39 0 27.1 13.8 51 34.7 65-12.8-.4-24.8-3.9-35.3-9.8v1c0 37.8 26.9 69.4 62.6 76.5-6.5 1.8-13.4 2.7-20.5 2.7-5 0-9.9-.5-14.6-1.4 9.9 30.8 38.5 53.2 72.5 53.9-26.5 20.8-60 33.1-96.3 33.1-6.3 0-12.4-.4-18.5-1.1 34.3 22 75 34.9 118.7 34.9 142.4 0 220.4-118 220.4-220.4 0-3.4-.1-6.7-.2-10C264.7 31.2 274.6 17.6 282 2.5z" fill="currentColor"/>
</svg>`;

const VERIFIED_BLUE = `<span class="verified-badge badge-blue"><svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.9-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.9 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg></span>`;
const VERIFIED_GOLD  = `<span class="verified-badge badge-gold"><svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.9-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.9 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg></span>`;

function formatNumber(n) {
  if (!n && n !== 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function formatDate(isoString, tzOffsetStr) {
  const d = new Date(isoString);
  const offsetMatch = (tzOffsetStr || 'UTC+0').match(/UTC([+-]\d+(?:\.\d+)?)/);
  const offsetHours = offsetMatch ? parseFloat(offsetMatch[1]) : 0;
  const utcMs = d.getTime() + offsetHours * 3600000;
  const local = new Date(utcMs);

  const hours = local.getUTCHours();
  const minutes = local.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${h}:${minutes} ${ampm} · ${months[local.getUTCMonth()]} ${local.getUTCDate()}, ${local.getUTCFullYear()}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTextWithEntities(text, entities) {
  if (!entities) return escapeHtml(text);

  // Build replacements list sorted by start index
  const replacements = [];

  (entities.mentions || []).forEach(e => {
    replacements.push({ start: e.start, end: e.end, html: `<span class="mention">@${escapeHtml(e.username)}</span>` });
  });
  (entities.hashtags || []).forEach(e => {
    replacements.push({ start: e.start, end: e.end, html: `<span class="hashtag">#${escapeHtml(e.tag)}</span>` });
  });
  (entities.urls || []).forEach(e => {
    // Hide t.co/media URLs (twitter pic links at end)
    const display = e.display_url || e.url;
    if (display.startsWith('pic.twitter') || display.startsWith('pic.x.com')) {
      replacements.push({ start: e.start, end: e.end, html: '' });
    } else {
      replacements.push({ start: e.start, end: e.end, html: `<span class="url">${escapeHtml(display)}</span>` });
    }
  });

  replacements.sort((a, b) => a.start - b.start);

  let result = '';
  let cursor = 0;
  const chars = [...text]; // handle unicode properly

  for (const r of replacements) {
    result += escapeHtml(chars.slice(cursor, r.start).join(''));
    result += r.html;
    cursor = r.end;
  }
  result += escapeHtml(chars.slice(cursor).join(''));
  return result;
}

function buildMediaHtml(media, opts) {
  if (!opts.showMedia || !media || media.length === 0) return '';

  const layoutClass = opts.mediaLayout === 'vertical' ? 'layout-vertical' : '';
  const count = Math.min(media.length, 4);
  const items = media.slice(0, count).map(m => {
    const src = m.url || m.preview_image_url || '';
    if (!src) return '';
    const alt = escapeHtml(m.alt_text || '');
    return `<div class="media-item"><img src="${escapeHtml(src)}" alt="${alt}" crossorigin="anonymous"/></div>`;
  }).join('');

  return `<div class="media-grid count-${count} ${layoutClass}">${items}</div>`;
}

function buildQuoteHtml(quoteTweet) {
  if (!quoteTweet) return '';
  const { tweet, author, media } = quoteTweet;
  const avatar = author.profile_image_url
    ? `<img src="${escapeHtml(author.profile_image_url)}" alt="" crossorigin="anonymous"/>`
    : '';

  // Truncate with an ellipsis only when the text actually overflows.
  const raw = tweet.text || '';
  const text = escapeHtml(raw.length > 200 ? raw.slice(0, 200).trimEnd() + '…' : raw);

  // Show the first image from the quoted tweet, if any.
  const firstImg = (media || []).find(m => m.url || m.preview_image_url);
  const src = firstImg ? (firstImg.url || firstImg.preview_image_url) : '';
  const mediaHtml = src
    ? `<div class="quote-media"><img src="${escapeHtml(src)}" alt="${escapeHtml(firstImg.alt_text || '')}" crossorigin="anonymous"/></div>`
    : '';

  return `
<div class="quote-tweet">
  <div class="quote-header">
    <div class="quote-avatar">${avatar}</div>
    <span class="quote-name">${escapeHtml(author.name || '')}</span>
    <span class="quote-username">@${escapeHtml(author.username || '')}</span>
  </div>
  <div class="quote-text">${text}</div>
  ${mediaHtml}
</div>`;
}

function buildTimestampHtml(tweet, opts) {
  if (!opts.showTimestamp) return '';
  const ts = formatDate(tweet.created_at, opts.timeZoneOffset);
  return `<div class="timestamp">${escapeHtml(ts)}</div>`;
}

function buildStatsHtml(metrics, opts) {
  if (!opts.showStats) return '';
  const m = metrics || {};
  const parts = [];

  if (opts.showViews && m.impression_count != null) {
    parts.push(`<div class="stat"><span class="stat-value">${formatNumber(m.impression_count)}</span><span class="stat-label">Views</span></div>`);
  }
  if (m.reply_count != null) {
    parts.push(`<div class="stat"><span class="stat-value">${formatNumber(m.reply_count)}</span><span class="stat-label">Replies</span></div>`);
  }
  if (m.retweet_count != null) {
    parts.push(`<div class="stat"><span class="stat-value">${formatNumber(m.retweet_count)}</span><span class="stat-label">Reposts</span></div>`);
  }
  if (m.like_count != null) {
    parts.push(`<div class="stat"><span class="stat-value">${formatNumber(m.like_count)}</span><span class="stat-label">Likes</span></div>`);
  }
  if (m.bookmark_count != null) {
    parts.push(`<div class="stat"><span class="stat-value">${formatNumber(m.bookmark_count)}</span><span class="stat-label">Bookmarks</span></div>`);
  }

  if (parts.length === 0) return '';
  return `<div class="stats">${parts.join('')}</div>`;
}

function getLogoSvg(logo, theme) {
  const color = theme === 'dark' ? 'color:white' : 'color:black';
  if (logo === 'none') return '';
  if (logo === 'bluebird') return BLUEBIRD_LOGO.replace('class="logo"', `class="logo" style="${color}"`);
  return X_LOGO.replace('class="logo"', `class="logo" style="${color}"`);
}

function getVerifiedBadge(author) {
  if (!author.verified && !author.verified_type) return '';
  if (author.verified_type === 'gold') return VERIFIED_GOLD;
  if (author.verified_type === 'gray') return '';
  return VERIFIED_BLUE;
}

// Reserved vertical band at the bottom of a carousel slide for the swipe indicator.
const INDICATOR_RESERVE = 64;

function getAspectRatioStyle(ratio, width, slide) {
  if (!ratio || ratio === 'auto') return '';
  const map = { '1:1': 1, '4:5': 5/4, '5:4': 4/5, '16:9': 9/16, '9:16': 16/9 };
  const factor = map[ratio];
  if (!factor) return '';
  const height = Math.round(width * factor);

  // Multi-slide carousel: top-anchor the card and reserve room at the bottom
  // so the swipe indicator never overlaps the text.
  if (slide && slide.total > 1) {
    return `height:${height}px; display:flex; flex-direction:column; ` +
           `align-items:center; justify-content:flex-start; padding-bottom:${INDICATOR_RESERVE}px;`;
  }
  return `height:${height}px; display:flex; align-items:center; justify-content:center;`;
}

const CHEVRON_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function buildCarouselIndicator(slide) {
  if (!slide || slide.total <= 1) return '';
  const dots = Array.from({ length: slide.total }, (_, i) =>
    `<span class="swipe-dot${i === slide.index ? ' active' : ''}"></span>`
  ).join('');

  const hint = slide.isFirst
    ? `<div class="swipe-hint">Swipe ${CHEVRON_SVG}</div>`
    : '';

  return `
<div class="swipe-indicator">
  ${hint}
  <div class="swipe-pill">
    <div class="swipe-dots">${dots}</div>
    <span class="swipe-count">${slide.index + 1}/${slide.total}</span>
  </div>
</div>`;
}

/**
 * Inject card markup into the shared chrome (style, container, background,
 * shadow, aspect-ratio frame, carousel indicator). Used by both the single
 * renderer and the thread renderer so they share all layout/styling.
 */
function fillChrome(cardsHtml, opts, slide) {
  const width = toInt(opts.width, 410, { min: 300, max: 1000 });
  const borderRadius = toInt(opts.borderRadius, 16, { min: 0 });
  const theme = opts.theme === 'dark' ? 'dark' : 'light';

  const shadow = opts.shadow !== false;
  const SHADOW_PAD = 28;
  const padding = Math.max(toInt(opts.containerPadding, 16, { min: 0 }), shadow ? SHADOW_PAD : 0);
  const cardRadius = borderRadius;
  const containerRadius = cardRadius + padding;
  const cardShadow = shadow ? 'box-shadow: 0 6px 24px rgba(0,0,0,.16);' : '';

  let html = TEMPLATE
    .replace(/\{\{WIDTH\}\}/g, width)
    .replace(/\{\{BORDER_RADIUS\}\}/g, containerRadius)
    .replace(/\{\{CARD_RADIUS\}\}/g, cardRadius)
    .replace(/\{\{PADDING\}\}/g, padding)
    .replace(/\{\{CONTAINER_BG\}\}/g, resolveBackground(opts, theme))
    .replace(/\{\{THEME\}\}/g, theme)
    .replace(/\{\{ASPECT_RATIO_STYLE\}\}/g, getAspectRatioStyle(opts.aspectRatio, width, slide))
    .replace(/\{\{CARD_SHADOW\}\}/g, cardShadow)
    .replace(/\{\{CAROUSEL_INDICATOR\}\}/g, buildCarouselIndicator(slide))
    .replace(/\{\{CARDS_HTML\}\}/g, cardsHtml);

  // Strip any leftover Handlebars-style conditionals.
  return html.replace(/\{\{#if [^}]+\}\}/g, '').replace(/\{\{\/if\}\}/g, '');
}

// Header block for a single-tweet / carousel card (avatar + name row + logo).
function buildSingleHeader(author, opts, theme) {
  const avatarImg = author.profile_image_url
    ? `<img src="${escapeHtml(author.profile_image_url)}" alt="" crossorigin="anonymous"/>` : '';
  return `
    <div class="header">
      <div class="avatar">${avatarImg}</div>
      <div class="author-info">
        <div class="display-name">${escapeHtml(author.name || '')}${getVerifiedBadge(author)}</div>
        <div class="username">@${escapeHtml(author.username || '')}</div>
      </div>
      ${getLogoSvg(opts.logo || 'x', theme)}
    </div>`;
}

// The single `.tweet-card` (also used per carousel slide).
//   - text-chunk carousel slide (slide.text set): renders the chunk; media/quote
//     and footer only on the last slide.
//   - thread-carousel slide (slide.fullTweet): renders the WHOLE tweet (its own
//     media/quote every slide); footer only on the last slide.
//   - single (no slide): everything.
function buildSingleCardHtml(data, opts, slide, theme) {
  const { tweet, author, media, quoteTweet } = data;
  const isChunk = slide && slide.text != null && !slide.fullTweet;
  const showFooter = !slide || slide.isLast;
  const showContent = !slide || slide.fullTweet || slide.isLast; // media + quote

  const tweetTextHtml = isChunk
    ? escapeHtml(slide.text) // paginated chunk: entity offsets no longer line up
    : renderTextWithEntities(
        opts.showFullText !== false ? tweet.text : tweet.text.slice(0, 280),
        tweet.entities
      );

  return `<div class="tweet-card theme-${theme}">
    ${buildSingleHeader(author, opts, theme)}
    <div class="tweet-text">${tweetTextHtml}</div>
    ${showContent ? buildMediaHtml(media, opts) : ''}
    ${showContent ? buildQuoteHtml(quoteTweet) : ''}
    ${showFooter ? buildTimestampHtml(tweet, opts) : ''}
    ${showFooter ? buildStatsHtml(tweet.public_metrics, opts) : ''}
  </div>`;
}

// One `.tweet-card` containing N thread items with a connector rail.
function buildThreadCardHtml(items, opts, theme) {
  const logo = getLogoSvg(opts.logo || 'x', theme);
  const logoHtml = logo ? logo.replace('class="logo"', 'class="logo thread-logo"') : '';

  const itemsHtml = items.map(({ tweet, author, media, quoteTweet }, i) => {
    const isLast = i === items.length - 1;
    const avatarImg = author.profile_image_url
      ? `<img src="${escapeHtml(author.profile_image_url)}" alt="" crossorigin="anonymous"/>` : '';
    const textHtml = renderTextWithEntities(tweet.text || '', tweet.entities);
    return `
    <div class="thread-item">
      <div class="rail"><div class="avatar">${avatarImg}</div></div>
      <div class="tbody">
        <div class="thread-namerow">
          <span class="display-name">${escapeHtml(author.name || '')}${getVerifiedBadge(author)}</span>
          <span class="username">@${escapeHtml(author.username || '')}</span>
        </div>
        <div class="tweet-text">${textHtml}</div>
        ${buildMediaHtml(media, opts)}
        ${buildQuoteHtml(quoteTweet)}
        ${isLast ? buildTimestampHtml(tweet, opts) : ''}
        ${isLast ? buildStatsHtml(tweet.public_metrics, opts) : ''}
      </div>
    </div>`;
  }).join('');

  return `<div class="tweet-card theme-${theme}">${logoHtml}${itemsHtml}</div>`;
}

// "Tweet as poster" — the tweet's TEXT in large editorial type on the background,
// with just an avatar + handle attribution. No tweet chrome (stats/logo/box).
function buildQuoteCardHtml(data, opts, theme) {
  const { tweet, author } = data;
  const textHtml = renderTextWithEntities(tweet.text || '', tweet.entities);
  const avatarImg = author.profile_image_url
    ? `<img src="${escapeHtml(author.profile_image_url)}" alt="" crossorigin="anonymous"/>` : '';
  const fontClass = opts.quoteFont === 'serif' ? ' qfont-serif' : '';
  return `<div class="quote-poster theme-${theme}${fontClass}">
    <div class="quote-mark">&ldquo;</div>
    <div class="quote-body">${textHtml}</div>
    <div class="quote-attr">
      <div class="qa-avatar">${avatarImg}</div>
      <div>
        <div class="qa-name">${escapeHtml(author.name || '')}${getVerifiedBadge(author)}</div>
        <div class="qa-handle">@${escapeHtml(author.username || '')}</div>
      </div>
    </div>
  </div>`;
}

function renderHtml(data, opts) {
  const slide = opts.slide || null;
  const theme = opts.theme === 'dark' ? 'dark' : 'light';
  // Quote-poster mode is single-tweet only (ignores slide chunking).
  const cardsHtml = (opts.style === 'quote' && !slide)
    ? buildQuoteCardHtml(data, opts, theme)
    : buildSingleCardHtml(data, opts, slide, theme);
  return fillChrome(cardsHtml, opts, slide);
}

/**
 * Render a thread (ordered list of tweet blocks) as one stacked card image.
 * `data.tweets` = [{ tweet, author, media, quoteTweet }] already filtered to the
 * approved set and ordered oldest→newest.
 */
function renderThreadHtml(data, opts) {
  const theme = opts.theme === 'dark' ? 'dark' : 'light';
  const items = data.tweets || [];
  if (items.length <= 1) {
    // Degenerate thread → render as a normal single card.
    return renderHtml(items[0] || data, opts);
  }
  const cardsHtml = buildThreadCardHtml(items, opts, theme);
  return fillChrome(cardsHtml, opts, null);
}

module.exports = { renderHtml, renderThreadHtml, INDICATOR_RESERVE };
