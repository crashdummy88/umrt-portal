/**
 * Simple D1-backed sliding-window rate limiter for auth and write
 * endpoints. Fails OPEN on any DB error -- a rate-limit outage must never
 * block a real user from logging in or applying to the directory.
 *
 * Ported near-verbatim from united-mobile-rv/functions/_lib/rate-limit.js
 * (2026-09-15) rather than building new infrastructure -- same design,
 * same table shape (migrations/0006_rate_limit.sql).
 *
 * Usage:
 *   const rl = await checkRateLimit(env, request, { max: 10, windowMinutes: 5, key: 'auth-google-start' });
 *   if (rl.limited) return json({ error: 'rate_limited', retry_after: rl.retryAfter }, 429);
 */

function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    '0.0.0.0'
  );
}

export async function checkRateLimit(env, request, { max, windowMinutes, key }) {
  if (!env.DB) return { limited: false, remaining: max, retryAfter: 0 };

  const ip = getClientIp(request);
  const windowClause = `-${windowMinutes} minutes`;

  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM rate_limit_log
       WHERE ip = ? AND endpoint = ? AND created_at >= datetime('now', ?)`
    ).bind(ip, key, windowClause).first();

    const count = (row && row.n) || 0;

    if (count >= max) {
      return { limited: true, remaining: 0, retryAfter: windowMinutes * 60 };
    }

    // Record this request. Best-effort -- if this insert fails we still
    // let the request through rather than blocking a real user.
    await env.DB.prepare(
      `INSERT INTO rate_limit_log (ip, endpoint) VALUES (?, ?)`
    ).bind(ip, key).run();

    // Opportunistic cleanup so the table doesn't grow unbounded. Runs on
    // ~1% of requests -- cheap enough to skip a dedicated cron/worker.
    if (Math.random() < 0.01) {
      env.DB.prepare(
        `DELETE FROM rate_limit_log WHERE created_at < datetime('now', '-1 hour')`
      ).run().catch(() => {});
    }

    return { limited: false, remaining: Math.max(0, max - count - 1), retryAfter: 0 };
  } catch {
    // DB error (e.g. migration not applied yet) -- fail open.
    return { limited: false, remaining: max, retryAfter: 0 };
  }
}
