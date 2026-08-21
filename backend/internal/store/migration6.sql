ALTER TABLE accounts ADD COLUMN account_type TEXT NOT NULL DEFAULT 'other' CHECK (account_type IN ('bank', 'broker', 'other'));
ALTER TABLE accounts ADD COLUMN preferred INTEGER NOT NULL DEFAULT 0 CHECK (preferred IN (0, 1));
UPDATE accounts SET preferred = 1 WHERE id = (SELECT id FROM accounts ORDER BY id LIMIT 1);
CREATE UNIQUE INDEX accounts_one_preferred ON accounts(preferred) WHERE preferred = 1;
