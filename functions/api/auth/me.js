import { getSessionUser, json, sessionCookie, authProviders } from '../../_lib/auth.js';
import { readSsoCookie } from '../../_lib/sso.js';

export async function onRequestGet(context) {
  const providers = authProviders(context.env);
  const user = await getSessionUser(context.env, context.request);
  if (user) {
    return json({ user, providers }, 200, { 'Cache-Control': 'no-store' });
  }

  // Fallback: no portal session, but recognized via the shared
  // cross-subdomain SSO cookie (e.g. logged in on forum/docs first).
  // Display-only -- does NOT grant access to jobs/vendors/admin data,
  // which still requires a real portal session via getSessionUser above.
  if (context.env.SSO_SHARED_SECRET) {
    const identity = await readSsoCookie(context.request, context.env.SSO_SHARED_SECRET);
    if (identity) {
      return json(
        { user: { name: identity.name, picture: identity.avatar, email: identity.email, ssoOnly: true }, providers },
        200,
        { 'Cache-Control': 'no-store' }
      );
    }
  }

  return json({ error: 'unauthorized', providers }, 401, {
    'Set-Cookie': sessionCookie('', true),
    'Cache-Control': 'no-store',
  });
}
