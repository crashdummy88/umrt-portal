-- Adds real revenue tracking to jobs. Cents-based amount to avoid float
-- rounding; admin marks a job paid from the admin dashboard, which is what
-- turns `jobs` from a lead tracker into the shop's actual revenue ledger.

ALTER TABLE jobs ADD COLUMN final_amount_cents INTEGER;
ALTER TABLE jobs ADD COLUMN payment_method TEXT; -- square | cash | check | other
ALTER TABLE jobs ADD COLUMN paid_at TEXT;
ALTER TABLE jobs ADD COLUMN admin_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_paid_at ON jobs(paid_at);
