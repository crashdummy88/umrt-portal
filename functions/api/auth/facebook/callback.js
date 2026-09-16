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

export async function onRequestGet(context) {
  const { env, request } = context;
  const origin = originOf(request);
  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    return oauthErrorRedirect(origin, 'facebook');
  }
  // Stage 3: login issues a CENTRAL session now, so CENTRAL_SESSION_SECRET
  // (not this app's own SESSION_SECRET) is what's actually required here.
  if (!env.CENTRAL_SESSION_SECRET || !env.DB) {
    return json({ error: 'Auth env or DB binding missing' }, 503);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request);
  const clearState = stateCookie('', true);
  const clearNext = nextCookie('', true);
  const next = safeNextPath(cookies[NEXT_COOKIE]) || '/account/';

  if (!code || !state || cookies[STATE_COOKIE] !== state) {
    return oauthErrorRedirect(origin, 'state', [clearState, clearNext]);
  }

  const redirectUri = `${origin}/api/auth/facebook/callback`;
  const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', appId);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);
  const tokenRes = await fetch(tokenUrl);
  if (!tokenRes.ok) {
    return oauthErrorRedirect(origin, 'token', [clearState, clearNext]);
  }
  const tokens = await tokenRes.json();
  const meUrl = new URL('https://graph.facebook.com/v19.0/me');
  meUrl.searchParams.set('fields', 'id,name,email,picture.type(large)');
  meUrl.searchParams.set('access_token', tokens.access_token);
  const meRes = await fetch(meUrl);
  if (!meRes.ok) {
    return oauthErrorRedirect(origin, 'userinfo', [clearState, clearNext]);
  }
  const me = await meRes.json();
  if (!me.id || !me.email) {
    return oauthErrorRedirect(origin, 'email', [clearState, clearNext]);
  }

  const picture = me.picture && me.picture.data ? me.picture.data.url : null;
  const userId = await upsertOAuthUser(env.DB, {
    email: me.email,
    name: me.name || null,
    picture,
    provider: 'facebook',
    providerSub: me.id,
  });
  const sessionCookieValue = await createCentralSessionCookie(userId, env, request);

  const headers = new Headers({
    Location: `${origin}${next}`,
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', sessionCookieValue);
  headers.append('Set-Cookie', clearState);
  headers.append('Set-Cookie', clearNext);
  return new Response(null, { status: 302, headers });
}
