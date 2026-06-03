'use strict';

/*
 * Direct Metricool HTTP client — lets TwitXGram schedule posts itself, without
 * routing through the Claude/MCP layer. Auth (per Metricool API):
 *   - header  X-Mc-Auth: <user token>
 *   - query   userId=<id>  (and blogId=<id> on the scheduler)
 * Base: https://app.metricool.com/api  (Advanced plan required).
 *
 * The scheduler path is configurable (METRICOOL_SCHEDULER_PATH) so a Metricool
 * API version bump never needs a code change.
 */

const { assertBlogAllowed } = require('./metricool');

const BASE = (process.env.METRICOOL_API_BASE || 'https://app.metricool.com/api').replace(/\/+$/, '');
const SCHEDULER_PATH = process.env.METRICOOL_SCHEDULER_PATH || '/v2/scheduler/posts';
const TIMEOUT_MS = Number(process.env.METRICOOL_TIMEOUT_MS || 15000);

function creds() {
  const token = process.env.METRICOOL_USER_TOKEN;
  const userId = process.env.METRICOOL_USER_ID;
  if (!token || !userId) {
    const e = new Error('Metricool is not configured — set METRICOOL_USER_TOKEN and METRICOOL_USER_ID');
    e.code = 'METRICOOL_UNCONFIGURED';
    throw e;
  }
  return { token, userId };
}

function isConfigured() {
  return Boolean(process.env.METRICOOL_USER_TOKEN && process.env.METRICOOL_USER_ID);
}

async function mcFetch(pathWithQuery, { method = 'GET', body, token } = {}) {
  let resp;
  try {
    resp = await fetch(`${BASE}${pathWithQuery}`, {
      method,
      headers: {
        'X-Mc-Auth': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`Metricool request failed: ${e.message}`);
  }

  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!resp.ok) {
    const msg = (data && (data.message || data.error)) || `Metricool API responded ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** List the brands/blogs on the account (use to discover blogIds). */
async function listBrands() {
  const { token, userId } = creds();
  return mcFetch(`/admin/simpleProfiles?userId=${encodeURIComponent(userId)}`, { token });
}

/**
 * Schedule (or draft) a post. `info` is the payload from
 * metricool.buildScheduledPostPayload(). Refuses blocked blogIds.
 */
async function schedulePost({ blogId, info }) {
  const { token, userId } = creds();
  const safeBlog = assertBlogAllowed(blogId); // throws on blocked / missing id
  const q = `?userId=${encodeURIComponent(userId)}&blogId=${encodeURIComponent(safeBlog)}`;
  return mcFetch(`${SCHEDULER_PATH}${q}`, { method: 'POST', body: info, token });
}

module.exports = { listBrands, schedulePost, isConfigured, BASE, SCHEDULER_PATH };
