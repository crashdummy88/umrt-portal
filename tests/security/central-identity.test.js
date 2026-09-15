/**
 * Regression tests for auth-unification Stage 2 (2026-09-15), portal
 * side: functions/_lib/central-identity.js and the new functions/
 * _middleware.js that uses it. Log-only stage -- confirms (1) identity
 * resolution is correct when the portal's own session exists, (2)
 * client-supplied X-User-Id/X-User-Role headers are ALWAYS stripped
 * regardless of resolution outcome (the header-spoofing defense).
 *
 * Run: node tests/security/central-identity.test.js
 */
import { test, run, assert } from '../lib/tiny-test.js';
import { signSessionId, randomToken } from '../../functions/_lib/auth.js';
import { resolveCentralIdentity } from '../../functions/_lib/central-identity.js';
import { onRequest as middleware } from '../../functions/_middleware.js';

const SECRET = 'test-session-secret';

function makeMockDb({ users, sessions }) {
  return {
    prepare(sql) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async first() {
          if (/FROM sessions s JOIN users u/.test(sql)) {
            const session = sessions.find((s) => s.id === args[0]);
            if (!session) return undefined;
            const user = users.find((u) => u.id === session.user_id);
            return user ? { id: user.id, email: user.email, expires_at: session.expires_at } : undefined;
          }
          if (/SELECT is_mod, banned FROM users WHERE id = \?/.test(sql)) {
            const u = users.find((u) => u.id === args[0]);
            return u ? { is_mod: u.is_mod ? 1 : 0, banned: u.banned ? 1 : 0 } : undefined;
          }
          throw new Error(`mock DB: unhandled query: ${sql}`);
        },
      };
    },
  };
}

async function cookieFor(env, uid, users, sessions) {
  const rawId = await randomToken(24);
  sessions.push({ id: rawId, user_id: uid, expires_at: new Date(Date.now() + 86400000).toISOString() });
  const signed = await signSessionId(rawId, env.SESSION_SECRET);
  return `umrt_session=${signed}`;
}

function makeRequest(url, { cookie, extraHeaders } = {}) {
  const headers = new Headers(extraHeaders || {});
  if (cookie) headers.set('Cookie', cookie);
  return new Request(url, { headers });
}

test('resolveCentralIdentity: no session -> null', async () => {
  const env = { SESSION_SECRET: SECRET, DB: makeMockDb({ users: [], sessions: [] }) };
  const identity = await resolveCentralIdentity(makeRequest('https://portal.unitedmobilerv.com/'), env);
  assert.equal(identity, null);
});

test('resolveCentralIdentity: real session -> resolves id + role correctly', async () => {
  const users = [{ id: 'u1', email: 'member@example.com', is_mod: 0, banned: 0 }];
  const sessions = [];
  const env = { SESSION_SECRET: SECRET, DB: makeMockDb({ users, sessions }) };
  const cookie = await cookieFor(env, 'u1', users, sessions);
  const identity = await resolveCentralIdentity(makeRequest('https://portal.unitedmobilerv.com/', { cookie }), env);
  assert.deepEqual(identity, { id: 'u1', role: 'member' });
});

test('resolveCentralIdentity: mod flag resolves correctly', async () => {
  const users = [{ id: 'u2', email: 'mod@example.com', is_mod: 1, banned: 0 }];
  const sessions = [];
  const env = { SESSION_SECRET: SECRET, DB: makeMockDb({ users, sessions }) };
  const cookie = await cookieFor(env, 'u2', users, sessions);
  const identity = await resolveCentralIdentity(makeRequest('https://portal.unitedmobilerv.com/', { cookie }), env);
  assert.equal(identity.role, 'mod');
});

function makeNextCapture() {
  const calls = [];
  const next = async (req) => { calls.push(req); return new Response('ok', { status: 200 }); };
  return { next, calls };
}

test('middleware: a client-supplied X-User-Id/X-User-Role is ALWAYS stripped, even with no session (THE SECURITY FIX)', async () => {
  const env = { SESSION_SECRET: SECRET, DB: makeMockDb({ users: [], sessions: [] }) };
  const { next, calls } = makeNextCapture();
  const request = makeRequest('https://portal.unitedmobilerv.com/account/', {
    extraHeaders: { 'X-User-Id': 'attacker-supplied', 'X-User-Role': 'admin' },
  });
  await middleware({ request, env, next });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get('X-User-Id'), null, 'attacker-supplied X-User-Id must never reach downstream code');
  assert.equal(calls[0].headers.get('X-User-Role'), null, 'attacker-supplied X-User-Role must never reach downstream code');
});

test('middleware: a resolved identity IS attached for downstream code to eventually use (Stage 3)', async () => {
  const users = [{ id: 'u3', email: 'real@example.com', is_mod: 0, banned: 0 }];
  const sessions = [];
  const env = { SESSION_SECRET: SECRET, DB: makeMockDb({ users, sessions }) };
  const cookie = await cookieFor(env, 'u3', users, sessions);
  const { next, calls } = makeNextCapture();
  const request = makeRequest('https://portal.unitedmobilerv.com/account/', { cookie });
  await middleware({ request, env, next });
  assert.equal(calls[0].headers.get('X-User-Id'), 'u3');
  assert.equal(calls[0].headers.get('X-User-Role'), 'member');
});

await run();
