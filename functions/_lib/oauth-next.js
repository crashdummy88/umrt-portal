/**
 * OAuth return allowlist for docs↔portal day-to-day.
 *
 * After Google (or Facebook) login, `?next=` may send the browser back to
 * docs SOP / estimates only:
 *   https://docs.unitedmobilerv.com/sop/ (+ subpaths)
 *   https://docs.unitedmobilerv.com/estimates/ (+ subpaths)
 *
 * Rejected: /guides/, /guide/, WP Field Guides, other hosts, other docs
 * paths, javascript:/data: schemes. Portal-relative next (e.g. /track/)
 * is intentionally not in this allowlist — that is a separate Custos
 * concern and must not open /guides/.
 *
 * Does not consume umrt-square-events (PR #28 / CF Worker).
 */
import { cookieHeader } from './auth.js';

export const NEXT_COOKIE = 'umrt_oauth_next';
export const DOCS_HOST = 'docs.unitedmobilerv.com';
export const DOCS_ORIGIN = `https://${DOCS_HOST}`;
export const ALLOWED_DOCS_PREFIXES = ['/sop', '/estimates'];
const REJECTED_FIRST_SEGMENTS = new Set(['guides', 'guide']);
const MAX_NEXT_LEN = 512;

export function nextCookie(value, clear = false) {
  return cookieHeader(NEXT_COOKIE, value, {
    maxAge: clear ? 0 : 600,
    clear,
  });
}

function firstSegment(pathname) {
  return String(pathname || '').split('/').filter(Boolean)[0] || '';
}

function pathAllowed(pathname) {
  const path = String(pathname || '');
  if (REJECTED_FIRST_SEGMENTS.has(firstSegment(path))) return false;
  return ALLOWED_DOCS_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function parseCandidate(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > MAX_NEXT_LEN) return null;
  try {
    if (/^https:\/\//i.test(value)) return new URL(value);
    if (/^http:\/\//i.test(value)) return null;
    if (value.startsWith('//')) return new URL(`https:${value}`);
    if (value.startsWith('/')) return new URL(value, DOCS_ORIGIN);
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns a canonical https docs SOP/estimates URL, or null.
 */
export function safeOAuthNext(raw) {
  const parsed = parseCandidate(raw);
  if (!parsed) return null;
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.hostname.toLowerCase() !== DOCS_HOST) return null;
  if (!pathAllowed(parsed.pathname)) return null;
  parsed.hash = '';
  return parsed.href;
}

export function nextFromRequest(request) {
  try {
    return safeOAuthNext(new URL(request.url).searchParams.get('next'));
  } catch {
    return null;
  }
}

export function nextFromCookies(cookies) {
  return safeOAuthNext(cookies && cookies[NEXT_COOKIE]);
}

export function oauthFail(origin, code, extraCookies = []) {
  const headers = new Headers({
    Location: `${origin}/account/?error=${encodeURIComponent(code)}`,
    'Cache-Control': 'no-store',
  });
  for (const cookie of extraCookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}
