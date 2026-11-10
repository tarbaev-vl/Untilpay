-- An expense may be a payment of a recurring payment: then it settles the payment instead of counting towards "Expenses"
ALTER TABLE expenses ADD COLUMN recurring_id BIGINT REFERENCES recurring(id) ON DELETE SET NULL;
CREATE INDEX expenses_recurring_idx ON expenses (recurring_id);

-- An import rule may also remember the link to a recurring payment
ALTER TABLE import_rules ADD COLUMN recurring_id BIGINT REFERENCES recurring(id) ON DELETE SET NULL;
