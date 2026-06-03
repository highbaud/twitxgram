'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { planConversations } = require('../src/watcher');

// Timeline as the API returns it: newest-first.
const timeline = [
  { id: '105', conversation_id: '105', author_id: 'U', in_reply_to_user_id: null },  // standalone original
  { id: '104', conversation_id: '100', author_id: 'U', in_reply_to_user_id: 'U' },   // self-thread tail
  { id: '103', conversation_id: '100', author_id: 'U', in_reply_to_user_id: 'U' },   // self-thread mid
  { id: '102', conversation_id: '900', author_id: 'U', in_reply_to_user_id: 'OTHER' }, // reply to someone else
  { id: '100', conversation_id: '100', author_id: 'U', in_reply_to_user_id: null },  // thread root
];

test('planConversations: groups self-thread, single for standalone, excludes replies-to-others', () => {
  const { jobs, maxSeenId } = planConversations(timeline, { userId: 'U', processedConversations: [], threadEnabled: true });
  assert.strictEqual(maxSeenId, '105');

  // ordered oldest→newest by maxId: conv100 (104) then conv105 (105)
  assert.deepStrictEqual(jobs.map(j => j.conversationId), ['100', '105']);

  const thread = jobs.find(j => j.conversationId === '100');
  assert.strictEqual(thread.isThread, true, 'multi-tweet self-conversation is a thread');
  assert.strictEqual(thread.renderId, '104', 'renders from the latest tweet (walks up to root)');

  const single = jobs.find(j => j.conversationId === '105');
  assert.strictEqual(single.isThread, false, 'standalone original is not a thread');

  // the reply to OTHER (conv 900) is excluded entirely
  assert.ok(!jobs.some(j => j.conversationId === '900'), 'replies to other accounts are skipped');
});

test('planConversations: skips already-processed conversations (dedupe)', () => {
  const { jobs } = planConversations(timeline, { userId: 'U', processedConversations: ['100'], threadEnabled: true });
  assert.deepStrictEqual(jobs.map(j => j.conversationId), ['105'], 'thread 100 already drafted → not redone');
});

test('planConversations: a lone self-reply still counts as a thread', () => {
  const tl = [{ id: '50', conversation_id: '40', author_id: 'U', in_reply_to_user_id: 'U' }];
  const { jobs } = planConversations(tl, { userId: 'U', processedConversations: [], threadEnabled: true });
  assert.strictEqual(jobs[0].isThread, true, 'conversation_id != id → part of a thread');
});

test('planConversations: empty timeline → no jobs', () => {
  const { jobs, maxSeenId } = planConversations([], { userId: 'U' });
  assert.deepStrictEqual(jobs, []);
  assert.strictEqual(maxSeenId, null);
});
