/**
 * Regression tests for auth-unification Stage 3 (2026-09-15), portal
 * side: functions/_lib/auth.js's dual-format getSessionUser()/
 * destroySession(), and createCentralSessionCookie().
 *
 * The core promise under test: an EXISTING portal user's pre-Stage-3
 * session (randomToken(24) id, signed with this app's own SESSION_SECRET,
 * host-only cookie) must keep authenticating exactly as before -- nobody
 * gets silently signed out by this deploy -- while a NEW central session
 * (crypto.randomUUID() id, signed with the cross-app-shared
 * CENTRAL_SESSION_SECRET, Domain=.unitedmobilerv.com cookie) works
 * end-to-end and fails closed on tampering, staleness, or a secret
 * mismatch (which is exactly what "forum and portal disagree on the
 * shared secret" would look like in production).
 *
 * Run: node tests/security/session-stage3.test.js
 */
import { test, run, assert } from '../lib/tiny-test.js';
import {
  createSession,
  createCentralSessionCookie,
  getSessionUser,
  destroySession,
  sessionCookie,
  clearCentralSessionCookie,
  signSessionId,
  randomToken,
} from '../../functions/_lib/auth.js';

const SECRET = 'test-session-secret';
// Deliberately a DIFFERENT value -- production keeps these two separate:
// SESSION_SECRET stays app-local (legacy format only), CENTRAL_SESSION_SECRET
// is the one set to the SAME value on both this project and united-mobile-rv's.
const CENTRAL_SECRET = 'test-central-session-secret';

function makeDb({ sessions = [], users = [] } = {}) {
  return {
    _sessions: sessions,
    _users: users,
    prepare(sql) {
      let args = [];
      const self = this;
      return {
        bind(...a) { args = a; return this; },
        async run() {
          if (/INSERT INTO sessions/.test(sql)) {
            const [id, user_id, expires_at] = args;
            self._sessions.push({ id, user_id, expires_at });
          } else if (/DELETE FROM sessions WHERE id = \?/.test(sql)) {
            self._sessions = self._sessions.filter((s) => s.id !== args[0]);
          } else {
            throw new Error(`mock DB.run: unhandled query: ${sql}`);
          }
          return { success: true };
        },
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
      };
    },
  };
}

function makeRequest(cookieValue) {
  const headers = new Headers();
  if (cookieValue) headers.set('Cookie', `umrt_session=${cookieValue}`);
  return { headers };
}

// --- getSessionUser(): legacy format still works ---------------------------

test('getSessionUser: pre-Stage-3 legacy session still authenticates (backward compatibility promise)', async () => {
  const db = makeDb({ users: [{ id: 'u1', email: 'legacy@example.com', name: 'Legacy User', picture: null, provider: 'google' }] });
  const rawId = await randomToken(24);
  db._sessions.push({ id: rawId, user_id: 'u1', expires_at: new Date(Date.now() + 86400000).toISOString() });
  const token = await signSessionId(rawId, SECRET);

  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: db };
  const user = await getSessionUser(env, makeRequest(token));
  assert.equal(user.id, 'u1');
  assert.equal(user.email, 'legacy@example.com');
});

test('getSessionUser: legacy session signed with the wrong secret fails closed', async () => {
  const db = makeDb({ users: [{ id: 'u1', email: 'x@example.com' }] });
  const rawId = await randomToken(24);
  db._sessions.push({ id: rawId, user_id: 'u1', expires_at: new Date(Date.now() + 86400000).toISOString() });
  const token = await signSessionId(rawId, 'a-different-secret');

  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: db };
  const user = await getSessionUser(env, makeRequest(token));
  assert.equal(user, null);
});

test('getSessionUser: no cookie at all -> null', async () => {
  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: makeDb() };
  const user = await getSessionUser(env, makeRequest(null));
  assert.equal(user, null);
});

// --- getSessionUser(): new central format works -----------------------------

test('getSessionUser: new central (Stage 3) session authenticates via the shared secret and the same sessions table', async () => {
  const db = makeDb({ users: [{ id: 'u2', email: 'central@example.com', name: 'Central User', picture: 'c.png', provider: 'google' }] });
  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: db };

  const cookie = await createCentralSessionCookie('u2', env);
  assert.match(cookie, /Domain=\.unitedmobilerv\.com/, 'central session cookie must be scoped to the whole domain tree');
  const cookieValue = cookie.split('umrt_session=')[1].split(';')[0];

  const user = await getSessionUser(env, makeRequest(cookieValue));
  assert.deepEqual(user, { id: 'u2', email: 'central@example.com', name: 'Central User', picture: 'c.png', provider: 'google' });
});

