/**
 * Shared auth helpers for Cloudflare Pages Functions.
 * Env (names only): SESSION_SECRET, CENTRAL_SESSION_SECRET,
 * GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, optional FACEBOOK_APP_ID,
 * FACEBOOK_APP_SECRET. D1 bind: DB (this app's DB binding IS the shared
 * umrt-portal-db that the forum app also writes to via its own PORTAL_DB
 * binding -- see united-mobile-rv's ARCHITECTURE.md).
 *
 * Stage 3 of the auth-unification migration (2026-09-15, portal side):
 * login now issues a CENTRAL session -- id is crypto.randomUUID() (not
 * this app's original randomToken(24)), signed with CENTRAL_SESSION_SECRET
 * (not this app's own SESSION_SECRET), cookie scoped
 * Domain=.unitedmobilerv.com instead of host-only. CENTRAL_SESSION_SECRET
 * is a NEW secret, set to the SAME value on both this project and
 * united-mobile-rv's Cloudflare Pages project (2026-09-15) specifically so
 * a session either app issues can be verified by the other -- deliberately
 * NOT reusing either app's own SESSION_SECRET (which stays app-local, for
 * the legacy format only) or SSO_SHARED_SECRET (that one's documented
 * contract is display-only, never real auth -- see _lib/sso.js).
 *
 * BACKWARD COMPATIBLE ON PURPOSE, same discipline as the forum side:
 * getSessionUser()/destroySession() recognize a session's format from its
 * raw id's shape (UUID = central, anything else = this app's own legacy
 * shape) and use the matching secret -- no currently-logged-in portal user
 * is signed out by this deploy. createSession()/verifySessionId() below
 * are UNCHANGED and kept only so an existing legacy cookie keeps
 * verifying until it naturally expires (14 days) or the user logs in
 * again.
 *
 * SECURITY REVIEW FIX (2026-09-15, before this ever shipped): this app is
 * confirmed, in its own docs (CF_PAGES.md / README.md), to still be
 * running ONLY on umrt-portal.pages.dev -- no custom domain attached yet.
 * A browser silently DROPS a Set-Cookie whose Domain attribute doesn't
 * domain-match the responding host, so an unconditional
 * Domain=.unitedmobilerv.com here would have meant every login on the
 * live app appeared to succeed (the D1 rows get written fine) while the
 * browser never actually stored a session cookie -- a real regression,
 * not just a missed SSO feature. createCentralSessionCookie() below only
 * sets Domain when the request is actually on a real *.unitedmobilerv.com
 * subdomain; see isRealSubdomainHost(). This also closes a second issue:
 * Domain=.unitedmobilerv.com covers the bare apex too, i.e. the
 * WordPress-hosted marketing site -- a separate, less-trusted piece of
 * infrastructure that should never see a real session token.
 */

const SESSION_COOKIE = 'umrt_session';
const STATE_COOKIE = 'umrt_oauth_state';
const SESSION_DAYS = 14;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// True only for a real *.unitedmobilerv.com subdomain (forum., portal.,
// shop., docs., ...) -- false for the bare apex (WordPress, a different
// trust boundary) and false for any *.pages.dev host. See the file-header
// comment above (SECURITY REVIEW FIX) for why this can't be unconditional.
function isRealSubdomainHost(hostname) {
  return /\.unitedmobilerv\.com$/i.test(hostname || '');
}

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

