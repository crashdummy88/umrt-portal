-- Rate limiting for auth and write endpoints (OAuth start, vendor
-- applications). Additive only -- does not touch any existing table.
-- Mirrors united-mobile-rv/db/migrations/010_rate_limit.sql exactly
-- (same design, same table shape) rather than inventing a new one.

CREATE TABLE IF NOT EXISTS rate_limit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_lookup
  ON rate_limit_log (ip, endpoint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limit_created
  ON rate_limit_log (created_at);
