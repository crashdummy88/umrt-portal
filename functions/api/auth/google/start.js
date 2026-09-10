import {
  randomToken,
  stateCookie,
  STATE_COOKIE,
  originOf,
  json,
} from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return json({ error: 'GOOGLE_CLIENT_ID not configured' }, 503);
  }
  const origin = originOf(request);
  const redirectUri = `${origin}/api/auth/google/callback`;
  const state = await randomToken(24);
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
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': stateCookie(state),
      'Cache-Control': 'no-store',
    },
  });
}
