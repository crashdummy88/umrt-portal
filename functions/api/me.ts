import type { Env } from "../_lib/types";
import { getSessionUser } from "../_lib/session";
import { googleConfigured, facebookConfigured } from "../_lib/google";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const user = await getSessionUser(request, env);

  const body = {
    authenticated: Boolean(user),
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
        }
      : null,
    providers: {
      google: googleConfigured(env),
      facebook: facebookConfigured(env),
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
