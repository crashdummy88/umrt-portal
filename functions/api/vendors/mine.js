/**
 * GET /api/vendors/mine — the signed-in user's own directory application
 * (any status), or null if they haven't applied. Same pattern as
 * /api/jobs/mine.
 */
import { getSessionUser, json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  if (!env.DB) return json({ vendor: null }, 200, { 'Cache-Control': 'no-store' });

  const vendor = await env.DB.prepare(
    `SELECT id, business_name, category, status, subscription_status, created_at
     FROM vendors WHERE user_id = ?`
  ).bind(user.id).first();

  return json({ vendor: vendor || null }, 200, { 'Cache-Control': 'no-store' });
}
