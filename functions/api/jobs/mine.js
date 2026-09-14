/**
 * GET /api/jobs/mine — real jobs for the signed-in customer, matched by
 * email against the jobs table fed by united-mobile-rv's /api/book proxy
 * (the WP form, the hub form and the portal's own /book/ all post there).
 * No invented statuses -- returns exactly what's in the row, plus the
 * Square invoice fields so Track can show a pay link when one exists.
 */
import { getSessionUser, json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const user = await getSessionUser(context.env, request);
  if (!user) {
    return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }
  if (!env.DB) {
    return json({ jobs: [] }, 200, { 'Cache-Control': 'no-store' });
  }

  const { results } = await env.DB.prepare(
    `SELECT id, full_name, rv_year, rv_make, rv_model, issue, city, state,
            preferred_date, preferred_time, status, source, created_at, updated_at,
            final_amount_cents, paid_at,
            square_invoice_url, square_invoice_status
     FROM jobs WHERE email = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(user.email).all();

  return json({ jobs: results || [] }, 200, { 'Cache-Control': 'no-store' });
}
