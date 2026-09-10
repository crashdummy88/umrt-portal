import { SESSION_COOKIE, OAUTH_STATE_COOKIE } from "./types";

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function cookieBase(secure: boolean): string {
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function setSessionCookie(id: string, maxAgeSec: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Max-Age=${maxAgeSec}; ${cookieBase(secure)}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Max-Age=0; ${cookieBase(secure)}`;
}

export function setOAuthStateCookie(state: string, secure: boolean): string {
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Max-Age=600; ${cookieBase(secure)}`;
}

export function clearOAuthStateCookie(secure: boolean): string {
  return `${OAUTH_STATE_COOKIE}=; Max-Age=0; ${cookieBase(secure)}`;
}
