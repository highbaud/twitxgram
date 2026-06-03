'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { formatDigestText, buildWebhookPayload } = require('../src/notifier');

const items = [
  { username: 'creator', blogId: '123456', isThread: false, caption: 'Markets reward patience.', media: ['https://h/0.png'] },
  { username: 'creator', blogId: '123456', isThread: true, caption: 'A thread on discipline', media: ['https://h/1.png'] },
];

test('formatDigestText: summarizes count + each draft', () => {
  const txt = formatDigestText(items);
  assert.ok(txt.includes('2 TwitXGram drafts ready to review'));
  assert.ok(txt.includes('@creator (tweet)'));
  assert.ok(txt.includes('@creator (thread)'));
  assert.ok(txt.includes('Markets reward patience.'));
  assert.ok(/Review & schedule:/.test(txt));
});

test('buildWebhookPayload: Slack uses {text}', () => {
  const p = buildWebhookPayload('https://hooks.slack.com/services/XXX', items);
  assert.ok(typeof p.text === 'string' && p.text.includes('ready to review'));
  assert.ok(!('content' in p));
});

test('buildWebhookPayload: Discord uses {content} with bold markdown', () => {
  const p = buildWebhookPayload('https://discord.com/api/webhooks/XXX', items);
  assert.ok(typeof p.content === 'string');
  assert.ok(p.content.includes('**'), 'Slack *mrkdwn* converted to Discord **bold**');
});

test('buildWebhookPayload: generic URL gets structured JSON', () => {
  const p = buildWebhookPayload('https://hooks.zapier.com/abc', items);
  assert.strictEqual(p.event, 'twitxgram.digest');
  assert.strictEqual(p.count, 2);
  assert.ok(Array.isArray(p.items) && p.items.length === 2);
});