test('getSessionUser: central session cookie only verifies against the SAME CENTRAL_SESSION_SECRET it was signed with (models a forum/portal secret mismatch)', async () => {
  const db = makeDb({ users: [{ id: 'u3', email: 'x@example.com' }] });
  const issuingEnv = { CENTRAL_SESSION_SECRET: 'shared-secret-v1', DB: db };
  const cookie = await createCentralSessionCookie('u3', issuingEnv);
  const cookieValue = cookie.split('umrt_session=')[1].split(';')[0];

  const mismatchedEnv = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: 'a-DIFFERENT-secret', DB: db };
  const user = await getSessionUser(mismatchedEnv, makeRequest(cookieValue));
  assert.equal(user, null, 'must fail closed rather than trust a session signed with a different secret');

  const matchedEnv = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: 'shared-secret-v1', DB: db };
  const okUser = await getSessionUser(matchedEnv, makeRequest(cookieValue));
  assert.equal(okUser.id, 'u3', 'sanity check: the same secret does successfully verify it');
});

test('getSessionUser: expired central session fails closed and deletes the row', async () => {
  const db = makeDb({ users: [{ id: 'u4', email: 'x@example.com' }] });
  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: db };
  const cookie = await createCentralSessionCookie('u4', env);
  const cookieValue = cookie.split('umrt_session=')[1].split(';')[0];
  db._sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();

  const user = await getSessionUser(env, makeRequest(cookieValue));
  assert.equal(user, null);
  assert.equal(db._sessions.length, 0, 'expired session row should be cleaned up');
});

test('getSessionUser: session row missing entirely (e.g. already logged out elsewhere) -> null', async () => {
  const db = makeDb({ users: [{ id: 'u5', email: 'x@example.com' }] });
  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: db };
  const cookie = await createCentralSessionCookie('u5', env);
  const cookieValue = cookie.split('umrt_session=')[1].split(';')[0];
  db._sessions = []; // simulate the row having already been deleted

  const user = await getSessionUser(env, makeRequest(cookieValue));
  assert.equal(user, null);
});

test('getSessionUser: unconfigured DB returns null rather than throwing', async () => {
  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: undefined };
  const user = await getSessionUser(env, makeRequest('anything.here'));
  assert.equal(user, null);
});

// --- destroySession(): deletes the row regardless of which format it is ----

test('destroySession: deletes the row for a legacy-format session', async () => {
  const db = makeDb({ users: [{ id: 'u6', email: 'x@example.com' }] });
  const rawId = await randomToken(24);
  db._sessions.push({ id: rawId, user_id: 'u6', expires_at: new Date(Date.now() + 86400000).toISOString() });
  const token = await signSessionId(rawId, SECRET);
  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: db };

  assert.equal(db._sessions.length, 1);
  await destroySession(env, makeRequest(token));
  assert.equal(db._sessions.length, 0);
});

test('destroySession: deletes the row for a central-format session', async () => {
  const db = makeDb({ users: [{ id: 'u7', email: 'x@example.com' }] });
  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: db };
  const cookie = await createCentralSessionCookie('u7', env);
  const cookieValue = cookie.split('umrt_session=')[1].split(';')[0];

  assert.equal(db._sessions.length, 1);
  await destroySession(env, makeRequest(cookieValue));
  assert.equal(db._sessions.length, 0);
});

test('destroySession: no-ops harmlessly with no cookie at all', async () => {
  const db = makeDb();
  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: db };
  await destroySession(env, makeRequest(null)); // must not throw
  assert.equal(db._sessions.length, 0);
});

// --- Cookie shapes -----------------------------------------------------------

test('sessionCookie / clearCentralSessionCookie: Domain attributes match their create-side counterparts', async () => {
  const legacy = sessionCookie('sometoken');
  const central = await createCentralSessionCookie('u8', { CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: makeDb() });
  assert.equal(/Domain=/.test(legacy), false, 'legacy cookie is host-only, no Domain attribute');
  assert.equal(/Domain=/.test(sessionCookie('', true)), false, 'legacy clear must also be host-only to actually match and clear it');
  assert.match(central, /Domain=\.unitedmobilerv\.com/);
  assert.match(clearCentralSessionCookie(), /Domain=\.unitedmobilerv\.com/);
});

// --- createSession (legacy path) still works, unchanged ---------------------

test('createSession (legacy, kept for backward compat) still produces a token getSessionUser accepts', async () => {
  const db = makeDb({ users: [{ id: 'u9', email: 'x@example.com' }] });
  const env = { SESSION_SECRET: SECRET, CENTRAL_SESSION_SECRET: CENTRAL_SECRET, DB: db };
  const token = await createSession(db, 'u9', SECRET);
  const user = await getSessionUser(env, makeRequest(token));
  assert.equal(user.id, 'u9');
});

await run();
