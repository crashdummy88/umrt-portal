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
  if (!env.SESSION_SECRET || !env.DB) {
    return json({ error: 'Auth env or DB binding missing' }, 503);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const origin = originOf(request);
  const clearState = stateCookie('', true);
  const cookies = parseCookies(request);

  if (!code || !state || cookies[STATE_COOKIE] !== state) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/account/?error=state`, 'Set-Cookie': clearState },
    });
  }

  const redirectUri = `${origin}/api/auth/facebook/callback`;
  const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', appId);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);
  const tokenRes = await fetch(tokenUrl);
  if (!tokenRes.ok) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/account/?error=token`, 'Set-Cookie': clearState },
    });
  }
  const tokens = await tokenRes.json();
  const meUrl = new URL('https://graph.facebook.com/v19.0/me');
  meUrl.searchParams.set('fields', 'id,name,email,picture.type(large)');
  meUrl.searchParams.set('access_token', tokens.access_token);
  const meRes = await fetch(meUrl);
  if (!meRes.ok) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/account/?error=userinfo`, 'Set-Cookie': clearState },
    });
  }
  const me = await meRes.json();
  if (!me.id || !me.email) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/account/?error=email`, 'Set-Cookie': clearState },
    });
  }

  const picture = me.picture && me.picture.data ? me.picture.data.url : null;
  const userId = await upsertOAuthUser(env.DB, {
    email: me.email,
    name: me.name || null,
    picture,
    provider: 'facebook',
    providerSub: me.id,
    // Facebook only returns addresses it has itself verified, so the
    // existing-account merge by email stays allowed here.
    emailVerified: true,
  });
  const sessionToken = await createSession(env.DB, userId, env.SESSION_SECRET);

  const headers = new Headers({
    Location: `${origin}/account/`,
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', sessionCookie(sessionToken));
  headers.append('Set-Cookie', clearState);
  return new Response(null, { status: 302, headers });
}
