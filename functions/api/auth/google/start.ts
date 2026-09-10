import type { Env } from "../../../_lib/types";
import { randomId } from "../../../_lib/crypto";
import { setOAuthStateCookie } from "../../../_lib/cookies";
import { isSecureRequest } from "../../../_lib/session";
import {
  googleConfigured,
  googleAuthUrl,
  googleRedirectUri,
} from "../../../_lib/google";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!googleConfigured(env)) {
    return Response.redirect(
      `${url.origin}/account/?err=google_not_configured`,
      302
    );
  }
  if (!env.DB) {
    return Response.redirect(`${url.origin}/account/?err=db_missing`, 302);
  }

  const state = randomId(16);
  const redirectUri = googleRedirectUri(request, env);
  const authUrl = googleAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID!,
    redirectUri,
    state,
  });

  const secure = isSecureRequest(url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": setOAuthStateCookie(state, secure),
      "Cache-Control": "no-store",
    },
  });
};
