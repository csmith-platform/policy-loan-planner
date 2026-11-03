CREATE TABLE IF NOT EXISTS loan_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), principal_cents INTEGER NOT NULL CHECK (principal_cents > 0), annual_rate_bps INTEGER NOT NULL CHECK (annual_rate_bps >= 0),
  term_years INTEGER NOT NULL CHECK (term_years >= 0), term_months INTEGER NOT NULL CHECK (term_months BETWEEN 0 AND 11),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')), first_payment_date TEXT NOT NULL,
  updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO loan_settings (id, principal_cents, annual_rate_bps, term_years, term_months, frequency, first_payment_date) VALUES (1, 555275, 1000, 5, 0, 'biweekly', '2026-11-13');
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL CHECK (event_type IN ('extra', 'manual', 'missed')), scheduled_date TEXT, payment_date TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0), note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), voided_by TEXT, voided_at TEXT,
  CHECK ((event_type = 'missed' AND scheduled_date IS NOT NULL AND payment_date IS NULL AND amount_cents = 0) OR (event_type IN ('extra', 'manual') AND payment_date IS NOT NULL AND amount_cents > 0))
);
CREATE INDEX IF NOT EXISTS idx_payment_events_schedule ON payment_events (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events (payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_events_active ON payment_events (voided_at, created_at);

