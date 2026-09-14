/**
 * Cross-subdomain SSO recognition cookie — separate from this project's own
 * `umrt_session` cookie (host-scoped DB-backed session, untouched, still the
 * source of truth for portal login/account access).
 *
 * `umrt_sso` is stateless (no DB), Domain=.unitedmobilerv.com, and is set
 * ADDITIONALLY alongside the native session cookie on Google login, so that
 * forum and docs recognize a user who logged in here, and vice versa.
 * Signed with SSO_SHARED_SECRET (NOT the same secret as SESSION_SECRET --
 * deliberately separate so rotating one never invalidates the other).
 *
 * Payload: { sub, email, name, avatar, provider, exp }
 * `sub` is the OAuth provider's stable subject id (Google `sub`).
 *
 * Display-only fallback everywhere it's consumed -- does NOT grant access
 * to account/job/vendor/admin data, which still requires a real portal
 * session (see _lib/auth.js's getSessionUser, untouched by this).
 */

const SSO_COOKIE = 'umrt_sso';
const SSO_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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

export async function createSsoCookie(payload, secret) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + SSO_MAX_AGE_SECONDS };
  const json = JSON.stringify(body);
  const payloadB64 = b64url(new TextEncoder().encode(json));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = b64url(sig);
  const token = `${payloadB64}.${sigB64}`;
  return `${SSO_COOKIE}=${token}; Domain=.unitedmobilerv.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SSO_MAX_AGE_SECONDS}`;
}

export function clearSsoCookie() {
  return `${SSO_COOKIE}=; Domain=.unitedmobilerv.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Returns the verified payload, or null. Never throws on malformed/missing cookie. */
export async function readSsoCookie(request, secret) {
  if (!secret) return null;
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`${SSO_COOKIE}=([^;]+)`));
  if (!match) return null;
  const [payloadB64, sigB64] = match[1].split('.');
  if (!payloadB64 || !sigB64) return null;

  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(sigB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;

    const json = new TextDecoder().decode(b64urlToBytes(payloadB64));
    const payload = JSON.parse(json);
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
