import type { Env } from "../../_lib/types";
import {
  destroySession,
  clearSessionCookie,
  isSecureRequest,
} from "../../_lib/session";

async function logout(context: EventContext<Env, string, unknown>) {
  const { request, env } = context;
  const url = new URL(request.url);
  await destroySession(request, env);
  const secure = isSecureRequest(url);
  const wantsJson =
    request.headers.get("Accept")?.includes("application/json") ||
    url.searchParams.get("format") === "json";

  if (wantsJson) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearSessionCookie(secure),
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/account/?logged_out=1`,
      "Set-Cookie": clearSessionCookie(secure),
      "Cache-Control": "no-store",
    },
  });
}

export const onRequestGet: PagesFunction<Env> = logout;
export const onRequestPost: PagesFunction<Env> = logout;
