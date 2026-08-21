ALTER TABLE etfs ADD COLUMN enriched_at TEXT NOT NULL DEFAULT '';
UPDATE etfs SET enriched_at=refreshed_at WHERE data_status='enriched';

CREATE TABLE etf_exclusions (
    isin TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    checked_at TEXT NOT NULL
);
