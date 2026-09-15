-- Stage 1 of the auth-unification migration (2026-09-15). Additive only --
-- no behavior change yet. This table becomes the single central identity
-- store shared by both the mothership (united-mobile-rv, forum/shop) and
-- this portal repo, since PORTAL_DB is already bound into both projects.
--
-- Adds the forum-specific fields that exist on the mothership's OWN
-- `users` table (db/schema.sql + migrations/009_author_credentials.sql)
-- but not here, so this table can eventually be the one authoritative
-- users row for a person regardless of which app they signed in through.
--
-- Deliberately NOT duplicated: the mothership's `display_name` and
-- `avatar_url` map onto this table's existing `name` and `picture`
-- columns -- no reason to carry two columns for the same fact. Only
-- genuinely new concepts get new columns.
--
-- Nothing reads or writes these columns yet. Stage 3 of the migration
-- wires actual behavior to them.

ALTER TABLE users ADD COLUMN is_mod INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN tou_accepted_at TEXT;
ALTER TABLE users ADD COLUMN tou_version TEXT;
ALTER TABLE users ADD COLUMN credentials TEXT;

CREATE INDEX IF NOT EXISTS idx_users_is_mod ON users(is_mod);
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(banned);
