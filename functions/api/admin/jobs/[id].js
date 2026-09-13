/**
 * PATCH /api/admin/jobs/:id — update a job's status, final amount, payment
 * method, and admin notes. Admin-only. Setting a payment_method + amount
 * marks it paid (sets paid_at) unless mark_unpaid is explicitly sent.
 */
import { getSessionUser, isAdminUser, json } from '../../../_lib/auth.js';

const VALID_STATUSES = ['requested', 'scheduled', 'in_progress', 'completed', 'cancelled'];
const VALID_METHODS = ['square', 'cash', 'check', 'other'];

export async function onRequestPatch(context) {
  const { env, request, params } = context;
  const user = await getSessionUser(env, request);
  if (!user || !isAdminUser(user, env)) {
    return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }
  if (!env.DB) {
    return json({ error: 'no_db' }, 503);
  }

  const id = params.id;
  const existing = await env.DB.prepare('SELECT id FROM jobs WHERE id = ?').bind(id).first();
  if (!existing) {
    return json({ error: 'not_found' }, 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const sets = [];
  const binds = [];

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return json({ error: 'invalid_status' }, 400);
    }
    sets.push('status = ?');
    binds.push(body.status);
  }

  if (body.admin_notes !== undefined) {
    sets.push('admin_notes = ?');
    binds.push(String(body.admin_notes || '').slice(0, 2000) || null);
  }

  if (body.final_amount_dollars !== undefined) {
    const n = Number(body.final_amount_dollars);
    if (body.final_amount_dollars !== null && (!Number.isFinite(n) || n < 0)) {
      return json({ error: 'invalid_amount' }, 400);
    }
    sets.push('final_amount_cents = ?');
    binds.push(body.final_amount_dollars === null ? null : Math.round(n * 100));
  }

  if (body.payment_method !== undefined) {
    if (body.payment_method !== null && !VALID_METHODS.includes(body.payment_method)) {
      return json({ error: 'invalid_payment_method' }, 400);
    }
    sets.push('payment_method = ?');
    binds.push(body.payment_method || null);
  }

  if (body.mark_paid === true) {
    sets.push('paid_at = ?');
    binds.push(new Date().toISOString());
  } else if (body.mark_paid === false) {
    sets.push('paid_at = ?');
    binds.push(null);
  }

  if (!sets.length) {
    return json({ error: 'no_changes' }, 400);
  }

  sets.push("updated_at = datetime('now')");
  binds.push(id);

  await env.DB.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const updated = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
  return json({ job: updated }, 200, { 'Cache-Control': 'no-store' });
}
