/**
 * umrt-square-events — Cloudflare Worker (Mattc2896.workers.dev).
 *
 * Pattern reused from united-mobile-rv/workers/square-inventory-cron:
 *   standalone Worker (not Pages), wrangler secret put, no-op until configured,
 *   no hardcoded secrets, workers.dev URL.
 *
 * This Worker verifies Square's HMAC, writes a structured D1 row Claude can
 * read, and stubs Matt SMS/email notify unless Twilio/Resend secrets are set.
 * It does not write Square catalog/orders/invoices and does not change Book
 * land (united-mobile-rv-llc.square.site). Portal consumes this log later.
 *
 * Staging first. Do not point a production Square subscription here until Matt.
 */

import {
  findEventBySquareId,
  insertSquareEvent,
  isRelevantSquareEvent,
  notificationUrlFrom,
  structureSquareEvent,
  timingSafeEqual,
  updateEventNotify,
  verifySquareWebhookSignature,
} from '../../../functions/_lib/square-events.js';
import { notifyConfigured, notifyMatt } from '../../../functions/_lib/notify-matt.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function webhookMeta(env) {
  return {
    worker: env.WORKER_NAME || 'umrt-square-events',
    environment: env.ENVIRONMENT || 'unknown',
    path: '/webhook',
    accepts: ['booking.*', 'invoice.*', 'payment.*', 'refund.*', 'order.*'],
    book_land: 'https://united-mobile-rv-llc.square.site/',
    signature_configured: !!(env.SQUARE_WEBHOOK_SIGNATURE_KEY || '').trim(),
    claude_token_configured: !!(env.CLAUDE_EVENTS_TOKEN || '').trim(),
    notify_configured: notifyConfigured(env),
  };
}

function authorizeClaude(env, request) {
  const configured = (env.CLAUDE_EVENTS_TOKEN || '').trim();
  if (!configured) return false;
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)/i);
  return !!(match && timingSafeEqual(match[1], configured));
}

async function handleWebhook(request, env, ctx) {
  const signatureKey = (env.SQUARE_WEBHOOK_SIGNATURE_KEY || '').trim();
  if (!signatureKey) {
    return json({
      error: 'not_configured',
      message: 'Set SQUARE_WEBHOOK_SIGNATURE_KEY via: wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY',
    }, 503);
  }

  const rawBody = await request.text();
  const signatureHeader =
    request.headers.get('x-square-hmacsha256-signature') ||
    request.headers.get('X-Square-Hmacsha256-Signature') ||
    '';
  const notificationUrl = notificationUrlFrom(request, env);

  const valid = await verifySquareWebhookSignature({
    rawBody,
    signatureHeader,
    signatureKey,
    notificationUrl,
  });
  if (!valid) return json({ error: 'invalid_signature' }, 401);

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const type = body && (body.type || body.event_type);
  if (!isRelevantSquareEvent(type)) {
    return json({ ok: true, ignored: true, reason: 'not_relevant', type: type || null }, 200);
  }
  if (!body.event_id) return json({ error: 'missing_event_id' }, 400);
  if (!env.DB) return json({ error: 'no_db' }, 503);

  const existing = await findEventBySquareId(env.DB, body.event_id);
  if (existing) return json({ ok: true, duplicate: true, id: existing.id }, 200);

  const structured = structureSquareEvent(body);
  let id;
  try {
    id = await insertSquareEvent(env.DB, structured, { notifyStatus: 'pending' });
  } catch (err) {
    const again = await findEventBySquareId(env.DB, body.event_id);
    if (again) return json({ ok: true, duplicate: true, id: again.id }, 200);
    return json({ error: 'insert_failed', message: String(err && err.message || err) }, 500);
  }

  const origin = new URL(request.url).origin;
  const notifyWork = (async () => {
    const notify = await notifyMatt(env, {
      structured,
      eventId: id,
      readUrl: `${origin}/events`,
    });
    try {
      await updateEventNotify(env.DB, id, {
        notifyStatus: notify.status,
        notifyChannel: notify.channel,
        notifyError: notify.error || notify.reason || null,
      });
    } catch {
      // Event is stored; notify bookkeeping must not fail the webhook.
    }
    return notify;
  })();

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(notifyWork);
    return json({ ok: true, id, topic: structured.topic, type: structured.eventType, notify: { status: 'pending' } }, 200);
  }

  const notify = await notifyWork;
  return json({
    ok: true,
    id,
    topic: structured.topic,
    type: structured.eventType,
    notify: { status: notify.status, channel: notify.channel },
  }, 200);
}

async function listEvents(request, env) {
  if (!authorizeClaude(env, request)) return json({ error: 'unauthorized' }, 401);
  if (!env.DB) return json({ events: [], worker: webhookMeta(env) }, 200);

  const url = new URL(request.url);
  const topic = (url.searchParams.get('topic') || '').trim();
  const type = (url.searchParams.get('type') || '').trim();
  const full = url.searchParams.get('full') === '1';
  let limit = Number(url.searchParams.get('limit') || 50);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;

  const cols = full
    ? `id, square_event_id, event_type, topic, merchant_id, object_id, object_type,
       status, amount_cents, currency, customer_id, customer_email, invoice_id,
       order_id, booking_id, payment_id, job_id, summary, payload_json,
       notify_status, notify_channel, notify_error, received_at, square_created_at`
    : `id, square_event_id, event_type, topic, merchant_id, object_id, object_type,
       status, amount_cents, currency, customer_id, customer_email, invoice_id,
       order_id, booking_id, payment_id, job_id, summary,
       notify_status, notify_channel, received_at, square_created_at`;

  let query = `SELECT ${cols} FROM square_events`;
  const binds = [];
  const where = [];
  if (topic) { where.push('topic = ?'); binds.push(topic); }
  if (type) { where.push('event_type = ?'); binds.push(type); }
  if (where.length) query += ` WHERE ${where.join(' AND ')}`;
  query += ' ORDER BY received_at DESC LIMIT ?';
  binds.push(limit);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  const events = (results || []).map((row) => {
    if (!full || !row.payload_json) return row;
    try { return { ...row, payload: JSON.parse(row.payload_json) }; } catch { return row; }
  });

  return json({ events, read_as: 'claude_token', worker: webhookMeta(env) });
}

async function getEvent(env, request, id) {
  if (!authorizeClaude(env, request)) return json({ error: 'unauthorized' }, 401);
  if (!env.DB) return json({ error: 'no_db' }, 503);
  const row = await env.DB.prepare('SELECT * FROM square_events WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'not_found' }, 404);
  let payload = null;
  try { payload = row.payload_json ? JSON.parse(row.payload_json) : null; } catch { payload = null; }
  return json({ event: { ...row, payload }, read_as: 'claude_token' });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'GET' && (path === '/' || path === '/webhook')) {
      return json({ ok: true, ...webhookMeta(env) });
    }
    if (request.method === 'POST' && (path === '/' || path === '/webhook')) {
      return handleWebhook(request, env, ctx);
    }
    if (request.method === 'GET' && path === '/events') {
      return listEvents(request, env);
    }
    const one = path.match(/^\/events\/([^/]+)$/);
    if (request.method === 'GET' && one) {
      return getEvent(env, request, decodeURIComponent(one[1]));
    }
    return json({ error: 'not_found' }, 404);
  },
};
