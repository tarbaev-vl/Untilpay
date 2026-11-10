-- Bank connections through Enable Banking: one row per authorised consent (session)
CREATE TABLE bank_connections (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aspsp_name    TEXT        NOT NULL,
  aspsp_country TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
  state         TEXT        UNIQUE,              -- one-time value that ties the bank redirect to this row
  session_id    TEXT,                            -- Enable Banking session
  valid_until   TIMESTAMPTZ,                     -- the consent expires at this moment
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bank accounts available in a connection and the app account each one maps to
CREATE TABLE bank_accounts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id BIGINT      NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  uid           TEXT        NOT NULL,            -- account id inside the Enable Banking session
  ident_hash    TEXT        NOT NULL DEFAULT '', -- stable across sessions: keeps the mapping when the consent is renewed
  name          TEXT        NOT NULL DEFAULT '',
  iban_tail     TEXT        NOT NULL DEFAULT '', -- last 4 characters, for display only
  currency      TEXT        NOT NULL DEFAULT '',
  account       TEXT        NOT NULL,            -- app account name (the same values as expenses.account)
  synced_to     DATE                             -- transactions up to this date have been reviewed
);
CREATE INDEX bank_accounts_connection_idx ON bank_accounts (connection_id);
