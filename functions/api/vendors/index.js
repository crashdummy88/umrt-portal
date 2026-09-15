/**
 * GET  /api/vendors — public directory listing. Only status='approved' AND
 * subscription_status='active' rows are shown -- an approved-but-unpaid
 * applicant doesn't appear in the public directory.
 *
 * POST /api/vendors — authenticated application. Creates a 'pending'
 * directory entry (not shown publicly yet) with subscription_status
 * 'pending_payment'. No payment is collected here -- see the migration's
 * header comment for why. One application per user (checked by user_id).
 */
import { getSessionUser, json } from '../../_lib/auth.js';
import { sanitizeHttpUrl } from '../../_lib/url-safety.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return json({ vendors: [] }, 200, { 'Cache-Control': 'no-store' });

  const url = new URL(request.url);
  const category = (url.searchParams.get('category') || '').trim();

  let query = `SELECT id, business_name, category, trade_focus, description, website, service_area
    FROM vendors WHERE status = 'approved' AND subscription_status = 'active'`;
  const binds = [];
  if (category) {
    query += ' AND category = ?';
    binds.push(category);
  }
  query += ' ORDER BY business_name ASC LIMIT 200';

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return json({ vendors: results || [] }, 200, { 'Cache-Control': 'public, max-age=60' });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  if (!env.DB) return json({ error: 'not_configured' }, 503);

  const existing = await env.DB.prepare('SELECT id FROM vendors WHERE user_id = ?').bind(user.id).first();
  if (existing) {
    return json({ error: 'already_applied', vendorId: existing.id }, 409, { 'Cache-Control': 'no-store' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const businessName = (body.businessName || '').toString().trim();
  const category = (body.category || '').toString().trim();
  const contactEmail = (body.contactEmail || user.email || '').toString().trim();
  if (!businessName || !['tech', 'vendor'].includes(category) || !contactEmail) {
    return json({ error: 'missing_field', message: 'businessName, category (tech|vendor), and contactEmail are required.' }, 400);
  }

  // Fixed 2026-09-15: `website` used to be stored as-is (only HTML-escaped
  // later at render time), which let a javascript:/data:/vbscript: value
  // survive as a live, clickable link on the public /directory/ page once
  // an admin approved the listing. Reject anything that isn't a real
  // http(s) URL at the storage boundary -- see _lib/url-safety.js.
  const websiteCheck = sanitizeHttpUrl(body.website);
  if (!websiteCheck.ok) {
    return json({ error: websiteCheck.error, message: websiteCheck.message }, 400);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO vendors (id, user_id, business_name, category, trade_focus, description, contact_email, contact_phone, website, service_area)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, user.id, businessName, category,
    (body.tradeFocus || '').toString().trim() || null,
    (body.description || '').toString().trim() || null,
    contactEmail,
    (body.contactPhone || '').toString().trim() || null,
    websiteCheck.url,
    (body.serviceArea || '').toString().trim() || null
  ).run();

  return json({
    success: true,
    vendorId: id,
    status: 'pending',
    message: 'Application received. Matt reviews new listings by hand -- you’ll hear back before anything goes live or is billed.',
  }, 201, { 'Cache-Control': 'no-store' });
}
