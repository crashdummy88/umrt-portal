/**
 * Shared auth helpers for Cloudflare Pages Functions.
 * Env (names only): SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 * optional FACEBOOK_APP_ID, FACEBOOK_APP_SECRET. D1 bind: DB.
 */

const SESSION_COOKIE = 'umrt_session';
const STATE_COOKIE = 'umrt_oauth_state';
const SESSION_DAYS = 14;

function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Signed session id: random.hmac (HMAC-SHA256, base64url). */
export async function signSessionId(rawId, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawId));
  return `${rawId}.${b64url(sig)}`;
}

export async function verifySessionId(token, secret) {
  if (!token || !secret) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const rawId = token.slice(0, i);
  const sig = token.slice(i + 1);
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    fromB64url(sig),
    new TextEncoder().encode(rawId)
  );
  return ok ? rawId : null;
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function cookieHeader(name, value, { maxAge, httpOnly = true, clear = false } = {}) {
  const parts = [
    `${name}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'Secure',
    'SameSite=Lax',
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (clear) parts.push('Max-Age=0');
  else if (typeof maxAge === 'number') parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export function sessionCookie(value, clear = false) {
  return cookieHeader(SESSION_COOKIE, value, {
    maxAge: clear ? 0 : SESSION_DAYS * 86400,
    clear,
  });
}

export function stateCookie(value, clear = false) {
  return cookieHeader(STATE_COOKIE, value, {
    maxAge: clear ? 0 : 600,
    clear,
  });
}

export { SESSION_COOKIE, STATE_COOKIE, SESSION_DAYS };

export async function createSession(db, userId, secret) {
  const rawId = await randomToken(24);
  const signed = await signSessionId(rawId, secret);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await db
    .prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(rawId, userId, expires)
    .run();
  return signed;
}

export async function destroySession(db, request, secret) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  const rawId = await verifySessionId(token, secret);
  if (rawId && db) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(rawId).run();
  }
}

export async function getSessionUser(env, request) {
  const secret = env.SESSION_SECRET;
  if (!secret || !env.DB) return null;
  const cookies = parseCookies(request);
  const rawId = await verifySessionId(cookies[SESSION_COOKIE], secret);
  if (!rawId) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture, u.provider, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`
  )
    .bind(rawId)
    .first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(rawId).run();
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    provider: row.provider,
  };
}

export async function upsertOAuthUser(db, { email, name, picture, provider, providerSub }) {
  const existing = await db
    .prepare('SELECT id FROM users WHERE provider = ? AND provider_sub = ?')
    .bind(provider, providerSub)
    .first();
  if (existing) {
    await db
      .prepare(
        `UPDATE users SET email = ?, name = ?, picture = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(email, name || null, picture || null, existing.id)
      .run();
    return existing.id;
  }
  const byEmail = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (byEmail) {
    await db
      .prepare(
        `UPDATE users SET name = ?, picture = ?, provider = ?, provider_sub = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(name || null, picture || null, provider, providerSub, byEmail.id)
      .run();
    return byEmail.id;
  }
  const id = await randomToken(16);
  await db
    .prepare(
      `INSERT INTO users (id, email, name, picture, provider, provider_sub) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, email, name || null, picture || null, provider, providerSub)
    .run();
  return id;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export function originOf(request) {
  const url = new URL(request.url);
  return url.origin;
}
