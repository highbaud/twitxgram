'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { renderHtml } = require('../src/renderer');

const baseData = {
  tweet: {
    id: '1',
    text: 'hello world',
    created_at: '2026-06-02T14:30:00.000Z',
    entities: { hashtags: [], mentions: [], urls: [] },
    public_metrics: { reply_count: 1, retweet_count: 2, like_count: 3, impression_count: 4, bookmark_count: 5 },
  },
  author: { name: 'Jake', username: 'jake', profile_image_url: 'https://x/a_400x400.jpg', verified: true, verified_type: 'blue' },
  media: [],
  quoteTweet: null,
};

test('renderHtml: theme class + no NaN in CSS', () => {
  const html = renderHtml(baseData, { theme: 'dark', width: NaN, containerPadding: 'abc' });
  assert.ok(html.includes('theme-dark'));
  assert.ok(!/NaN/.test(html), 'no NaN should reach the CSS');
  assert.ok(/width:\s*410px/.test(html), 'invalid width falls back to default 410');
});

test('renderHtml: invalid numeric query params clamp to valid CSS', () => {
  // shadow:false so padding isn't bumped to the shadow minimum.
  const html = renderHtml(baseData, { width: '99999', containerPadding: '-5', borderRadius: 'xx', shadow: false });
  assert.ok(/width:\s*1000px/.test(html), 'width clamps to 1000 max');
  assert.ok(/padding:\s*0px/.test(html), 'padding clamps to 0 min');
  assert.ok(/border-radius:\s*16px/.test(html), 'invalid borderRadius → default 16');
});

test('renderHtml: card radius + shadow', () => {
  const withShadow = renderHtml(baseData, { borderRadius: 30 });
  assert.ok(/\.tweet-card\s*\{[^}]*border-radius:\s*30px/.test(withShadow), 'card uses the requested 30px radius');
  assert.ok(/box-shadow:\s*0 6px 24px/.test(withShadow), 'soft shadow on by default');

  const noShadow = renderHtml(baseData, { borderRadius: 30, shadow: false });
  assert.ok(!/box-shadow:\s*0 6px 24px/.test(noShadow), 'shadow=false removes the drop shadow');
});

test('renderHtml: carousel indicator only on multi-slide', () => {
  // NB: the CSS class names always appear in the <style> block, so assert on
  // the rendered element markup (class="...") instead.
  const single = renderHtml(baseData, { slide: { index: 0, total: 1, text: 'a', isFirst: true, isLast: true } });
  assert.ok(!single.includes('class="swipe-indicator"'), 'no indicator for a 1-slide carousel');

  const multi = renderHtml(baseData, { slide: { index: 0, total: 3, text: 'a', isFirst: true, isLast: false } });
  assert.ok(multi.includes('class="swipe-indicator"'));
  assert.ok(multi.includes('1/3'));
  assert.ok(multi.includes('class="swipe-hint"'), 'first slide shows the Swipe hint');
});

test('renderHtml: footer (stats/timestamp) only on the last slide', () => {
  const opts = { showStats: true, showTimestamp: true, showViews: true };
  const first = renderHtml(baseData, { ...opts, slide: { index: 0, total: 2, text: 'a', isFirst: true, isLast: false } });
  assert.ok(!first.includes('class="stats"'), 'no stats on non-last slide');
  assert.ok(!first.includes('class="timestamp"'), 'no timestamp on non-last slide');

  const last = renderHtml(baseData, { ...opts, slide: { index: 1, total: 2, text: 'b', isFirst: false, isLast: true } });
  assert.ok(last.includes('class="stats"'), 'stats on last slide');
  assert.ok(last.includes('class="timestamp"'), 'timestamp on last slide');
  assert.ok(!last.includes('class="swipe-hint"'), 'no Swipe hint after the first slide');
});

test('renderHtml: quote-poster mode drops tweet chrome for big-type card', () => {
  const html = renderHtml(baseData, { style: 'quote', theme: 'dark', background: 'sunset' });
  assert.ok(html.includes('class="quote-poster'), 'uses the quote-poster card');
  assert.ok(html.includes('class="quote-body"'), 'has the big quote body');
  assert.ok(html.includes('hello world'), 'renders the tweet text');
  assert.ok(html.includes('@jake'), 'shows the handle attribution');
  assert.ok(!html.includes('class="tweet-card'), 'no tweet-chrome card');
  assert.ok(!html.includes('class="stats"'), 'no stats in poster mode');

  const serif = renderHtml(baseData, { style: 'quote', quoteFont: 'serif' });
  assert.ok(serif.includes('qfont-serif'), 'serif variant applies the serif class');
});

test('renderHtml: quote tweet truncates with ellipsis + renders media', () => {
  const longQuote = {
    ...baseData,
    quoteTweet: {
      tweet: { text: 'x'.repeat(300) },
      author: { name: 'QA', username: 'qa', profile_image_url: '' },
      media: [{ url: 'https://x/img.jpg', type: 'photo' }],
    },
  };
  const html = renderHtml(longQuote, {});
  assert.ok(html.includes('…'), 'long quote text is ellipsized');
  assert.ok(html.includes('quote-media'), 'quote media is rendered');
  assert.ok(html.includes('https://x/img.jpg'));
});
