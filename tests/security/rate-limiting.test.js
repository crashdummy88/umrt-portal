/**
 * Regression test for the rate-limiting pass (2026-09-15): OAuth start
 * (Google/Facebook) and POST /api/vendors had no throttle at all in this
 * repo -- there was no rate-limiting infrastructure here previously.
 * functions/_lib/rate-limit.js is a near-verbatim port of the mothership
 * repo's own already-proven checkRateLimit() (same design: D1-backed
 * sliding window, fails open), not new infrastructure invented for this.
 *
 * Run: node tests/security/rate-limiting.test.js
 */
import { test, run, assert } from '../lib/tiny-test.js';
import { checkRateLimit } from '../../functions/_lib/rate-limit.js';
import { onRequestGet as googleStart } from '../../functions/api/auth/google/start.js';
import { onRequestGet as facebookStart } from '../../functions/api/auth/facebook/start.js';
import { onRequestPost as vendorsPost } from '../../functions/api/vendors/index.js';
import { signSessionId, randomToken } from '../../functions/_lib/auth.js';

const IP = '203.0.113.9'; // TEST-NET-3, RFC 5737

function makeMockD1() {
  const log = [];
  return {
    prepare(sql) {
      let boundArgs = [];
      const stmt = {
        bind(...args) {
          boundArgs = args;
          return stmt;
        },
        async first() {
          if (/SELECT COUNT\(\*\) AS n FROM rate_limit_log/.test(sql)) {
            const [ip, key] = boundArgs;
            return { n: log.filter((r) => r.ip === ip && r.endpoint === key).length };
          }
          throw new Error(`mock D1: unhandled .first(): ${sql}`);
        },
        async run() {
          if (/INSERT INTO rate_limit_log/.test(sql)) {
            const [ip, endpoint] = boundArgs;
            log.push({ ip, endpoint });
            return { success: true };
          }
          if (/DELETE FROM rate_limit_log/.test(sql)) return { success: true };
          throw new Error(`mock D1: unhandled .run(): ${sql}`);
        },
      };
      return stmt;
    },
    _log: log,
  };
}

function makeRequest(ip) {
  const headers = new Headers();
  headers.set('CF-Connecting-IP', ip);
  return { headers, url: 'https://portal.unitedmobilerv.com/api/auth/google/start' };
}

test('checkRateLimit: blocks the (max+1)th call within the window', async () => {
  const DB = makeMockD1();
  const env = { DB };
  for (let i = 1; i <= 5; i++) {
    const rl = await checkRateLimit(env, makeRequest(IP), { max: 5, windowMinutes: 10, key: 'test-key' });
    assert.equal(rl.limited, false, `call ${i} should not be limited yet`);
  }
  const sixth = await checkRateLimit(env, makeRequest(IP), { max: 5, windowMinutes: 10, key: 'test-key' });
  assert.equal(sixth.limited, true);
});

test('checkRateLimit: fails open when env.DB is missing (never blocks a real user on infra failure)', async () => {
  const rl = await checkRateLimit({}, makeRequest(IP), { max: 1, windowMinutes: 10, key: 'test-key' });
  assert.equal(rl.limited, false);
});

test('GET /api/auth/google/start: 21st request in the window is rate-limited (max=20/10min)', async () => {
  const DB = makeMockD1();
  const env = { DB, GOOGLE_CLIENT_ID: 'test-client-id' };
  let lastStatus;
  for (let i = 1; i <= 21; i++) {
    const res = await googleStart({ env, request: makeRequest(IP) });
    lastStatus = res.status;
    if (i <= 20) assert.equal(res.status, 302, `request ${i} should redirect to Google, not be blocked`);
  }
  assert.equal(lastStatus, 429);
});

test('GET /api/auth/facebook/start: 21st request in the window is rate-limited (max=20/10min)', async () => {
  const DB = makeMockD1();
  const env = { DB, FACEBOOK_APP_ID: 'test-app-id', FACEBOOK_APP_SECRET: 'test-app-secret' };
  let lastStatus;
  for (let i = 1; i <= 21; i++) {
    const res = await facebookStart({ env, request: makeRequest(IP) });
    lastStatus = res.status;
    if (i <= 20) assert.equal(res.status, 302, `request ${i} should redirect to Facebook, not be blocked`);
  }
  assert.equal(lastStatus, 429);
});

test('POST /api/vendors: 6th application attempt in the window is rate-limited (max=5/10min)', async () => {
  const log = [];
  const users = [];
  const sessions = [];
  const vendors = [];
  const DB = {
    prepare(sql) {
      let boundArgs = [];
      const stmt = {
        bind(...args) {
          boundArgs = args;
          return stmt;
        },
        async first() {
          if (/SELECT COUNT\(\*\) AS n FROM rate_limit_log/.test(sql)) {
            const [ip, key] = boundArgs;
            return { n: log.filter((r) => r.ip === ip && r.endpoint === key).length };
          }
          if (/FROM sessions s JOIN users u/.test(sql)) {
            const session = sessions.find((s) => s.id === boundArgs[0]);
            if (!session) return undefined;
            const user = users.find((u) => u.id === session.user_id);
            return user ? { id: user.id, email: user.email, expires_at: session.expires_at } : undefined;
          }
          if (/SELECT id FROM vendors WHERE user_id = \?/.test(sql)) {
            // Each attempt uses a fresh user id (see below), so "already
            // applied" never masks the rate limiter's own behavior.
            return undefined;
          }
          throw new Error(`mock D1: unhandled .first(): ${sql}`);
        },
        async run() {
          if (/INSERT INTO rate_limit_log/.test(sql)) {
            const [ip, endpoint] = boundArgs;
            log.push({ ip, endpoint });
            return { success: true };
          }
          if (/DELETE FROM rate_limit_log/.test(sql)) return { success: true };
          if (/INSERT INTO vendors/.test(sql)) {
            vendors.push({ id: boundArgs[0] });
            return { success: true };
          }
          throw new Error(`mock D1: unhandled .run(): ${sql}`);
        },
      };
      return stmt;
    },
  };
  const env = { DB, SESSION_SECRET: 'test-secret' };

  let lastStatus;
  for (let i = 1; i <= 6; i++) {
    // A distinct user per attempt -- the point under test is the shared
    // IP-based rate limit, not the one-application-per-user check.
    const uid = `u${i}`;
    users.push({ id: uid, email: `${uid}@example.com` });
    const rawId = await randomToken(24);
    sessions.push({ id: rawId, user_id: uid, expires_at: new Date(Date.now() + 86400000).toISOString() });
    const signed = await signSessionId(rawId, env.SESSION_SECRET);
    const headers = new Headers();
    headers.set('Cookie', `umrt_session=${signed}`);
    headers.set('CF-Connecting-IP', IP);
    const request = {
      headers,
      async json() {
        return { businessName: `Shop ${i}`, category: 'tech', contactEmail: `${uid}@example.com` };
      },
    };
    const res = await vendorsPost({ env, request });
    lastStatus = res.status;
    if (i <= 5) assert.notEqual(res.status, 429, `attempt ${i} should not be rate-limited yet`);
  }
  assert.equal(lastStatus, 429);
});

await run();
