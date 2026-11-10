-- Recurring payments: rent, utilities, insurance, subscriptions
-- ('Другое' = "Other": the stored default value, translated by the UI for display)
CREATE TABLE recurring (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT          NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  period      TEXT          NOT NULL DEFAULT 'month' CHECK (period IN ('week','month','quarter','year')),
  kind        TEXT          NOT NULL DEFAULT 'mandatory' CHECK (kind IN ('mandatory','subscription')),
  category    TEXT          NOT NULL DEFAULT 'Другое',
  account     TEXT          NOT NULL DEFAULT 'Другое',
  day         SMALLINT      CHECK (day BETWEEN 1 AND 31),
  active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- One-off expenses
CREATE TABLE expenses (
  id          BIGSERIAL PRIMARY KEY,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category    TEXT          NOT NULL DEFAULT 'Другое',
  spent_on    DATE          NOT NULL,
  note        TEXT          NOT NULL DEFAULT '',
  account     TEXT          NOT NULL DEFAULT 'Другое',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX expenses_spent_on_idx ON expenses (spent_on);

-- Settings (monthly income etc.)
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
