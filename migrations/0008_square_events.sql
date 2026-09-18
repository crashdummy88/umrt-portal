-- Square → Matt + Claude event log (2026-09-18).
-- Portal is the jobs/account authority; Square remains appointments + payments.
-- Webhooks write here so Matt (SMS/email notify hook) and Claude/ADMIN
-- (GET /api/admin/events) read the same structured record.
-- Additive only -- does not change jobs, users, vendors, or shop UI.

CREATE TABLE IF NOT EXISTS square_events (
  id TEXT PRIMARY KEY,
  square_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  topic TEXT NOT NULL, -- booking | payment | invoice | refund | order | other
  merchant_id TEXT,
  object_id TEXT,
  object_type TEXT,
  status TEXT,
  amount_cents INTEGER,
  currency TEXT,
  customer_id TEXT,
  customer_email TEXT,
  invoice_id TEXT,
  order_id TEXT,
  booking_id TEXT,
  payment_id TEXT,
  job_id TEXT,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  notify_status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | stubbed | skipped | failed
  notify_channel TEXT,
  notify_error TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  square_created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_square_events_type ON square_events(event_type);
CREATE INDEX IF NOT EXISTS idx_square_events_topic ON square_events(topic);
CREATE INDEX IF NOT EXISTS idx_square_events_received ON square_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_square_events_job ON square_events(job_id);
CREATE INDEX IF NOT EXISTS idx_square_events_object ON square_events(object_id);
CREATE INDEX IF NOT EXISTS idx_square_events_invoice ON square_events(invoice_id);
