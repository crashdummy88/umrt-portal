/**
 * Stage 2 companion, portal side. Portal's own session already lives in
 * the central store (this repo's DB binding IS umrt-portal-db), so
 * resolution here is direct -- no cross-database correlation needed,
 * unlike the mothership side (see united-mobile-rv/functions/_lib/
 * central-identity.js for why that side needs an email lookup).
 *
 * Still log-only this stage: the resolved identity is attached as
 * request headers passed to downstream routes via _middleware.js, but
 * no route reads them yet.
 */
import { getSessionUser } from './auth.js';

export async function resolveCentralIdentity(request, env) {
  const user = await getSessionUser(env, request);
  if (!user || !env.DB) return null;

  try {
    const row = await env.DB.prepare('SELECT is_mod, banned FROM users WHERE id = ?').bind(user.id).first();
    if (!row) return null;
    return {
      id: user.id,
      role: row.banned ? 'banned' : row.is_mod ? 'mod' : 'member',
    };
  } catch {
    return null;
  }
}
