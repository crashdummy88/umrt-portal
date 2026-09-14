-- Tech/vendor directory + subscription gate (Phase 4, 2026-09-14).
--
-- subscription_status starts and stays 'pending_payment' -- there is no
-- live $40/year charge wired here. Actually collecting that payment needs
-- a Square Subscription (or a recurring Invoice), which needs the same
-- real Square API credentials Phase 2's draft-estimate feature is waiting
-- on (see united-mobile-rv/functions/_lib/square.js) -- not duplicated
-- here without those credentials and an explicit go-ahead to charge real
-- money. Directory listing/application/approval all work today regardless;
-- only "confirmed paid" stays manual (admin flips subscription_status)
-- until that's wired.

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  business_name TEXT NOT NULL,
  category TEXT NOT NULL, -- 'tech' | 'vendor'
  trade_focus TEXT,       -- free text, e.g. 'Victron/solar install', 'lithium battery supplier'
  description TEXT,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  website TEXT,
  service_area TEXT,      -- free text (states/regions covered)
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  subscription_status TEXT NOT NULL DEFAULT 'pending_payment', -- 'pending_payment' | 'active' | 'expired'
  subscription_expires_at TEXT,
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vendors_user_id ON vendors(user_id);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors(category);
