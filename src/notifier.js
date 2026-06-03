'use strict';

/*
 * Notifier — tells you when watcher drafts are ready to review, so they don't sit
 * unseen in Metricool. Channels: Slack/Discord (or generic) webhook + email (SMTP).
 * Batches into a DAILY DIGEST (one message/email per day) rather than per-draft.
 *
 * Drafts are queued to data/digest.json (survives restarts); the digest is sent
 * once a day at DIGEST_HOUR (local) if there's anything pending.
 */

const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const DATA_DIR = path.join(__dirname, '..', 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'digest.json');
const DIGEST_HOUR = Math.min(23, Math.max(0, Number(process.env.DIGEST_HOUR || 9)));
const REVIEW_URL = process.env.METRICOOL_PLANNER_URL || 'https://app.metricool.com/planning';

// ── Channel config ──
function webhookUrl() { return process.env.NOTIFY_WEBHOOK_URL || ''; }
function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.NOTIFY_EMAIL_TO);
}
function anyChannelConfigured() { return Boolean(webhookUrl()) || emailConfigured(); }

// ── Persisted queue ──
function loadState() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); }
  catch { return { pending: [], lastDigestDate: null }; }
}
function saveState(s) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(QUEUE_FILE, JSON.stringify(s, null, 2)); }

/** Queue a freshly-created draft for the next digest (no-op if no channel set up). */
function queueDraft(item) {
  if (!anyChannelConfigured()) return;
  const s = loadState();
  s.pending.push({
    username: item.username, blogId: String(item.blogId), tweetId: item.tweetId,
    caption: (item.caption || '').slice(0, 160), isThread: !!item.isThread,
    media: (item.media || []).slice(0, 4), ts: new Date().toISOString(),
  });
  saveState(s);
}

// ── Formatting (pure, testable) ──
function formatDigestText(items) {
  const lines = items.map((it, i) => {
    const kind = it.isThread ? 'thread' : 'tweet';
    const cap = it.caption ? ` — “${it.caption.replace(/\s+/g, ' ').trim()}”` : '';
    return `${i + 1}. @${it.username} (${kind}) → blog ${it.blogId}${cap}`;
  });
  return `*${items.length} TwitXGram draft${items.length > 1 ? 's' : ''} ready to review*\n` +
    lines.join('\n') + `\n\nReview & schedule: ${REVIEW_URL}`;
}

function buildWebhookPayload(url, items) {
  const text = formatDigestText(items);
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (host.includes('slack.com')) return { text };                 // Slack mrkdwn
  if (host.includes('discord.com') || host.includes('discordapp.com')) {
    return { content: text.replace(/\*/g, '**') };                 // Discord markdown
  }
  return { event: 'twitxgram.digest', count: items.length, reviewUrl: REVIEW_URL, items }; // generic
}

function formatEmailHtml(items) {
  const rows = items.map(it => {
    const thumb = it.media && it.media[0] ? `<img src="${it.media[0]}" alt="" style="max-width:120px;border-radius:8px;display:block;margin-top:6px"/>` : '';
    const cap = it.caption ? `<div style="color:#536471">${escapeHtml(it.caption)}</div>` : '';
    return `<li style="margin:0 0 14px"><b>@${escapeHtml(it.username)}</b> · ${it.isThread ? 'thread' : 'tweet'} → blog ${escapeHtml(it.blogId)}${cap}${thumb}</li>`;
  }).join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif">
    <h2>${items.length} draft${items.length > 1 ? 's' : ''} ready to review</h2>
    <ul style="list-style:none;padding:0">${rows}</ul>
    <p><a href="${REVIEW_URL}">Review &amp; schedule in Metricool →</a></p>
  </div>`;
}
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── Senders ──
async function sendWebhook(items) {
  const url = webhookUrl();
  if (!url) return;
  const resp = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildWebhookPayload(url, items)),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`webhook responded ${resp.status}`);
}

async function sendEmail(items) {
  if (!emailConfigured()) return;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({
    from: process.env.NOTIFY_EMAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL_TO,
    subject: `TwitXGram: ${items.length} draft${items.length > 1 ? 's' : ''} ready to review`,
    text: formatDigestText(items).replace(/\*/g, ''),
    html: formatEmailHtml(items),
  });
}

/** Send the digest now if there's anything pending. Clears the queue on success. */
async function sendDigestNow() {
  const s = loadState();
  if (!s.pending.length) return { sent: 0 };
  const items = s.pending;
  const results = await Promise.allSettled([sendWebhook(items), sendEmail(items)]);
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length === results.filter(Boolean).length && anyChannelConfigured()) {
    // every configured channel failed → keep the queue for retry
    throw new Error(failed.map(f => f.reason && f.reason.message).join('; ') || 'digest send failed');
  }
  s.pending = [];
  s.lastDigestDate = localDateStr();
  saveState(s);
  return { sent: items.length };
}

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Called on an interval — sends the daily digest once it's past DIGEST_HOUR. */
async function maybeSendDigest() {
  if (!anyChannelConfigured()) return;
  const s = loadState();
  if (!s.pending.length) return;
  const now = new Date();
  if (now.getHours() < DIGEST_HOUR) return;            // wait for the morning slot
  if (s.lastDigestDate === localDateStr(now)) return;  // already sent today
  await sendDigestNow();
}

function pendingCount() { return loadState().pending.length; }

module.exports = {
  queueDraft, sendDigestNow, maybeSendDigest, pendingCount, anyChannelConfigured,
  formatDigestText, buildWebhookPayload, // exported for tests
};
