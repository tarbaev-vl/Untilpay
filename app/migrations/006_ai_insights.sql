-- Saved AI advice for a reporting period
CREATE TABLE ai_insights (
  period_from DATE        NOT NULL,
  period_to   DATE        NOT NULL,
  model       TEXT        NOT NULL,
  result      JSONB       NOT NULL,
  usage       JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period_from, period_to)
);
