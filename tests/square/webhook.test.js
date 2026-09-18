/**
 * Square webhook → D1 event path.
 * Run: node tests/square/webhook.test.js
 */
import { test, run, assert } from '../lib/tiny-test.js';
import {
  isRelevantSquareEvent,
  topicFromType,
  structureSquareEvent,
  verifySquareWebhookSignature,
  notificationUrlFrom,
  sanitizeForStore,
} from '../../functions/_lib/square-events.js';
import { onRequestGet, onRequestPost } from '../../functions/api/webhooks/square.js';

const KEY = 'test-square-webhook-signature-key';
const URL = 'https://umrt-portal.pages.dev/api/webhooks/square';

const SAMPLE = {
  merchant_id: 'MERCHANT-SANITIZED',
  type: 'invoice.payment_made',
  event_id: 'evt-sanitized-0001',
  created_at: '2026-09-18T12:00:00Z',
  data: {
    type: 'invoice',
    id: 'inv:SANITIZED',
    object: {
      invoice: {
        id: 'inv:SANITIZED',
        status: 'PAID',
        order_id: 'order-SANITIZED',
        location_id: 'LOC-SANITIZED',
        invoice_number: '000012',
        primary_recipient: { customer_id: 'CUST-SANITIZED' },
        payment_requests: [
          {
            request_type: 'BALANCE',
            total_completed_amount_money: { amount: 22500, currency: 'USD' },
          },
        ],
      },
    },
  },
};

function bytesToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function sign(rawBody, key = KEY, notificationUrl = URL) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(notificationUrl + rawBody)
  );
  return bytesToB64(sig);
}

function makeDb({ events = [], jobs = [] } = {}) {
  return {
    _events: events,
    _jobs: jobs,
    prepare(sql) {
      let args = [];
      const self = this;
      return {
        bind(...a) {
          args = a;
          return this;
        },
        async first() {
          if (/SELECT COUNT\(\*\) AS n FROM rate_limit_log/.test(sql)) return { n: 0 };
          if (/FROM square_events WHERE square_event_id/.test(sql)) {
            return self._events.find((e) => e.square_event_id === args[0]) || undefined;
          }
          if (/FROM jobs WHERE square_invoice_id/.test(sql)) {
            const job = self._jobs.find((j) => j.square_invoice_id === args[0]);
            return job ? { id: job.id } : undefined;
          }
          if (/FROM jobs WHERE square_order_id/.test(sql)) {
            const job = self._jobs.find((j) => j.square_order_id === args[0]);
            return job ? { id: job.id } : undefined;
          }
          if (/FROM jobs WHERE email/.test(sql)) {
            const job = self._jobs.find((j) => j.email === args[0]);
            return job ? { id: job.id } : undefined;
          }
          throw new Error(`mock first: ${sql}`);
        },
        async run() {
          if (/INSERT INTO rate_limit_log/.test(sql)) return { success: true };
          if (/DELETE FROM rate_limit_log/.test(sql)) return { success: true };
          if (/INSERT INTO square_events/.test(sql)) {
            const row = {
              id: args[0],
              square_event_id: args[1],
              event_type: args[2],
              topic: args[3],
              job_id: args[16],
              summary: args[17],
              notify_status: args[19],
            };
            if (self._events.some((e) => e.square_event_id === row.square_event_id)) {
              throw new Error('UNIQUE constraint failed: square_events.square_event_id');
            }
            self._events.push(row);
            return { success: true };
          }
          if (/UPDATE square_events SET notify_status/.test(sql)) {
            const row = self._events.find((e) => e.id === args[3]);
            if (row) {
              row.notify_status = args[0];
              row.notify_channel = args[1];
              row.notify_error = args[2];
            }
            return { success: true };
          }
          if (/UPDATE jobs SET/.test(sql)) {
            const id = args[args.length - 1];
            const job = self._jobs.find((j) => j.id === id);
            if (job) {
              job.updated = true;
              if (/square_invoice_status/.test(sql)) job.square_invoice_status = args[0];
              if (/paid_at/.test(sql)) job.paid_at = true;
            }
            return { success: true };
          }
          throw new Error(`mock run: ${sql}`);
        },
      };
    },
  };
}

async function postWebhook(env, body, { signature, url } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  if (signature !== false) {
    headers.set('x-square-hmacsha256-signature', signature || (await sign(raw, KEY, url || URL)));
  }
  const request = new Request(url || URL, { method: 'POST', headers, body: raw });
  return onRequestPost({ env, request });
}

test('isRelevantSquareEvent: booking/payment/invoice/refund/order only', () => {
  assert.equal(isRelevantSquareEvent('invoice.payment_made'), true);
  assert.equal(isRelevantSquareEvent('booking.created'), true);
  assert.equal(isRelevantSquareEvent('payment.updated'), true);
  assert.equal(isRelevantSquareEvent('refund.created'), true);
  assert.equal(isRelevantSquareEvent('order.updated'), true);
  assert.equal(isRelevantSquareEvent('catalog.version.updated'), false);
  assert.equal(isRelevantSquareEvent(''), false);
});

test('topicFromType maps prefixes', () => {
  assert.equal(topicFromType('invoice.payment_made'), 'invoice');
  assert.equal(topicFromType('booking.created'), 'booking');
  assert.equal(topicFromType('catalog.version.updated'), 'other');
});

