import { randomToken, stateCookie, originOf, json } from '../../../_lib/auth.js';

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
