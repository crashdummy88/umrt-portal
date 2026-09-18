/**
 * GET /api/admin/events — structured Square event log for Matt (admin
 * session) and Claude (Authorization: Bearer $CLAUDE_EVENTS_TOKEN).
 *
 * Query: ?topic=invoice|payment|booking|refund|order
 *        ?type=invoice.payment_made
 *        ?limit=50 (max 200)
 *        ?full=1 (include payload_json)
 */
import { json } from '../../_lib/auth.js';
import { authorizeAdminOrAgent } from '../../_lib/agent-read.js';
import { notifyConfigured } from '../../_lib/notify-matt.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const auth = await authorizeAdminOrAgent(env, request);
  if (!auth.ok) {
    return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }
  if (!env.DB) {
    return json({ events: [], webhook: webhookMeta(env) }, 200, { 'Cache-Control': 'no-store' });
  }

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
  if (topic) {
    where.push('topic = ?');
    binds.push(topic);
  }
  if (type) {
    where.push('event_type = ?');
    binds.push(type);
  }
  if (where.length) query += ` WHERE ${where.join(' AND ')}`;
  query += ' ORDER BY received_at DESC LIMIT ?';
  binds.push(limit);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  const events = (results || []).map((row) => {
    if (!full || !row.payload_json) return row;
    try {
      return { ...row, payload: JSON.parse(row.payload_json) };
    } catch {
      return row;
    }
  });

  return json(
    {
      events,
      read_as: auth.via,
      webhook: webhookMeta(env),
      notify: { configured: notifyConfigured(env) },
    },
    200,
    { 'Cache-Control': 'no-store' }
  );
}

function webhookMeta(env) {
  return {
    path: '/api/webhooks/square',
    signature_configured: !!(env && env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    notification_url: (env && env.SQUARE_WEBHOOK_NOTIFICATION_URL) || null,
    claude_token_configured: !!(env && env.CLAUDE_EVENTS_TOKEN),
  };
}
