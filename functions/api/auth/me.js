import { getSessionUser, json, sessionCookie } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const user = await getSessionUser(context.env, context.request);
  if (!user) {
    return json({ error: 'unauthorized' }, 401, {
      'Set-Cookie': sessionCookie('', true),
      'Cache-Control': 'no-store',
    });
  }
  return json({ user }, 200, { 'Cache-Control': 'no-store' });
}
