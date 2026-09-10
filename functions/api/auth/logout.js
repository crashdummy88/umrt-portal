import { destroySession, sessionCookie, json } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (env.SESSION_SECRET && env.DB) {
    await destroySession(env.DB, request, env.SESSION_SECRET);
  }
  return json({ ok: true }, 200, {
    'Set-Cookie': sessionCookie('', true),
    'Cache-Control': 'no-store',
  });
}

export async function onRequestGet(context) {
  return onRequestPost(context);
}
