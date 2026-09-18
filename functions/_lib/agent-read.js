/**
 * Admin session OR Claude/agent bearer token.
 *
 * CLAUDE_EVENTS_TOKEN is optional. When unset, only isAdminUser sessions
 * can read events — never invent a default token.
 */
import { getSessionUser, isAdminUser } from './auth.js';
import { timingSafeEqual } from './square-events.js';

export async function authorizeAdminOrAgent(env, request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)/i);
  const token = match && match[1];
  const configured = env && env.CLAUDE_EVENTS_TOKEN;

  if (token && configured) {
    if (timingSafeEqual(token, configured)) {
      return { ok: true, via: 'claude_token' };
    }
    return { ok: false, via: 'claude_token' };
  }

  const user = await getSessionUser(env, request);
  if (user && isAdminUser(user, env)) {
    return { ok: true, via: 'admin_session', user };
  }
  return { ok: false, via: user ? 'not_admin' : 'no_session' };
}
