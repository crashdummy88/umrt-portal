import {
  parseCookies,
  stateCookie,
  sessionCookie,
  STATE_COOKIE,
  originOf,
  createSession,
  upsertOAuthUser,
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
  const clearState = stateCookie('', true);

  if (err) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/account/?error=oauth`, 'Set-Cookie': clearState },
    });
  }

  const cookies = parseCookies(request);
  if (!code || !state || !cookies[STATE_COOKIE] || cookies[STATE_COOKIE] !== state) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/account/?error=state`, 'Set-Cookie': clearState },
    });
  }

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const secret = env.SESSION_SECRET;
  if (!clientId || !clientSecret || !secret || !env.DB) {
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
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/account/?error=token`, 'Set-Cookie': clearState },
    });
  }
  const tokens = await tokenRes.json();
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/account/?error=userinfo`, 'Set-Cookie': clearState },
    });
  }
  const info = await infoRes.json();
  if (!info.email || !info.sub) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/account/?error=email`, 'Set-Cookie': clearState },
    });
  }

  const userId = await upsertOAuthUser(env.DB, {
    email: info.email,
    name: info.name || null,
    picture: info.picture || null,
    provider: 'google',
    providerSub: info.sub,
  });
  const sessionToken = await createSession(env.DB, userId, secret);

  const headers = new Headers({
    Location: `${origin}/account/`,
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', sessionCookie(sessionToken));
  headers.append('Set-Cookie', clearState);

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
