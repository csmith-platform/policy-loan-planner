CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  borrower_name TEXT NOT NULL DEFAULT '',
  principal_cents INTEGER NOT NULL CHECK (principal_cents > 0),
  annual_rate_bps INTEGER NOT NULL CHECK (annual_rate_bps >= 0),
  term_years INTEGER NOT NULL CHECK (term_years >= 0),
  term_months INTEGER NOT NULL CHECK (term_months BETWEEN 0 AND 11),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  first_payment_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE loan_members (
  loan_id TEXT NOT NULL REFERENCES loans(id),
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'borrower' CHECK (role IN ('borrower', 'viewer')),
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (loan_id, email)
);

INSERT INTO loans (
  id, name, borrower_name, principal_cents, annual_rate_bps, term_years,
  term_months, frequency, first_payment_date, status, created_by, updated_by, updated_at
)
SELECT
  'family-loan-001', 'Kat''s Policy Loan', 'Kat Smith', principal_cents,
  annual_rate_bps, term_years, term_months, frequency, first_payment_date,
  'active', 'csmith.ab@gmail.com', updated_by, updated_at
FROM loan_settings
WHERE id = 1;

INSERT INTO loan_members (loan_id, email, role, assigned_by)
VALUES ('family-loan-001', 'katsmith430@gmail.com', 'borrower', 'csmith.ab@gmail.com');

ALTER TABLE payment_events ADD COLUMN loan_id TEXT REFERENCES loans(id);
UPDATE payment_events SET loan_id = 'family-loan-001' WHERE loan_id IS NULL;

CREATE INDEX idx_loan_members_email ON loan_members (email, loan_id);
CREATE INDEX idx_loans_status ON loans (status, updated_at);
CREATE INDEX idx_payment_events_loan_created ON payment_events (loan_id, created_at);
CREATE INDEX idx_payment_events_loan_schedule ON payment_events (loan_id, scheduled_date);
