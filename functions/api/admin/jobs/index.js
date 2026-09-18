/**
 * GET /api/admin/jobs — full job list for the owner dashboard, plus revenue
 * stats. Admin-only (isAdminUser). Supports ?status=xxx filter.
 * Square invoice columns are stored values only — live events come from
 * umrt-square-events (Cloudflare). This handler does not poll Square.
 */
import { getSessionUser, isAdminUser, json } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const user = await getSessionUser(env, request);
  if (!user || !isAdminUser(user, env)) {
    return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }
  if (!env.DB) {
    return json({ jobs: [], stats: null }, 200, { 'Cache-Control': 'no-store' });
  }

  const url = new URL(request.url);
  const statusFilter = (url.searchParams.get('status') || '').trim();

  let query = `SELECT id, full_name, phone, email, rv_year, rv_make, rv_model, vin, issue,
      street, city, state, zip, preferred_date, preferred_time, status, source,
      notes, admin_notes, final_amount_cents, payment_method, paid_at, created_at, updated_at,
      square_order_id, square_invoice_id, square_invoice_url, square_invoice_status
    FROM jobs`;
  const binds = [];
  if (statusFilter) {
    query += ' WHERE status = ?';
    binds.push(statusFilter);
  }
  query += ' ORDER BY created_at DESC LIMIT 200';

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  const jobs = results || [];

  const statsRow = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'requested' THEN 1 ELSE 0 END) AS requested,
       SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
       SUM(CASE WHEN paid_at IS NOT NULL THEN final_amount_cents ELSE 0 END) AS revenue_cents,
       SUM(CASE WHEN paid_at IS NULL AND final_amount_cents IS NOT NULL THEN final_amount_cents ELSE 0 END) AS outstanding_cents
     FROM jobs`
  ).first();

  return json({ jobs, stats: statsRow || null }, 200, { 'Cache-Control': 'no-store' });
}
