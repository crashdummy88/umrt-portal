/**
 * umrt-square-events Worker.
 * Run: node workers/umrt-square-events/tests/worker.test.js
 */
import { test, run, assert } from '../../../tests/lib/tiny-test.js';
import worker from '../src/index.js';

const KEY = 'test-square-webhook-signature-key';
const ORIGIN = 'https://umrt-square-events-staging.mattc2896.workers.dev';
const TOKEN = 'claude-events-test-token';

const SAMPLE = {
  merchant_id: 'MERCHANT-SANITIZED',
  type: 'invoice.payment_made',
  event_id: 'evt-worker-0001',
  created_at: '2026-09-18T12:00:00Z',
  data: {
    type: 'invoice',
    id: 'inv:SANITIZED',
    object: {
      invoice: {
        id: 'inv:SANITIZED',
        status: 'PAID',
        order_id: 'order-SANITIZED',
        payment_requests: [
          { request_type: 'BALANCE', total_completed_amount_money: { amount: 22500, currency: 'USD' } },
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

async function sign(raw, notificationUrl = `${ORIGIN}/webhook`) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(notificationUrl + raw));
  return bytesToB64(sig);
}

function makeDb({ events = [] } = {}) {
  return {
    _events: events,
    prepare(sql) {
      let args = [];
      const self = this;
      return {
        bind(...a) { args = a; return this; },
        async first() {
          if (/FROM square_events WHERE square_event_id/.test(sql)) {
            return self._events.find((e) => e.square_event_id === args[0]);
          }
          if (/FROM square_events WHERE id = \?/.test(sql)) {
            return self._events.find((e) => e.id === args[0]);
          }
          throw new Error(`mock first: ${sql}`);
        },
        async all() {
          return { results: self._events.slice(0, args[args.length - 1] || 50) };
        },
        async run() {
          if (/INSERT INTO square_events/.test(sql)) {
            self._events.push({
              id: args[0],
              square_event_id: args[1],
              event_type: args[2],
              topic: args[3],
              notify_status: args[19],
              payload_json: args[18],
              summary: args[17],
            });
            return { success: true };
          }
          if (/UPDATE square_events SET notify_status/.test(sql)) {
            const row = self._events.find((e) => e.id === args[3]);
            if (row) row.notify_status = args[0];
            return { success: true };
          }
          throw new Error(`mock run: ${sql}`);
        },
      };
    },
  };
}

function env(extra = {}) {
  return {
    DB: makeDb(),
    SQUARE_WEBHOOK_SIGNATURE_KEY: KEY,
    SQUARE_WEBHOOK_NOTIFICATION_URL: `${ORIGIN}/webhook`,
    CLAUDE_EVENTS_TOKEN: TOKEN,
    WORKER_NAME: 'umrt-square-events-staging',
    ENVIRONMENT: 'staging',
    ...extra,
  };
}

async function post(path, body, { signature, environment } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (signature !== false) {
    headers.set('x-square-hmacsha256-signature', signature || await sign(raw));
  }
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: raw }), environment || env());
}

test('GET /webhook health names the Worker and does not change Book land', async () => {
  const res = await worker.fetch(new Request(`${ORIGIN}/webhook`), env());
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.worker, 'umrt-square-events-staging');
  assert.equal(data.path, '/webhook');
  assert.equal(data.book_land, 'https://united-mobile-rv-llc.square.site/');
});

test('POST /webhook without signature key is 503', async () => {
  const res = await post('/webhook', SAMPLE, {
    environment: env({ SQUARE_WEBHOOK_SIGNATURE_KEY: '' }),
  });
  assert.equal(res.status, 503);
});

test('POST /webhook rejects a bad HMAC before any write', async () => {
  const e = env();
  const res = await post('/webhook', SAMPLE, { signature: 'nope', environment: e });
  assert.equal(res.status, 401);
  assert.equal(e.DB._events.length, 0);
});

test('POST /webhook stores a structured invoice event and stubs notify', async () => {
  const e = env();
  const res = await post('/webhook', SAMPLE, { environment: e });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.topic, 'invoice');
  assert.equal(data.notify.status, 'stubbed');
  assert.equal(e.DB._events.length, 1);
  assert.equal(e.DB._events[0].notify_status, 'stubbed');
});

test('POST /webhook is idempotent on square event_id', async () => {
  const e = env();
  await post('/webhook', SAMPLE, { environment: e });
  const res = await post('/webhook', SAMPLE, { environment: e });
  const data = await res.json();
  assert.equal(data.duplicate, true);
  assert.equal(e.DB._events.length, 1);
});

test('GET /events requires CLAUDE_EVENTS_TOKEN', async () => {
  const denied = await worker.fetch(new Request(`${ORIGIN}/events`), env());
  assert.equal(denied.status, 401);
  const ok = await worker.fetch(new Request(`${ORIGIN}/events?full=1`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  }), env({ DB: makeDb({ events: [{
    id: 'row-1',
    square_event_id: 'evt-worker-0001',
    event_type: 'invoice.payment_made',
    topic: 'invoice',
    summary: 'invoice.payment_made',
    payload_json: '{"extracted":{"invoice_id":"inv:SANITIZED"}}',
  }] }) }));
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.read_as, 'claude_token');
  assert.equal(data.events[0].payload.extracted.invoice_id, 'inv:SANITIZED');
});

await run();
