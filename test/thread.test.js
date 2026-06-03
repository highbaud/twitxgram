'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { selectThreadTweets, dedupeSortNodes } = require('../src/fetcher');
const { renderThreadHtml } = require('../src/renderer');

function node(id, isMainAuthor, text = 'x') {
  return {
    id, isMainAuthor,
    tweet: { id, text, created_at: '2026-06-02T14:30:00Z', entities: { hashtags: [], mentions: [], urls: [] }, public_metrics: {} },
    author: { name: isMainAuthor ? 'Main' : 'Other', username: isMainAuthor ? 'main' : 'other', profile_image_url: '' },
    media: [], quoteTweet: null,
  };
}

test('selectThreadTweets: main author auto, others only when approved', () => {
  const thread = { tweets: [node('1', true), node('2', false), node('3', true), node('4', false)] };

  // default: only main-author tweets
  assert.deepStrictEqual(selectThreadTweets(thread, []).map(t => t.id), ['1', '3']);

  // approve one other-account reply
  assert.deepStrictEqual(selectThreadTweets(thread, ['2']).map(t => t.id), ['1', '2', '3']);

  // approve all
  assert.deepStrictEqual(selectThreadTweets(thread, ['2', '4']).map(t => t.id), ['1', '2', '3', '4']);

  // unknown id ignored
  assert.deepStrictEqual(selectThreadTweets(thread, ['999']).map(t => t.id), ['1', '3']);
});

test('renderThreadHtml: one thread-item per tweet + connector + single footer', () => {
  const data = {
    mainAuthor: { name: 'Main', username: 'main' },
    tweets: [node('1', true, 'first'), node('2', true, 'second'), node('3', true, 'third')],
  };
  // give the last tweet stats so the footer is observable
  data.tweets[2].tweet.public_metrics = { like_count: 5, reply_count: 1, retweet_count: 2 };

  const html = renderThreadHtml(data, { theme: 'light', showStats: true });
  const items = (html.match(/class="thread-item"/g) || []).length;
  assert.strictEqual(items, 3, 'one .thread-item per tweet');
  assert.ok(html.includes('class="rail"'), 'connector rail present');
  const statsBlocks = (html.match(/class="stats"/g) || []).length;
  assert.strictEqual(statsBlocks, 1, 'stats footer only on the last tweet');
  assert.ok(html.includes('first') && html.includes('second') && html.includes('third'));
});

test('dedupeSortNodes: merges by id, orders chronologically (for pasted replies)', () => {
  const nodes = [
    { id: '104', tweet: { text: 'd' } },
    { id: '100', tweet: { text: 'a' } },
    { id: '104', tweet: { text: 'dup' } }, // duplicate id (paste of an existing tweet)
    { id: '102', tweet: { text: 'c' } },
  ];
  const out = dedupeSortNodes(nodes);
  assert.deepStrictEqual(out.map(n => n.id), ['100', '102', '104'], 'deduped + sorted ascending');
  assert.strictEqual(out.find(n => n.id === '104').tweet.text, 'd', 'first occurrence wins on dupe');
});

test('renderThreadHtml: single-tweet thread degrades to a normal card', () => {
  const data = { mainAuthor: { name: 'Main', username: 'main' }, tweets: [node('1', true, 'solo')] };
  const html = renderThreadHtml(data, { theme: 'light' });
  assert.ok(!html.includes('class="thread-item"'), 'no thread layout for a 1-tweet thread');
  assert.ok(html.includes('class="tweet-card'), 'renders a normal single card');
});
