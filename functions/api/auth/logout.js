import { destroySession, sessionCookie } from '../../_lib/auth.js';
import { clearSsoCookie } from '../../_lib/sso.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (env.SESSION_SECRET && env.DB) {
    await destroySession(env.DB, request, env.SESSION_SECRET);
  }

  // Fixed 2026-09-15: this only ever cleared umrt_session. The separate
  // cross-subdomain umrt_sso cookie (set alongside it on login, 30-day
  // expiry) was never touched, so /api/auth/me kept falling back to it
  // after logout and returning a 200 {user: {...}} -- indistinguishable
  // from a real session to the account page's UI, which made "Log out"
  // look broken (page reloads, still shows signed in). clearSsoCookie()
  // already existed for this, it just wasn't wired into logout.
  //
  // json() can't carry two Set-Cookie headers (plain object, same key
  // collides) -- build the Response directly with a real Headers object,
  // same pattern used in api/auth/callback/google.js.
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', sessionCookie('', true));
  headers.append('Set-Cookie', clearSsoCookie());
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function onRequestGet(context) {
  return onRequestPost(context);
}
