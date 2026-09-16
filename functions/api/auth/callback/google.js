import {
  parseCookies,
  stateCookie,
  nextCookie,
  STATE_COOKIE,
  NEXT_COOKIE,
  safeNextPath,
  originOf,
  createCentralSessionCookie,
  upsertOAuthUser,
  oauthErrorRedirect,
  json,
} from '../../../_lib/auth.js';
import { createSsoCookie } from '../../../_lib/sso.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  const origin = originOf(request);
  const cookies = parseCookies(request);
  const clearState = stateCookie('', true);
  const clearNext = nextCookie('', true);
  const next = safeNextPath(cookies[NEXT_COOKIE]) || '/account/';

  if (err) {
    return oauthErrorRedirect(origin, 'oauth', [clearState, clearNext]);
  }

  if (!code || !state || !cookies[STATE_COOKIE] || cookies[STATE_COOKIE] !== state) {
    return oauthErrorRedirect(origin, 'state', [clearState, clearNext]);
  }

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  // Stage 3: login issues a CENTRAL session now, so CENTRAL_SESSION_SECRET
  // (not this app's own SESSION_SECRET) is what's actually required here.
  if (!clientId || !clientSecret || !env.CENTRAL_SESSION_SECRET || !env.DB) {
    return json({ error: 'Auth env or DB binding missing' }, 503);
  }

  const redirectUri = `${origin}/api/auth/callback/google`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    return oauthErrorRedirect(origin, 'token', [clearState, clearNext]);
  }
  const tokens = await tokenRes.json();
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) {
    return oauthErrorRedirect(origin, 'userinfo', [clearState, clearNext]);
  }
  const info = await infoRes.json();
  if (!info.email || !info.sub) {
    return oauthErrorRedirect(origin, 'email', [clearState, clearNext]);
  }

  const userId = await upsertOAuthUser(env.DB, {
    email: info.email,
    name: info.name || null,
    picture: info.picture || null,
    provider: 'google',
    providerSub: info.sub,
  });
  const sessionCookieValue = await createCentralSessionCookie(userId, env, request);

  const headers = new Headers({
    Location: `${origin}${next}`,
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', sessionCookieValue);
  headers.append('Set-Cookie', clearState);
  headers.append('Set-Cookie', clearNext);

  // Cross-subdomain SSO recognition cookie, additive -- display-only on
  // forum/docs, never grants portal account access by itself.
  if (env.SSO_SHARED_SECRET) {
    const ssoCookie = await createSsoCookie(
      { sub: info.sub, email: info.email, name: info.name || null, avatar: info.picture || null, provider: 'google' },
      env.SSO_SHARED_SECRET
    );
    headers.append('Set-Cookie', ssoCookie);
  }

  return new Response(null, { status: 302, headers });
}
