-- Real job/booking tracking, fed by united-mobile-rv's /api/book proxy
-- (the actual form submission handler for the WP /book-service page).

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  rv_year TEXT,
  rv_make TEXT,
  rv_model TEXT,
  vin TEXT,
  issue TEXT NOT NULL,
  street TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  preferred_date TEXT,
  preferred_time TEXT,
  status TEXT NOT NULL DEFAULT 'requested', -- requested | scheduled | in_progress | completed | cancelled
  source TEXT NOT NULL DEFAULT 'wp_book_service',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_email ON jobs(email);
CREATE INDEX IF NOT EXISTS idx_jobs_phone ON jobs(phone);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
