ALTER TABLE etfs ADD COLUMN ucits INTEGER NOT NULL DEFAULT 0 CHECK (ucits IN (0, 1));

CREATE TABLE positions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    etf_id INTEGER NOT NULL REFERENCES etfs(id),
    invested_minor INTEGER NOT NULL DEFAULT 0 CHECK (invested_minor >= 0),
    value_minor INTEGER NOT NULL DEFAULT 0 CHECK (value_minor >= 0),
    tax_bps INTEGER NOT NULL DEFAULT 2600 CHECK (tax_bps BETWEEN 0 AND 10000),
    updated_at TEXT NOT NULL,
    UNIQUE (account_id, etf_id)
);

CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY,
    observed_on TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE snapshot_entries (
    id INTEGER PRIMARY KEY,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    account_name TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    kind TEXT NOT NULL CHECK (kind IN ('cash', 'etf')),
    asset_key TEXT NOT NULL DEFAULT '',
    asset_name TEXT NOT NULL,
    invested_minor INTEGER NOT NULL DEFAULT 0 CHECK (invested_minor >= 0),
    value_minor INTEGER NOT NULL DEFAULT 0 CHECK (value_minor >= 0),
    tax_bps INTEGER NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000)
);
