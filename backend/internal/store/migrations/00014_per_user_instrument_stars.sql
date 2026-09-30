-- +goose Up
CREATE TABLE IF NOT EXISTS instrument_starred (
    user_id TEXT NOT NULL DEFAULT '',
    isin TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, isin)
);

INSERT OR IGNORE INTO instrument_starred (user_id, isin, created_at)
SELECT '', isin, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM instruments
WHERE starred = 1;

-- +goose Down
DROP TABLE IF EXISTS instrument_starred;
