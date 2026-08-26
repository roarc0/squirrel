-- +goose Up
CREATE TABLE market_metrics (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    category TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    observed_on TEXT NOT NULL,
    source_url TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE market_observations (
    code TEXT NOT NULL,
    observed_on TEXT NOT NULL,
    value REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (code, observed_on)
);

-- +goose Down
DROP TABLE market_observations;
DROP TABLE market_metrics;
