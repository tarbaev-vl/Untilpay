-- Transactions from CSV statements that have already been seen: imported or rejected.
-- The fingerprint is built only from the original statement data, so renaming
-- an expense does not prevent recognising the transaction on a repeated upload.
CREATE TABLE import_tx (
  fingerprint TEXT          PRIMARY KEY,  -- sha256(account|datetime|amount|original|n)
  status      TEXT          NOT NULL CHECK (status IN ('imported','skipped')),
  account     TEXT          NOT NULL,
  tx_date     DATE          NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  original    TEXT          NOT NULL,     -- the description from the CSV as is
  expense_id  BIGINT        REFERENCES expenses(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX import_tx_expense_idx ON import_tx (expense_id);

-- Rules: normalised bank description -> name and category
CREATE TABLE import_rules (
  pattern     TEXT PRIMARY KEY,
  note        TEXT NOT NULL,
  category    TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
