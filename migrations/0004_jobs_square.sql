-- Links a job to the Square draft Order/Invoice created for it (Phase 2,
-- 2026-09-14). Nullable throughout: this stays empty until Square API
-- credentials are actually configured on united-mobile-rv (SQUARE_ACCESS_TOKEN
-- + SQUARE_LOCATION_ID) -- see functions/_lib/square.js in that repo. Never
-- auto-published: square_invoice_status starts and stays 'draft' until Matt
-- reviews and publishes it himself from the Square dashboard.

ALTER TABLE jobs ADD COLUMN square_order_id TEXT;
ALTER TABLE jobs ADD COLUMN square_invoice_id TEXT;
ALTER TABLE jobs ADD COLUMN square_invoice_url TEXT;
ALTER TABLE jobs ADD COLUMN square_invoice_status TEXT; -- draft | published | null (never attempted)

CREATE INDEX IF NOT EXISTS idx_jobs_square_invoice_id ON jobs(square_invoice_id);
