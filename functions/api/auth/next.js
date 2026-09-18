/**
 * GET /api/auth/next?to= — signed-in bounce back to an allowlisted
 * docs SOP/estimates URL. Rejects /guides/ and every other host/path.
 */
import { getSessionUser, json, originOf } from '../../_lib/auth.js';
import { safeOAuthNext } from '../../_lib/oauth-next.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const user = await getSessionUser(env, request);
  const origin = originOf(request);
  if (!user) {
    return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }
  const to = new URL(request.url).searchParams.get('to');
  const next = safeOAuthNext(to);
  return new Response(null, {
    status: 302,
    headers: {
      Location: next || `${origin}/account/`,
      'Cache-Control': 'no-store',
    },
  });
}
