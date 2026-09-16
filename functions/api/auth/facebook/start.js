import { randomToken, stateCookie, nextCookie, safeNextPath, originOf, json } from '../../../_lib/auth.js';
import { checkRateLimit } from '../../../_lib/rate-limit.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;
  const origin = originOf(request);
  if (!appId || !appSecret) {
    // Browser start URL — send people back to Account instead of a raw 503 JSON page.
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${origin}/account/?error=facebook`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // Added 2026-09-15: OAuth start had no throttle at all.
  const rl = await checkRateLimit(env, request, { max: 20, windowMinutes: 10, key: 'auth-facebook-start' });
  if (rl.limited) {
    return json({ error: 'rate_limited', retry_after: rl.retryAfter }, 429);
  }
  const redirectUri = `${origin}/api/auth/facebook/callback`;
  const state = await randomToken(24);
  const next = safeNextPath(new URL(request.url).searchParams.get('next'));
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: 'email,public_profile',
    response_type: 'code',
  });
  const headers = new Headers({
    Location: `https://www.facebook.com/v19.0/dialog/oauth?${params}`,
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', stateCookie(state));
  headers.append('Set-Cookie', next ? nextCookie(next) : nextCookie('', true));
  return new Response(null, { status: 302, headers });
}
