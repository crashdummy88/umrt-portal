/**
 * GET /api/jobs/mine — jobs for the signed-in customer, matched by email.
 *
 * Returns stored rows only. Square invoice fields are shaped for customers
 * (draft URLs withheld; no invented live sync). Booking land is Square.
 * Event updates (paid / sent / cancelled) are owned by umrt-square-events
 * (Cloudflare) — this handler does not poll Square.
 */
import { getSessionUser, json } from '../../_lib/auth.js';
import { shapeCustomerJob } from '../../_lib/jobs-public.js';

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
            preferred_date, preferred_time, status, created_at, updated_at,
            square_invoice_status, square_invoice_url, paid_at, final_amount_cents
     FROM jobs WHERE email = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(user.email).all();

  const jobs = (results || []).map(shapeCustomerJob);
  return json({ jobs }, 200, { 'Cache-Control': 'no-store' });
}
