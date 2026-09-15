/**
 * Regression test for the logout bug reported 2026-09-15: "you click sign
 * out and it won't sign out."
 *
 * Root cause, confirmed by reading the real code: logout only ever cleared
 * the `umrt_session` cookie. The separate cross-subdomain `umrt_sso`
 * display cookie (set alongside it on login, 30-day expiry, meant to let
 * forum/docs recognize a portal login and vice versa) was never touched.
 * After logout, /api/auth/me fell back to the still-alive umrt_sso cookie
 * and returned 200 {user: {...}} -- indistinguishable from a real session
 * to the account page's UI, which re-rendered "Signed in" on every reload.
 *
 * Fix has two parts, both tested here:
 *   1. functions/api/auth/logout.js now also sends a second Set-Cookie
 *      clearing umrt_sso (clearSsoCookie() already existed, was unused).
 *   2. account/index.html no longer treats a `ssoOnly: true` identity from
 *      /api/auth/me as a real sign-in -- defense in depth for the same
 *      failure class via a different path (recognized via forum/docs
 *      login, never actually signed into the portal itself).
 *
 * Updated 2026-09-15 alongside auth-unification Stage 3: logout now sends
 * a THIRD Set-Cookie too, clearing the new Domain-wide central session
 * cookie (same umrt_session name, but Domain=.unitedmobilerv.com) --
 * without it, a Stage-3 central session would survive "logout" since a
 * clearing Set-Cookie only matches a cookie with the same Domain
 * attribute it was originally set with.
 *
 * Run: node tests/security/logout-clears-sso.test.js
 */
import fs from 'node:fs';
import { test, run, assert } from '../lib/tiny-test.js';
import { onRequestPost as logoutHandler } from '../../functions/api/auth/logout.js';

function makeRequest(cookie) {
  const headers = new Headers();
  if (cookie) headers.set('Cookie', cookie);
  return { headers };
}

test('POST /api/auth/logout sends Set-Cookie for umrt_session (both shapes) and umrt_sso (THE FIX + Stage 3)', async () => {
  const env = {}; // no DB/secrets needed -- destroySession() no-ops, cookie-clearing still runs
  const res = await logoutHandler({ env, request: makeRequest('umrt_session=abc.def; umrt_sso=ghi.jkl') });
  assert.equal(res.status, 200);

  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [...res.headers.entries()].filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v);

  assert.equal(setCookies.length, 3, `expected 3 Set-Cookie headers, got ${setCookies.length}: ${JSON.stringify(setCookies)}`);
  const sessionClears = setCookies.filter((c) => c.startsWith('umrt_session=') && c.includes('Max-Age=0'));
  assert.equal(sessionClears.length, 2, 'expected umrt_session cleared in BOTH shapes (legacy host-only + Stage 3 Domain-wide)');
  assert.ok(sessionClears.some((c) => !c.includes('Domain=')), 'expected a host-only clear (matches the legacy cookie)');
  assert.ok(sessionClears.some((c) => c.includes('Domain=.unitedmobilerv.com')), 'expected a Domain-wide clear (matches a Stage 3 central cookie)');
  assert.ok(setCookies.some((c) => c.startsWith('umrt_sso=') && c.includes('Max-Age=0')), 'expected umrt_sso cleared (THE FIX -- this is what was missing)');
});

test('cleared umrt_sso cookie targets the shared cross-subdomain domain, not just this host', async () => {
  const res = await logoutHandler({ env: {}, request: makeRequest('') });
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [...res.headers.entries()].filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v);
  const ssoCookie = setCookies.find((c) => c.startsWith('umrt_sso='));
  assert.ok(ssoCookie, 'umrt_sso Set-Cookie missing');
  assert.ok(ssoCookie.includes('Domain=.unitedmobilerv.com'), `expected the cleared cookie to carry the same Domain it was set with, got: ${ssoCookie}`);
});

test('account/index.html (as actually shipped) never renders the signed-in view for an ssoOnly identity', () => {
  const html = fs.readFileSync(new URL('../../account/index.html', import.meta.url), 'utf8');
  // The exact regression: `if (data && data.user)` with no ssoOnly check
  // would make this assertion fail against the pre-fix file.
  assert.ok(
    /if\s*\(\s*data\s*&&\s*data\.user\s*&&\s*!data\.user\.ssoOnly\s*\)/.test(html),
    'expected the signed-in branch to explicitly exclude ssoOnly identities -- the account page can otherwise show "Signed in" for a display-only cross-subdomain cookie, the same bug class as the logout issue'
  );
});

await run();