export function cookieHeader(name, value, { maxAge, httpOnly = true, clear = false, domain } = {}) {
  const parts = [
    `${name}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'Secure',
    'SameSite=Lax',
  ];
  if (domain) parts.push(`Domain=${domain}`);
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

/**
 * Stage 3: the Domain-wide, cross-app session cookie. Same COOKIE name as
 * the legacy host-only one on purpose -- setting this one overwrites
 * whatever the browser held before, since they share name+domain+path
 * once this is set (there is never a duplicate to clean up beyond the
 * dual clear() below for whichever shape the browser actually still has).
 */
export function centralSessionCookie(value, clear = false, domain = '.unitedmobilerv.com') {
  return cookieHeader(SESSION_COOKIE, value, {
    maxAge: clear ? 0 : SESSION_DAYS * 86400,
    clear,
    domain,
  });
}

export function clearCentralSessionCookie() {
  return centralSessionCookie('', true);
}

export function stateCookie(value, clear = false) {
  return cookieHeader(STATE_COOKIE, value, {
    maxAge: clear ? 0 : 600,
    clear,
  });
}

export { SESSION_COOKIE, STATE_COOKIE, SESSION_DAYS };

/** Legacy (pre-Stage-3) session creation. Kept only so existing callers
 * that still reference it (none, after this stage) or tests exercising
 * the backward-compatible read path keep working -- new logins use
 * createCentralSessionCookie() instead. */
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

/**
 * Stage 3: issues a CENTRAL session -- same `sessions` table, but a
 * crypto.randomUUID() id signed with the shared CENTRAL_SESSION_SECRET.
 * Domain-wide (Domain=.unitedmobilerv.com) ONLY when `request` shows
 * we're actually being served from a real *.unitedmobilerv.com host;
 * host-only otherwise (e.g. still on *.pages.dev) -- see
 * isRealSubdomainHost() and the file-header SECURITY REVIEW FIX comment
 * for why. `request` is optional for backward compatibility with
 * existing callers/tests, but its absence means "assume not a real
 * subdomain" (host-only) -- always pass it in real code. Returns the raw
 * Set-Cookie value (not just the token), same shape as sessionCookie()'s
 * return.
 */
export async function createCentralSessionCookie(userId, env, request) {
  const rawId = crypto.randomUUID();
  const signed = await signSessionId(rawId, env.CENTRAL_SESSION_SECRET);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await env.DB
    .prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(rawId, userId, expires)
    .run();
  const hostname = request ? new URL(request.url).hostname : '';
  const domain = isRealSubdomainHost(hostname) ? '.unitedmobilerv.com' : null;
  return centralSessionCookie(signed, false, domain);
}

/**
 * Extracts a session token's raw id and picks the right verification
 * secret for it -- a UUID-shaped id is a Stage 3 central session
 * (verified with CENTRAL_SESSION_SECRET, works whether it was issued by
 * this app or the forum app); anything else is this app's own pre-
 * Stage-3 session (verified with this app's own SESSION_SECRET). Returns
 * the verified raw id, or null if the token is missing, malformed, or
 * fails verification against the appropriate secret.
 */
async function resolveRawSessionId(token, env) {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const candidateRawId = token.slice(0, i);
  const secret = UUID_RE.test(candidateRawId) ? env.CENTRAL_SESSION_SECRET : env.SESSION_SECRET;
  if (!secret) return null;
  return verifySessionId(token, secret);
}

export async function destroySession(env, request) {
  if (!env.DB) return;
  const cookies = parseCookies(request);
  const rawId = await resolveRawSessionId(cookies[SESSION_COOKIE], env);
  if (rawId) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(rawId).run();
  }
}

export async function getSessionUser(env, request) {
  if (!env.DB) return null;
  const cookies = parseCookies(request);
  const rawId = await resolveRawSessionId(cookies[SESSION_COOKIE], env);
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

// Admin gate for the internal /admin dashboard. Configure via the ADMIN_EMAILS
// secret (comma-separated) in Cloudflare Pages settings; falls back to the
// shop owner's account so the dashboard works even before that's set.
const DEFAULT_ADMIN_EMAILS = ['mattc2896@gmail.com'];

export function isAdminUser(user, env) {
  if (!user || !user.email) return false;
  const list = (env && env.ADMIN_EMAILS
    ? env.ADMIN_EMAILS.split(',')
    : DEFAULT_ADMIN_EMAILS
  ).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(user.email).toLowerCase());
}
