/**
 * Square webhook → structured portal event.
 *
 * Mirrors united-mobile-rv/functions/_lib/square.js discipline:
 *   - no-op / reject until env is deliberately set
 *   - never invent credentials (SQUARE_WEBHOOK_SIGNATURE_KEY is a name only)
 *   - never publish invoices or write back to Square
 *   - best-effort job match; a miss must not fail the webhook
 *
 * Signature (Square docs): HMAC-SHA256 of (notificationUrl + rawBody)
 * using the subscription signature key, then Base64. Compared to
 * the `x-square-hmacsha256-signature` header. Notification URL must
 * match the Square Dashboard subscription URL exactly.
 */

const RAW_PAYLOAD_CAP = 12 * 1024;

const RELEVANT_PREFIXES = ['booking.', 'invoice.', 'payment.', 'refund.', 'order.'];

export function isRelevantSquareEvent(type) {
  if (!type || typeof type !== 'string') return false;
  const t = type.toLowerCase();
  return RELEVANT_PREFIXES.some((p) => t.startsWith(p));
}

export function topicFromType(type) {
  const head = String(type || '').toLowerCase().split('.')[0];
  return ['booking', 'invoice', 'payment', 'refund', 'order'].includes(head) ? head : 'other';
}

function bytesToB64(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const max = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < max; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function verifySquareWebhookSignature({
  rawBody,
  signatureHeader,
  signatureKey,
  notificationUrl,
}) {
  if (!rawBody || !signatureHeader || !signatureKey || !notificationUrl) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signatureKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(notificationUrl + rawBody)
  );
  return timingSafeEqual(bytesToB64(sig), signatureHeader);
}

export function notificationUrlFrom(request, env) {
  const configured = (env && env.SQUARE_WEBHOOK_NOTIFICATION_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  const url = new URL(request.url);
  return `${url.origin}${url.pathname}`.replace(/\/$/, '');
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function moneyAmount(money) {
  if (!money || typeof money.amount !== 'number') return null;
  return { amount: money.amount, currency: money.currency || 'USD' };
}

const REDACT_KEY = /card_number|account_number|pan|cvv|cvc|track|magnetic/i;

export function sanitizeForStore(value, depth = 0) {
  if (depth > 8) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((v) => sanitizeForStore(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT_KEY.test(k) ? '[redacted]' : sanitizeForStore(v, depth + 1);
  }
  return out;
}

function capJson(obj) {
  const raw = JSON.stringify(obj);
  if (raw.length <= RAW_PAYLOAD_CAP) return raw;
  return JSON.stringify({ truncated: true, preview: raw.slice(0, RAW_PAYLOAD_CAP) });
}

function pickNested(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key]) return obj[key];
  }
  return null;
}

export function structureSquareEvent(body) {
  const type = body.type || body.event_type || '';
  const data = asObject(body.data) || {};
  const envelope = asObject(data.object) || {};
  const invoice = asObject(envelope.invoice) || (data.type === 'invoice' ? envelope : null);
  const booking = asObject(envelope.booking) || (data.type === 'booking' ? envelope : null);
  const payment = asObject(envelope.payment) || (data.type === 'payment' ? envelope : null);
  const refund = asObject(envelope.refund) || (data.type === 'refund' ? envelope : null);
  const order = asObject(envelope.order) || (data.type === 'order' ? envelope : null);

  const invoiceId = (invoice && invoice.id) || (payment && payment.invoice_id) || null;
  const orderId = (invoice && invoice.order_id) || (order && order.id) || (payment && payment.order_id) || null;
  const bookingId = (booking && booking.id) || null;
  const paymentId = (payment && payment.id) || (refund && refund.payment_id) || null;

  const status = String(
    (invoice && invoice.status) ||
    (payment && payment.status) ||
    (booking && booking.status) ||
    (refund && refund.status) ||
    (order && (order.state || order.status)) ||
    ''
  ).toLowerCase() || null;

  const paidMoney = invoice && Array.isArray(invoice.payment_requests)
    ? moneyAmount(invoice.payment_requests[0] && invoice.payment_requests[0].total_completed_amount_money)
    : null;
  const money = paidMoney || moneyAmount(payment && payment.amount_money) || moneyAmount(refund && refund.amount_money);

  const recipient = invoice && asObject(invoice.primary_recipient);
  const customerId =
    (booking && booking.customer_id) ||
    (recipient && recipient.customer_id) ||
    (payment && payment.customer_id) ||
    null;
  const customerEmail =
    (recipient && recipient.email_address) ||
    (booking && booking.customer_email) ||
    null;

  const objectId = data.id || invoiceId || bookingId || paymentId || orderId || null;
  const topic = topicFromType(type);
  const amountCents = money ? money.amount : null;
  const currency = money ? money.currency : null;

  const summary = buildSummary({ type, topic, objectId, status, amountCents, currency });

  const extracted = {
    event_id: body.event_id || null,
    type,
    topic,
    merchant_id: body.merchant_id || null,
    created_at: body.created_at || null,
    object_id: objectId,
    object_type: data.type || topic,
    status,
    amount_cents: amountCents,
    currency,
    customer_id: customerId,
    customer_email: customerEmail,
    invoice_id: invoiceId,
    order_id: orderId,
    booking_id: bookingId,
    payment_id: paymentId,
    location_id: pickNested(invoice || payment || booking || order || {}, ['location_id']),
  };

  return {
    squareEventId: body.event_id || null,
    eventType: type,
    topic,
    merchantId: body.merchant_id || null,
    objectId,
    objectType: data.type || topic,
    status,
    amountCents,
    currency,
    customerId,
    customerEmail,
    invoiceId,
    orderId,
    bookingId,
    paymentId,
    squareCreatedAt: body.created_at || null,
    summary,
    payloadJson: capJson({ extracted, raw: sanitizeForStore(body) }),
  };
}

