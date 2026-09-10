import type { Env } from "./types";

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function facebookConfigured(env: Env): boolean {
  return Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET);
}

export function appOrigin(request: Request, env: Env): string {
  if (env.APP_ORIGIN) return env.APP_ORIGIN.replace(/\/$/, "");
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

export function googleRedirectUri(request: Request, env: Env): string {
  return `${appOrigin(request, env)}/api/auth/callback/google`;
}

export function googleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in?: number;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function exchangeGoogleCode(
  env: Env,
  code: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function fetchGoogleUser(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google userinfo failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GoogleUserInfo;
}
