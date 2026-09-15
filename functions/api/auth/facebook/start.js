import { randomToken, stateCookie, originOf, json } from '../../../_lib/auth.js';
import { checkRateLimit } from '../../../_lib/rate-limit.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    return json(
      { error: 'Facebook login not configured', code: 'FACEBOOK_NOT_CONFIGURED' },
      503
    );
  }

  // Added 2026-09-15: OAuth start had no throttle at all.
  const rl = await checkRateLimit(env, request, { max: 20, windowMinutes: 10, key: 'auth-facebook-start' });
  if (rl.limited) {
    return json({ error: 'rate_limited', retry_after: rl.retryAfter }, 429);
  }
  const origin = originOf(request);
  const redirectUri = `${origin}/api/auth/facebook/callback`;
  const state = await randomToken(24);
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: 'email,public_profile',
    response_type: 'code',
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://www.facebook.com/v19.0/dialog/oauth?${params}`,
      'Set-Cookie': stateCookie(state),
      'Cache-Control': 'no-store',
    },
  });
}
