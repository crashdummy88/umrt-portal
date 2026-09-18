/**
 * Customer-safe jobs shaping: honest stored status, no invented Square
 * sync, draft invoice URLs withheld, dead square.link rejected.
 */
import { test, run, assert } from '../lib/tiny-test.js';
import {
  SQUARE_BOOK_URL,
  customerInvoiceUrl,
  invoiceLabel,
  jobStatusLabel,
  shapeCustomerJob,
} from '../../functions/_lib/jobs-public.js';
import { onRequestGet as jobsMine } from '../../functions/api/jobs/mine.js';
import { signSessionId, randomToken } from '../../functions/_lib/auth.js';

test('jobStatusLabel uses the stored map and does not invent Square states', () => {
  assert.equal(jobStatusLabel('requested'), 'Requested');
  assert.equal(jobStatusLabel('in_progress'), 'In progress');
  assert.equal(jobStatusLabel('cancelled'), 'Cancelled');
  assert.equal(jobStatusLabel('mystery_state'), 'mystery_state');
});

test('invoiceLabel: draft / sent / paid are honest; unknown stays raw', () => {
  assert.equal(invoiceLabel({ status: 'draft', paid: false }), 'Invoice not sent yet');
  assert.equal(invoiceLabel({ status: 'unpaid', paid: false }), 'Invoice sent');
  assert.equal(invoiceLabel({ status: 'published', paid: false }), 'Invoice sent');
  assert.equal(invoiceLabel({ status: 'paid', paid: false }), 'Paid');
  assert.equal(invoiceLabel({ status: 'draft', paid: true }), 'Paid');
  assert.equal(invoiceLabel({ status: null, paid: false }), null);
  assert.equal(invoiceLabel({ status: 'weird_custom', paid: false }), 'weird custom');
});

test('customerInvoiceUrl withholds drafts and rejects non-Square / dead pay hosts', () => {
  const live = 'https://squareup.com/pay-invoice/inv_1';
  assert.equal(customerInvoiceUrl(live, 'unpaid'), live);
  assert.equal(customerInvoiceUrl(live, 'DRAFT'), null);
  assert.equal(customerInvoiceUrl(live, 'draft'), null);
  assert.equal(customerInvoiceUrl(live, null), null);
  assert.equal(customerInvoiceUrl('https://square.link/u/STB7z2B6', 'unpaid'), null);
  assert.equal(customerInvoiceUrl('https://united-mobile-rv-llc.square.site/', 'unpaid'), null);
  assert.equal(customerInvoiceUrl('javascript:alert(1)', 'unpaid'), null);
  assert.equal(customerInvoiceUrl('https://evil.example/pay', 'unpaid'), null);
});

test('shapeCustomerJob never claims a live sync and keeps Book on Square', () => {
  const job = shapeCustomerJob({
    id: 'j1',
    full_name: 'Pat',
    issue: 'No start',
    status: 'requested',
    created_at: '2026-09-18',
    square_invoice_status: 'draft',
    square_invoice_url: 'https://squareup.com/pay-invoice/hidden',
    paid_at: null,
    final_amount_cents: 22500,
  });
  assert.equal(job.book_url, SQUARE_BOOK_URL);
  assert.equal(job.status_label, 'Requested');
  assert.equal(job.invoice.status, 'draft');
  assert.equal(job.invoice.label, 'Invoice not sent yet');
  assert.equal(job.invoice.url, null);
  assert.equal(job.invoice.paid, false);
  assert.equal(job.invoice.amount_cents, null);
  assert.equal(job.synced, undefined);
  assert.equal(job.live, undefined);
});

test('shapeCustomerJob surfaces a published Square invoice URL and paid amount', () => {
  const url = 'https://squareup.com/pay-invoice/inv_live';
  const job = shapeCustomerJob({
    id: 'j2',
    issue: 'Charging',
    status: 'completed',
    square_invoice_status: 'PAID',
    square_invoice_url: url,
    paid_at: '2026-09-18T12:00:00Z',
    final_amount_cents: 17500,
  });
  assert.equal(job.status_label, 'Completed');
  assert.equal(job.invoice.paid, true);
  assert.equal(job.invoice.label, 'Paid');
  assert.equal(job.invoice.url, url);
  assert.equal(job.invoice.amount_cents, 17500);
});

function makeJobsDb({ users = [], sessions = [], jobs = [] } = {}) {
  return {
    _users: users,
    _sessions: sessions,
    _jobs: jobs,
    prepare(sql) {
      let args = [];
      const self = this;
      return {
        bind(...a) { args = a; return this; },
        async first() {
          if (/FROM sessions s JOIN users u/.test(sql)) {
            const session = self._sessions.find((s) => s.id === args[0]);
            if (!session) return undefined;
            const user = self._users.find((u) => u.id === session.user_id);
            if (!user) return undefined;
            return { id: user.id, email: user.email, name: user.name, picture: user.picture, provider: user.provider, expires_at: session.expires_at };
          }
          throw new Error(`mock DB.first: unhandled query: ${sql}`);
        },
        async all() {
          if (/FROM jobs WHERE email = \?/.test(sql)) {
            const email = args[0];
            return { results: self._jobs.filter((j) => j.email === email) };
          }
          throw new Error(`mock DB.all: unhandled query: ${sql}`);
        },
        async run() { return { success: true }; },
      };
    },
  };
}

test('GET /api/jobs/mine: 401 without a session', async () => {
  const env = { DB: makeJobsDb(), SESSION_SECRET: 'test-session-secret' };
  const res = await jobsMine({ env, request: new Request('https://portal.unitedmobilerv.com/api/jobs/mine') });
  assert.equal(res.status, 401);
});

test('GET /api/jobs/mine: shapes stored rows and withholds draft invoice URLs', async () => {
  const secret = 'test-session-secret';
  const rawId = await randomToken(24);
  const token = await signSessionId(rawId, secret);
  const expires = new Date(Date.now() + 86400000).toISOString();
  const env = {
    SESSION_SECRET: secret,
    DB: makeJobsDb({
      users: [{ id: 'u1', email: 'pat@example.com', name: 'Pat', picture: null, provider: 'google' }],
      sessions: [{ id: rawId, user_id: 'u1', expires_at: expires }],
      jobs: [{
        id: 'job-1',
        email: 'pat@example.com',
        issue: 'House batteries dead',
        status: 'scheduled',
        created_at: '2026-09-17',
        square_invoice_status: 'draft',
        square_invoice_url: 'https://squareup.com/pay-invoice/not-yet',
        paid_at: null,
        final_amount_cents: null,
      }],
    }),
  };
  const res = await jobsMine({
    env,
    request: new Request('https://portal.unitedmobilerv.com/api/jobs/mine', {
      headers: { Cookie: `umrt_session=${token}` },
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].status_label, 'Scheduled');
  assert.equal(body.jobs[0].invoice.url, null);
  assert.equal(body.jobs[0].invoice.label, 'Invoice not sent yet');
  assert.equal(body.jobs[0].book_url, SQUARE_BOOK_URL);
  assert.equal(body.jobs[0].synced, undefined);
});

await run();
