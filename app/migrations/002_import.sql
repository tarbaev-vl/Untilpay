-- Транзакции из CSV-выписок, которые уже видели: импортированы или отклонены.
-- Отпечаток строится только из исходных данных выписки, поэтому переименование
-- расхода не мешает узнать транзакцию при повторной загрузке.
CREATE TABLE import_tx (
  fingerprint TEXT          PRIMARY KEY,  -- sha256(account|datetime|amount|original|n)
  status      TEXT          NOT NULL CHECK (status IN ('imported','skipped')),
  account     TEXT          NOT NULL,
  tx_date     DATE          NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  original    TEXT          NOT NULL,     -- описание из CSV как есть
  expense_id  BIGINT        REFERENCES expenses(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX import_tx_expense_idx ON import_tx (expense_id);

-- Правила: нормализованное описание из банка -> название и категория
CREATE TABLE import_rules (
  pattern     TEXT PRIMARY KEY,
  note        TEXT NOT NULL,
  category    TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
