/**
 * GET /api/admin/events/:id — one Square event including payload.
 * Same auth as the list: admin session or CLAUDE_EVENTS_TOKEN.
 */
import { json } from '../../../_lib/auth.js';
import { authorizeAdminOrAgent } from '../../../_lib/agent-read.js';

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const auth = await authorizeAdminOrAgent(env, request);
  if (!auth.ok) {
    return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }
  if (!env.DB) return json({ error: 'no_db' }, 503);

  const row = await env.DB
    .prepare('SELECT * FROM square_events WHERE id = ?')
    .bind(params.id)
    .first();
  if (!row) return json({ error: 'not_found' }, 404);

  let payload = null;
  try {
    payload = row.payload_json ? JSON.parse(row.payload_json) : null;
  } catch {
    payload = null;
  }

  return json({ event: { ...row, payload }, read_as: auth.via }, 200, {
    'Cache-Control': 'no-store',
  });
}
