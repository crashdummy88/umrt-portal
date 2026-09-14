/**
 * PATCH /api/admin/vendors/:id — admin approve/reject a listing, and
 * manually mark subscription paid/expired. Admin-only. Body: any of
 * { status, subscriptionStatus, subscriptionExpiresAt, adminNotes }.
 *
 * subscriptionStatus is set by hand here (Matt confirms payment happened
 * outside this app -- e.g. Square Checkout link, cash, check) until a real
 * Square Subscriptions integration is wired, same blocker noted in the
 * migration and in united-mobile-rv/functions/_lib/square.js.
 */
import { getSessionUser, isAdminUser, json } from '../../../_lib/auth.js';

const VALID_STATUS = ['pending', 'approved', 'rejected'];
const VALID_SUB_STATUS = ['pending_payment', 'active', 'expired'];

export async function onRequestPatch(context) {
  const { env, request, params } = context;
  const user = await getSessionUser(env, request);
  if (!user || !isAdminUser(user, env)) {
    return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }
  if (!env.DB) return json({ error: 'not_configured' }, 503);

  const id = params.id;
  const existing = await env.DB.prepare('SELECT id FROM vendors WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'not_found' }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const sets = [];
  const binds = [];

  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status)) return json({ error: 'invalid_status' }, 400);
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (body.subscriptionStatus !== undefined) {
    if (!VALID_SUB_STATUS.includes(body.subscriptionStatus)) return json({ error: 'invalid_subscription_status' }, 400);
    sets.push('subscription_status = ?');
    binds.push(body.subscriptionStatus);
  }
  if (body.subscriptionExpiresAt !== undefined) {
    sets.push('subscription_expires_at = ?');
    binds.push(body.subscriptionExpiresAt || null);
  }
  if (body.adminNotes !== undefined) {
    sets.push('admin_notes = ?');
    binds.push(body.adminNotes || null);
  }
  if (!sets.length) return json({ error: 'no_changes' }, 400);

  sets.push("updated_at = datetime('now')");
  binds.push(id);
  await env.DB.prepare(`UPDATE vendors SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  return json({ success: true }, 200, { 'Cache-Control': 'no-store' });
}
