/**
 * POST /api/webhooks/square — Square → portal D1 event path.
 * GET  /api/webhooks/square — health (no secrets).
 *
 * Configure the Square Developer Dashboard webhook subscription URL to
 * this path (production: https://umrt-portal.pages.dev/api/webhooks/square).
 * Set SQUARE_WEBHOOK_SIGNATURE_KEY (and ideally SQUARE_WEBHOOK_NOTIFICATION_URL)
 * in Cloudflare Pages env. Unsigned requests are rejected.
 */
import { json } from '../../_lib/auth.js';
import { checkRateLimit } from '../../_lib/rate-limit.js';
import {
  applyEventToJob,
  findEventBySquareId,
  insertSquareEvent,
  isRelevantSquareEvent,
  matchJobId,
  notificationUrlFrom,
  structureSquareEvent,
  updateEventNotify,
  verifySquareWebhookSignature,
} from '../../_lib/square-events.js';
import { notifyMatt } from '../../_lib/notify-matt.js';

export async function onRequestGet() {
  return json(
    {
      ok: true,
      path: '/api/webhooks/square',
      accepts: ['booking.*', 'invoice.*', 'payment.*', 'refund.*', 'order.*'],
    },
    200,
    { 'Cache-Control': 'no-store' }
  );
}

export async function onRequestPost(context) {
  const { env, request } = context;

  const rl = await checkRateLimit(env, request, {
    max: 120,
    windowMinutes: 5,
    key: 'webhook-square',
  });
  if (rl.limited) {
    return json({ error: 'rate_limited', retry_after: rl.retryAfter }, 429);
  }

  const signatureKey = (env.SQUARE_WEBHOOK_SIGNATURE_KEY || '').trim();
  if (!signatureKey) {
    return json(
      {
        error: 'not_configured',
        message: 'Set SQUARE_WEBHOOK_SIGNATURE_KEY in Cloudflare Pages env.',
      },
      503
    );
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
  if (!valid) {
    return json({ error: 'invalid_signature' }, 401);
  }

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

  if (!body.event_id) {
    return json({ error: 'missing_event_id' }, 400);
  }

  if (!env.DB) {
    return json({ error: 'no_db' }, 503);
  }

  const existing = await findEventBySquareId(env.DB, body.event_id);
  if (existing) {
    return json({ ok: true, duplicate: true, id: existing.id }, 200);
  }

  const structured = structureSquareEvent(body);
  if (!structured.squareEventId) {
    return json({ error: 'missing_event_id' }, 400);
  }

  let jobId = null;
  try {
    jobId = await matchJobId(env.DB, structured);
    if (jobId) await applyEventToJob(env.DB, structured, jobId);
  } catch {
    jobId = null;
  }

  let id;
  try {
    id = await insertSquareEvent(env.DB, structured, {
      jobId,
      notifyStatus: 'pending',
    });
  } catch (err) {
    const again = await findEventBySquareId(env.DB, body.event_id);
    if (again) return json({ ok: true, duplicate: true, id: again.id }, 200);
    return json({ error: 'insert_failed', message: String(err && err.message || err) }, 500);
  }

  const origin = new URL(request.url).origin;
  const notify = await notifyMatt(env, {
    structured,
    eventId: id,
    readUrl: `${origin}/api/admin/events`,
  });

  try {
    await updateEventNotify(env.DB, id, {
      notifyStatus: notify.status,
      notifyChannel: notify.channel,
      notifyError: notify.error || notify.reason || null,
    });
  } catch {
    // Event is already stored; notify bookkeeping must not fail the webhook.
  }

  return json(
    {
      ok: true,
      id,
      topic: structured.topic,
      type: structured.eventType,
      job_id: jobId,
      notify: { status: notify.status, channel: notify.channel },
    },
    200
  );
}
