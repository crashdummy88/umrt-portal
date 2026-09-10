import type { Env } from "../../../_lib/types";
import { OAUTH_STATE_COOKIE } from "../../../_lib/types";
import { parseCookies, clearOAuthStateCookie } from "../../../_lib/cookies";
import { randomId } from "../../../_lib/crypto";
import {
  createSession,
  isSecureRequest,
  setSessionCookie,
} from "../../../_lib/session";
import {
  googleConfigured,
  googleRedirectUri,
  exchangeGoogleCode,
  fetchGoogleUser,
} from "../../../_lib/google";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const secure = isSecureRequest(url);
  const clearState = clearOAuthStateCookie(secure);

  const fail = (code: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/account/?err=${encodeURIComponent(code)}`,
        "Set-Cookie": clearState,
        "Cache-Control": "no-store",
      },
    });

  if (!googleConfigured(env) || !env.DB) return fail("google_not_configured");

  const errParam = url.searchParams.get("error");
  if (errParam) return fail(`google_${errParam}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("missing_code");

  const cookies = parseCookies(request.headers.get("Cookie"));
  const expected = cookies[OAUTH_STATE_COOKIE];
  if (!expected || expected !== state) return fail("bad_state");

  try {
    const redirectUri = googleRedirectUri(request, env);
    const tokens = await exchangeGoogleCode(env, code, redirectUri);
    const info = await fetchGoogleUser(tokens.access_token);

    if (!info.email) return fail("no_email");

    const existing = await env.DB.prepare(
      `SELECT id FROM users WHERE google_sub = ? OR email = ? LIMIT 1`
    )
      .bind(info.sub, info.email.toLowerCase())
      .first<{ id: string }>();

    let userId: string;
    if (existing?.id) {
      userId = existing.id;
      await env.DB.prepare(
        `UPDATE users SET
           google_sub = ?,
           email = ?,
           name = COALESCE(?, name),
           picture = COALESCE(?, picture),
           updated_at = datetime('now')
         WHERE id = ?`
      )
        .bind(
          info.sub,
          info.email.toLowerCase(),
          info.name ?? null,
          info.picture ?? null,
          userId
        )
        .run();
    } else {
      userId = randomId(16);
      await env.DB.prepare(
        `INSERT INTO users (id, email, name, picture, google_sub)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(
          userId,
          info.email.toLowerCase(),
          info.name ?? null,
          info.picture ?? null,
          info.sub
        )
        .run();
    }

    const session = await createSession(env, userId);
    const headers = new Headers({
      Location: `${url.origin}/account/?ok=1`,
      "Cache-Control": "no-store",
    });
    // Multiple Set-Cookie: append both
    headers.append("Set-Cookie", setSessionCookie(session.id, session.maxAge, secure));
    headers.append("Set-Cookie", clearState);

    return new Response(null, { status: 302, headers });
  } catch (e) {
    console.error("google callback", e);
    return fail("oauth_exchange");
  }
};
