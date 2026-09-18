/**
 * Docs↔portal OAuth next allowlist: SOP + estimates only.
 * /guides/ and WP Field Guides must never be a return dest.
 */
import { test, run, assert } from '../lib/tiny-test.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeOAuthNext, NEXT_COOKIE } from '../../functions/_lib/oauth-next.js';
import { onRequestGet as googleStart } from '../../functions/api/auth/google/start.js';
import { onRequestGet as nextBounce } from '../../functions/api/auth/next.js';
import { signSessionId, randomToken } from '../../functions/_lib/auth.js';

const SOP = 'https://docs.unitedmobilerv.com/sop/';
const EST = 'https://docs.unitedmobilerv.com/estimates/winterize/';

test('safeOAuthNext allows docs SOP and estimates (absolute + relative)', () => {
  assert.equal(safeOAuthNext(SOP), SOP);
  assert.equal(safeOAuthNext('https://docs.unitedmobilerv.com/sop'), 'https://docs.unitedmobilerv.com/sop');
  assert.equal(safeOAuthNext('/sop/pre-trip/'), 'https://docs.unitedmobilerv.com/sop/pre-trip/');
  assert.equal(safeOAuthNext(EST), EST);
  assert.equal(safeOAuthNext('/estimates/'), 'https://docs.unitedmobilerv.com/estimates/');
});

test('safeOAuthNext rejects /guides/, /guide/, WP Field Guides, and other hosts', () => {
  assert.equal(safeOAuthNext('https://docs.unitedmobilerv.com/guides/'), null);
  assert.equal(safeOAuthNext('https://docs.unitedmobilerv.com/guides/solar/'), null);
  assert.equal(safeOAuthNext('/guides/'), null);
  assert.equal(safeOAuthNext('/guide/'), null);
  assert.equal(safeOAuthNext('https://unitedmobilerv.com/guide/'), null);
  assert.equal(safeOAuthNext('https://unitedmobilerv.com/guide/victron-fault-code-guide/'), null);
  assert.equal(safeOAuthNext('https://evil.example/sop/'), null);
  assert.equal(safeOAuthNext('http://docs.unitedmobilerv.com/sop/'), null);
  assert.equal(safeOAuthNext('javascript:alert(1)'), null);
  assert.equal(safeOAuthNext('https://docs.unitedmobilerv.com/sop-extra'), null);
  assert.equal(safeOAuthNext('/track/'), null);
  assert.equal(safeOAuthNext('https://portal.unitedmobilerv.com/account/'), null);
});

function cookieHeaderBlob(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie().join('\n');
  }
  return res.headers.get('Set-Cookie') || '';
}

function makeRateDb() {
  const log = [];
  return {
    prepare(sql) {
      let bound = [];
      return {
        bind(...a) { bound = a; return this; },
        async first() {
          if (/SELECT COUNT/.test(sql)) {
            return { n: log.filter((r) => r.ip === bound[0]).length };
          }
          return undefined;
        },
        async run() {
          if (/INSERT INTO rate_limit_log/.test(sql)) log.push({ ip: bound[0] });
          return { success: true };
        },
      };
    },
  };
}

test('Google start stores allowlisted next and clears a /guides/ next', async () => {
  const env = { DB: makeRateDb(), GOOGLE_CLIENT_ID: 'test-client-id' };
  const ok = await googleStart({
    env,
    request: new Request('https://portal.unitedmobilerv.com/api/auth/google/start?next=' + encodeURIComponent(SOP)),
  });
  assert.equal(ok.status, 302);
  const blob = cookieHeaderBlob(ok);
  assert.match(blob, new RegExp(`${NEXT_COOKIE}=`));
  assert.match(blob, /docs\.unitedmobilerv\.com%2Fsop%2F/);
  assert.doesNotMatch(blob, /guides/);

  const bad = await googleStart({
    env,
    request: new Request('https://portal.unitedmobilerv.com/api/auth/google/start?next=' + encodeURIComponent('https://docs.unitedmobilerv.com/guides/')),
  });
  assert.equal(bad.status, 302);
  const badBlob = cookieHeaderBlob(bad);
  assert.match(badBlob, new RegExp(`${NEXT_COOKIE}=;`));
  assert.doesNotMatch(badBlob, /guides/);
});

function makeSessionDb({ users, sessions }) {
  return {
    _users: users,
    _sessions: sessions,
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
            return { id: user.id, email: user.email, name: user.name, picture: null, provider: 'google', expires_at: session.expires_at };
          }
          return undefined;
        },
        async run() { return { success: true }; },
      };
    },
  };
}

test('GET /api/auth/next: 401 unsigned; SOP 302; /guides/ falls back to account', async () => {
  const secret = 'test-session-secret';
  const rawId = await randomToken(24);
  const token = await signSessionId(rawId, secret);
  const expires = new Date(Date.now() + 86400000).toISOString();
  const env = {
    SESSION_SECRET: secret,
    DB: makeSessionDb({
      users: [{ id: 'u1', email: 'pat@example.com', name: 'Pat' }],
      sessions: [{ id: rawId, user_id: 'u1', expires_at: expires }],
    }),
  };

  const noAuth = await nextBounce({
    env,
    request: new Request('https://portal.unitedmobilerv.com/api/auth/next?to=' + encodeURIComponent(SOP)),
  });
  assert.equal(noAuth.status, 401);

  const headers = { Cookie: `umrt_session=${token}` };
  const sop = await nextBounce({
    env,
    request: new Request('https://portal.unitedmobilerv.com/api/auth/next?to=' + encodeURIComponent(SOP), { headers }),
  });
  assert.equal(sop.status, 302);
  assert.equal(sop.headers.get('Location'), SOP);

  const guides = await nextBounce({
    env,
    request: new Request('https://portal.unitedmobilerv.com/api/auth/next?to=' + encodeURIComponent('https://docs.unitedmobilerv.com/guides/'), { headers }),
  });
  assert.equal(guides.status, 302);
  assert.equal(guides.headers.get('Location'), 'https://portal.unitedmobilerv.com/account/');
});

test('account page keeps default Google href and does not add Field Guides chrome', () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../account/index.html'), 'utf8');
  assert.match(html, /class="btn btn-google btn-oauth" href="\/api\/auth\/google\/start"/);
  assert.match(html, /\/api\/auth\/next\?to=/);
  assert.doesNotMatch(html, /unitedmobilerv\.com\/guide\//);
  assert.doesNotMatch(html, />Field Guides</);
});

await run();
