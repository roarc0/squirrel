ALTER TABLE etfs RENAME TO instruments;
ALTER TABLE etf_exclusions RENAME TO instrument_exclusions;
ALTER TABLE positions RENAME TO holdings;
ALTER TABLE holdings RENAME COLUMN etf_id TO instrument_id;
ALTER TABLE holdings ADD COLUMN planned_bps INTEGER NOT NULL DEFAULT 0 CHECK (planned_bps BETWEEN 0 AND 10000);

CREATE TABLE snapshot_entries_new (
    id INTEGER PRIMARY KEY,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    account_name TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    kind TEXT NOT NULL CHECK (kind IN ('cash', 'holding')),
    asset_key TEXT NOT NULL DEFAULT '',
    asset_name TEXT NOT NULL,
    invested_minor INTEGER NOT NULL DEFAULT 0 CHECK (invested_minor >= 0),
    value_minor INTEGER NOT NULL DEFAULT 0 CHECK (value_minor >= 0),
    tax_bps INTEGER NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000)
);

INSERT INTO snapshot_entries_new (id, snapshot_id, account_name, currency, kind, asset_key, asset_name, invested_minor, value_minor, tax_bps)
SELECT id, snapshot_id, account_name, currency, CASE kind WHEN 'etf' THEN 'holding' ELSE kind END,
       asset_key, asset_name, invested_minor, value_minor, tax_bps
FROM snapshot_entries;

DROP TABLE snapshot_entries;
ALTER TABLE snapshot_entries_new RENAME TO snapshot_entries;
