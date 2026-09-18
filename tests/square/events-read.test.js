/**
 * Admin / Claude read path for square_events.
 * Run: node tests/square/events-read.test.js
 */
import { test, run, assert } from '../lib/tiny-test.js';
import { onRequestGet as listEvents } from '../../functions/api/admin/events.js';
import { onRequestGet as getEvent } from '../../functions/api/admin/events/[id].js';
import { signSessionId, randomToken } from '../../functions/_lib/auth.js';

const SECRET = 'test-session-secret';
const TOKEN = 'claude-events-test-token';

function makeDb({ events = [], sessions = [], users = [] } = {}) {
  return {
    _events: events,
    prepare(sql) {
      let args = [];
      const self = this;
      return {
        bind(...a) {
          args = a;
          return this;
        },
        async first() {
          if (/FROM sessions s JOIN users u/.test(sql)) {
            const session = sessions.find((s) => s.id === args[0]);
            if (!session) return undefined;
            const user = users.find((u) => u.id === session.user_id);
            if (!user) return undefined;
            return {
              id: user.id,
              email: user.email,
              name: user.name,
              picture: null,
              provider: 'google',
              expires_at: session.expires_at,
            };
          }
          if (/FROM square_events WHERE id = \?/.test(sql)) {
            return self._events.find((e) => e.id === args[0]) || undefined;
          }
          throw new Error(`mock first: ${sql}`);
        },
        async all() {
          let rows = self._events.slice();
          if (/topic = \?/.test(sql)) rows = rows.filter((e) => e.topic === args[0]);
          if (/event_type = \?/.test(sql)) {
            const typeArg = /topic = \?/.test(sql) ? args[1] : args[0];
            rows = rows.filter((e) => e.event_type === typeArg);
          }
          const limit = args[args.length - 1];
          return { results: rows.slice(0, limit) };
        },
      };
    },
  };
}

function sampleEvent(overrides = {}) {
  return {
    id: 'evt-row-1',
    square_event_id: 'evt-sanitized-0001',
    event_type: 'invoice.payment_made',
    topic: 'invoice',
    merchant_id: 'MERCHANT-SANITIZED',
    object_id: 'inv:SANITIZED',
    object_type: 'invoice',
    status: 'paid',
    amount_cents: 22500,
    currency: 'USD',
    summary: 'invoice.payment_made · inv:SANITIZED · paid · USD 225.00',
    payload_json: JSON.stringify({ extracted: { invoice_id: 'inv:SANITIZED' } }),
    notify_status: 'stubbed',
    notify_channel: 'none',
    received_at: '2026-09-18T12:00:01Z',
    ...overrides,
  };
}

async function adminRequest(email = 'mattc2896@gmail.com') {
  const uid = 'admin-1';
  const rawId = await randomToken(24);
  const signed = await signSessionId(rawId, SECRET);
  const headers = new Headers();
  headers.set('Cookie', `umrt_session=${signed}`);
  return {
    request: new Request('https://umrt-portal.pages.dev/api/admin/events', { headers }),
    dbParts: {
      users: [{ id: uid, email }],
      sessions: [{ id: rawId, user_id: uid, expires_at: new Date(Date.now() + 86400000).toISOString() }],
    },
  };
}

test('GET /api/admin/events: anonymous is 401', async () => {
  const res = await listEvents({
    env: { DB: makeDb(), SESSION_SECRET: SECRET },
    request: new Request('https://umrt-portal.pages.dev/api/admin/events'),
  });
  assert.equal(res.status, 401);
});

test('GET /api/admin/events: non-admin session is 401', async () => {
  const { request, dbParts } = await adminRequest('customer@example.com');
  const res = await listEvents({
    env: { DB: makeDb(dbParts), SESSION_SECRET: SECRET },
    request,
  });
  assert.equal(res.status, 401);
});

test('GET /api/admin/events: admin session lists events', async () => {
  const { request, dbParts } = await adminRequest();
  const res = await listEvents({
    env: {
      DB: makeDb({ ...dbParts, events: [sampleEvent()] }),
      SESSION_SECRET: SECRET,
    },
    request,
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.read_as, 'admin_session');
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].event_type, 'invoice.payment_made');
  assert.equal(data.webhook.path, '/api/webhooks/square');
  assert.equal(data.notify.configured, false);
});

test('GET /api/admin/events: Claude bearer token works when CLAUDE_EVENTS_TOKEN is set', async () => {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${TOKEN}`);
  const res = await listEvents({
    env: {
      DB: makeDb({ events: [sampleEvent()] }),
      CLAUDE_EVENTS_TOKEN: TOKEN,
    },
    request: new Request('https://umrt-portal.pages.dev/api/admin/events?full=1', { headers }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.read_as, 'claude_token');
  assert.equal(data.events[0].payload.extracted.invoice_id, 'inv:SANITIZED');
});

test('GET /api/admin/events: wrong bearer token is 401', async () => {
  const headers = new Headers();
  headers.set('Authorization', 'Bearer wrong-token');
  const res = await listEvents({
    env: { DB: makeDb({ events: [sampleEvent()] }), CLAUDE_EVENTS_TOKEN: TOKEN },
    request: new Request('https://umrt-portal.pages.dev/api/admin/events', { headers }),
  });
  assert.equal(res.status, 401);
});

test('GET /api/admin/events/:id returns one event', async () => {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${TOKEN}`);
  const res = await getEvent({
    env: { DB: makeDb({ events: [sampleEvent()] }), CLAUDE_EVENTS_TOKEN: TOKEN },
    request: new Request('https://umrt-portal.pages.dev/api/admin/events/evt-row-1', { headers }),
    params: { id: 'evt-row-1' },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.event.id, 'evt-row-1');
  assert.equal(data.event.payload.extracted.invoice_id, 'inv:SANITIZED');
});

test('GET /api/admin/events/:id missing is 404', async () => {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${TOKEN}`);
  const res = await getEvent({
    env: { DB: makeDb({ events: [] }), CLAUDE_EVENTS_TOKEN: TOKEN },
    request: new Request('https://umrt-portal.pages.dev/api/admin/events/nope', { headers }),
    params: { id: 'nope' },
  });
  assert.equal(res.status, 404);
});

await run();
