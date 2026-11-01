-- Фактические доходы
CREATE TABLE incomes (
  id          BIGSERIAL PRIMARY KEY,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  source      TEXT          NOT NULL DEFAULT 'Другое' CHECK (length(source) BETWEEN 1 AND 100),
  received_on DATE          NOT NULL,
  note        TEXT          NOT NULL DEFAULT '',
  account     TEXT          NOT NULL DEFAULT 'Другое',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX incomes_received_on_idx ON incomes (received_on);

-- Импорт: транзакция выписки может стать доходом
ALTER TABLE import_tx ADD COLUMN income_id BIGINT REFERENCES incomes(id) ON DELETE SET NULL;

-- Правила раздельно для расходов и доходов (у доходов в category хранится источник)
ALTER TABLE import_rules ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','income'));
ALTER TABLE import_rules DROP CONSTRAINT import_rules_pkey, ADD PRIMARY KEY (kind, pattern);