export function buildSummary({ type, topic, objectId, status, amountCents, currency }) {
  const parts = [type || topic || 'square.event'];
  if (objectId) parts.push(String(objectId).slice(0, 48));
  if (status) parts.push(status);
  if (typeof amountCents === 'number') {
    const dollars = (amountCents / 100).toFixed(2);
    parts.push(`${currency || 'USD'} ${dollars}`);
  }
  return parts.join(' · ');
}

export async function matchJobId(db, structured) {
  if (!db) return null;
  try {
    if (structured.invoiceId) {
      const byInvoice = await db
        .prepare('SELECT id FROM jobs WHERE square_invoice_id = ? LIMIT 1')
        .bind(structured.invoiceId)
        .first();
      if (byInvoice && byInvoice.id) return byInvoice.id;
    }
    if (structured.orderId) {
      const byOrder = await db
        .prepare('SELECT id FROM jobs WHERE square_order_id = ? LIMIT 1')
        .bind(structured.orderId)
        .first();
      if (byOrder && byOrder.id) return byOrder.id;
    }
    if (structured.customerEmail) {
      const byEmail = await db
        .prepare('SELECT id FROM jobs WHERE email = ? ORDER BY created_at DESC LIMIT 1')
        .bind(structured.customerEmail)
        .first();
      if (byEmail && byEmail.id) return byEmail.id;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Reflect invoice/payment status onto a matched job. One-way Square → D1,
 * same direction as united-mobile-rv syncJobInvoiceStatuses. Never throws.
 */
export async function applyEventToJob(db, structured, jobId) {
  if (!db || !jobId) return { updated: false };
  const sets = [];
  const binds = [];

  if (structured.topic === 'invoice' && structured.status) {
    sets.push('square_invoice_status = ?');
    binds.push(structured.status);
  }

  const paidLike =
    (structured.topic === 'invoice' && structured.status === 'paid') ||
    (structured.topic === 'payment' && (structured.status === 'completed' || structured.status === 'approved'));

  if (paidLike) {
    sets.push('paid_at = COALESCE(paid_at, ?)');
    binds.push(structured.squareCreatedAt || new Date().toISOString());
    sets.push("payment_method = COALESCE(payment_method, 'square')");
    if (typeof structured.amountCents === 'number') {
      sets.push('final_amount_cents = COALESCE(final_amount_cents, ?)');
      binds.push(structured.amountCents);
    }
  }

  if (!sets.length) return { updated: false, jobId };
  sets.push("updated_at = datetime('now')");
  binds.push(jobId);
  try {
    await db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return { updated: true, jobId };
  } catch {
    return { updated: false, jobId };
  }
}

export async function insertSquareEvent(db, structured, extras = {}) {
  const id = extras.id || crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO square_events (
         id, square_event_id, event_type, topic, merchant_id, object_id, object_type,
         status, amount_cents, currency, customer_id, customer_email, invoice_id,
         order_id, booking_id, payment_id, job_id, summary, payload_json,
         notify_status, notify_channel, notify_error, square_created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      structured.squareEventId,
      structured.eventType,
      structured.topic,
      structured.merchantId,
      structured.objectId,
      structured.objectType,
      structured.status,
      structured.amountCents,
      structured.currency,
      structured.customerId,
      structured.customerEmail,
      structured.invoiceId,
      structured.orderId,
      structured.bookingId,
      structured.paymentId,
      extras.jobId || null,
      structured.summary,
      structured.payloadJson,
      extras.notifyStatus || 'pending',
      extras.notifyChannel || null,
      extras.notifyError || null,
      structured.squareCreatedAt
    )
    .run();
  return id;
}

export async function findEventBySquareId(db, squareEventId) {
  if (!db || !squareEventId) return null;
  return db
    .prepare('SELECT id, notify_status FROM square_events WHERE square_event_id = ?')
    .bind(squareEventId)
    .first();
}

export async function updateEventNotify(db, id, { notifyStatus, notifyChannel, notifyError }) {
  await db
    .prepare(
      `UPDATE square_events SET notify_status = ?, notify_channel = ?, notify_error = ? WHERE id = ?`
    )
    .bind(notifyStatus, notifyChannel || null, notifyError || null, id)
    .run();
}
