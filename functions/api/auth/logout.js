import { destroySession, sessionCookie, clearCentralSessionCookie } from '../../_lib/auth.js';
import { clearSsoCookie } from '../../_lib/sso.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  // destroySession() (Stage 3) figures out which format the cookie is in
  // and deletes the right sessions row either way.
  await destroySession(env, request);

  // Fixed 2026-09-15: this only ever cleared umrt_session. The separate
  // cross-subdomain umrt_sso cookie (set alongside it on login, 30-day
  // expiry) was never touched, so /api/auth/me kept falling back to it
  // after logout and returning a 200 {user: {...}} -- indistinguishable
  // from a real session to the account page's UI, which made "Log out"
  // look broken (page reloads, still shows signed in). clearSsoCookie()
  // already existed for this, it just wasn't wired into logout.
  //
  // Stage 3 addendum (same day): also clear the NEW Domain-wide central
  // cookie, not just the legacy host-only one -- a clearing Set-Cookie
  // must match the original's Domain attribute exactly or it silently
  // no-ops (same rule the SSO cookie fix above already relies on), so
  // both shapes have to be sent since we don't know in advance which one
  // this browser actually holds.
  //
  // json() can't carry multiple Set-Cookie headers (plain object, same key
  // collides) -- build the Response directly with a real Headers object,
  // same pattern used in api/auth/callback/google.js.
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', sessionCookie('', true));
  headers.append('Set-Cookie', clearCentralSessionCookie());
  headers.append('Set-Cookie', clearSsoCookie());
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function onRequestGet(context) {
  return onRequestPost(context);
}
