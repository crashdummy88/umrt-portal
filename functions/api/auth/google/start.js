import {
  randomToken,
  stateCookie,
  nextCookie,
  safeNextPath,
  originOf,
  json,
} from '../../../_lib/auth.js';
import { checkRateLimit } from '../../../_lib/rate-limit.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return json({ error: 'GOOGLE_CLIENT_ID not configured' }, 503);
  }

  // Added 2026-09-15: OAuth start had no throttle at all.
  const rl = await checkRateLimit(env, request, { max: 20, windowMinutes: 10, key: 'auth-google-start' });
  if (rl.limited) {
    return json({ error: 'rate_limited', retry_after: rl.retryAfter }, 429);
  }
  const origin = originOf(request);
  const redirectUri = `${origin}/api/auth/callback/google`;
  const state = await randomToken(24);
  const next = safeNextPath(new URL(request.url).searchParams.get('next'));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  const headers = new Headers({
    Location: url,
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', stateCookie(state));
  headers.append('Set-Cookie', next ? nextCookie(next) : nextCookie('', true));
  return new Response(null, { status: 302, headers });
}
