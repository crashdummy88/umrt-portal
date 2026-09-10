import type { Env, UserRow } from "./types";
import { SESSION_COOKIE, SESSION_DAYS } from "./types";
import { parseCookies, setSessionCookie, clearSessionCookie } from "./cookies";
import { randomId } from "./crypto";

export function isSecureRequest(url: URL): boolean {
  return url.protocol === "https:";
}

export async function getSessionUser(
  request: Request,
  env: Env
): Promise<UserRow | null> {
  if (!env.DB) return null;
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture, u.google_sub, u.facebook_id, u.created_at, u.updated_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  )
    .bind(sid)
    .first<UserRow>();

  return row ?? null;
}

export async function createSession(
  env: Env,
  userId: string
): Promise<{ id: string; maxAge: number }> {
  const id = randomId(24);
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES (?, ?, datetime('now', ?))`
  )
    .bind(id, userId, `+${SESSION_DAYS} days`)
    .run();
  return { id, maxAge };
}

export async function destroySession(request: Request, env: Env): Promise<void> {
  if (!env.DB) return;
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return;
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sid).run();
}

export { setSessionCookie, clearSessionCookie };