test('structureSquareEvent extracts sanitized invoice payment', () => {
  const s = structureSquareEvent(SAMPLE);
  assert.equal(s.squareEventId, 'evt-sanitized-0001');
  assert.equal(s.topic, 'invoice');
  assert.equal(s.invoiceId, 'inv:SANITIZED');
  assert.equal(s.orderId, 'order-SANITIZED');
  assert.equal(s.status, 'paid');
  assert.equal(s.amountCents, 22500);
  assert.equal(s.currency, 'USD');
  assert.match(s.summary, /invoice.payment_made/);
  assert.match(s.summary, /22500|225\.00/);
  const payload = JSON.parse(s.payloadJson);
  assert.equal(payload.extracted.invoice_id, 'inv:SANITIZED');
  assert.ok(!JSON.stringify(payload).includes('card_number'));
});

test('sanitizeForStore redacts card-like keys', () => {
  const out = sanitizeForStore({ card_number: '4111111111111111', ok: 'yes' });
  assert.equal(out.card_number, '[redacted]');
  assert.equal(out.ok, 'yes');
});

test('verifySquareWebhookSignature accepts a matching HMAC', async () => {
  const raw = JSON.stringify(SAMPLE);
  const header = await sign(raw);
  const ok = await verifySquareWebhookSignature({
    rawBody: raw,
    signatureHeader: header,
    signatureKey: KEY,
    notificationUrl: URL,
  });
  assert.equal(ok, true);
});

test('verifySquareWebhookSignature rejects a bad signature', async () => {
  const ok = await verifySquareWebhookSignature({
    rawBody: JSON.stringify(SAMPLE),
    signatureHeader: 'not-a-real-signature====',
    signatureKey: KEY,
    notificationUrl: URL,
  });
  assert.equal(ok, false);
});

test('notificationUrlFrom prefers env over the request host', () => {
  const request = new Request('https://preview.pages.dev/api/webhooks/square');
  const url = notificationUrlFrom(request, {
    SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://umrt-portal.pages.dev/api/webhooks/square/',
  });
  assert.equal(url, 'https://umrt-portal.pages.dev/api/webhooks/square');
});

test('GET /api/webhooks/square is a public health check', async () => {
  const res = await onRequestGet({ env: {}, request: new Request(URL) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.path, '/api/webhooks/square');
  assert.equal(data.ok, true);
});

test('POST without signature key returns 503 not_configured', async () => {
  const res = await postWebhook({ DB: makeDb() }, SAMPLE, { signature: 'x' });
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.error, 'not_configured');
});

test('POST with a bad signature returns 401', async () => {
  const env = { DB: makeDb(), SQUARE_WEBHOOK_SIGNATURE_KEY: KEY, SQUARE_WEBHOOK_NOTIFICATION_URL: URL };
  const res = await postWebhook(env, SAMPLE, { signature: 'aaaa' });
  assert.equal(res.status, 401);
});

test('POST signed invoice.payment_made writes a structured row and stubs notify', async () => {
  const db = makeDb({
    jobs: [{ id: 'job-1', square_invoice_id: 'inv:SANITIZED', square_order_id: 'order-SANITIZED' }],
  });
  const env = { DB: db, SQUARE_WEBHOOK_SIGNATURE_KEY: KEY, SQUARE_WEBHOOK_NOTIFICATION_URL: URL };
  const res = await postWebhook(env, SAMPLE);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.topic, 'invoice');
  assert.equal(data.job_id, 'job-1');
  assert.equal(data.notify.status, 'stubbed');
  assert.equal(db._events.length, 1);
  assert.equal(db._events[0].notify_status, 'stubbed');
  assert.equal(db._jobs[0].updated, true);
});

test('POST duplicate event_id returns 200 duplicate and does not insert again', async () => {
  const db = makeDb({
    events: [{ id: 'existing', square_event_id: 'evt-sanitized-0001', notify_status: 'stubbed' }],
  });
  const env = { DB: db, SQUARE_WEBHOOK_SIGNATURE_KEY: KEY, SQUARE_WEBHOOK_NOTIFICATION_URL: URL };
  const res = await postWebhook(env, SAMPLE);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.duplicate, true);
  assert.equal(db._events.length, 1);
});

test('POST catalog.version.updated is ignored after signature check', async () => {
  const body = { merchant_id: 'M', type: 'catalog.version.updated', event_id: 'evt-cat', data: {} };
  const db = makeDb();
  const env = { DB: db, SQUARE_WEBHOOK_SIGNATURE_KEY: KEY, SQUARE_WEBHOOK_NOTIFICATION_URL: URL };
  const res = await postWebhook(env, body);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ignored, true);
  assert.equal(db._events.length, 0);
});

test('POST booking.created stores a booking topic without requiring a job', async () => {
  const body = {
    merchant_id: 'MERCHANT-SANITIZED',
    type: 'booking.created',
    event_id: 'evt-book-1',
    created_at: '2026-09-18T13:00:00Z',
    data: {
      type: 'booking',
      id: 'book-SANITIZED',
      object: { booking: { id: 'book-SANITIZED', status: 'ACCEPTED', customer_id: 'CUST-SANITIZED' } },
    },
  };
  const db = makeDb();
  const env = { DB: db, SQUARE_WEBHOOK_SIGNATURE_KEY: KEY, SQUARE_WEBHOOK_NOTIFICATION_URL: URL };
  const res = await postWebhook(env, body);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.topic, 'booking');
  assert.equal(data.job_id, null);
  assert.equal(db._events[0].event_type, 'booking.created');
});

await run();
