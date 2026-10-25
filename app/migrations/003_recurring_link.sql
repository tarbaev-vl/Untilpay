-- Расход может быть оплатой регулярного платежа: тогда он не входит в «Расходы», а закрывает платёж
ALTER TABLE expenses ADD COLUMN recurring_id BIGINT REFERENCES recurring(id) ON DELETE SET NULL;
CREATE INDEX expenses_recurring_idx ON expenses (recurring_id);

-- Правило импорта может помнить и связь с регулярным платежом
ALTER TABLE import_rules ADD COLUMN recurring_id BIGINT REFERENCES recurring(id) ON DELETE SET NULL;
