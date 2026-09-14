/**
 * GET /api/admin/vendors — full applicant list for admin review.
 * Admin-only (isAdminUser), same pattern as admin/jobs. Supports
 * ?status=pending|approved|rejected filter.
 */
import { getSessionUser, isAdminUser, json } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const user = await getSessionUser(env, request);
  if (!user || !isAdminUser(user, env)) {
    return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }
  if (!env.DB) return json({ vendors: [] }, 200, { 'Cache-Control': 'no-store' });

  const url = new URL(request.url);
  const statusFilter = (url.searchParams.get('status') || '').trim();

  let query = `SELECT id, business_name, category, trade_focus, description, contact_email,
      contact_phone, website, service_area, status, subscription_status,
      subscription_expires_at, admin_notes, created_at, updated_at
    FROM vendors`;
  const binds = [];
  if (statusFilter) {
    query += ' WHERE status = ?';
    binds.push(statusFilter);
  }
  query += ' ORDER BY created_at DESC LIMIT 200';

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return json({ vendors: results || [] }, 200, { 'Cache-Control': 'no-store' });
}
