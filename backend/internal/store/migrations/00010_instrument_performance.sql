-- +goose Up
CREATE TABLE instrument_performance (
    isin TEXT NOT NULL,
    date TEXT NOT NULL,
    change_bps INTEGER NOT NULL,
    PRIMARY KEY (isin, date),
    FOREIGN KEY (isin) REFERENCES instruments(isin) ON DELETE CASCADE
);

CREATE TABLE instrument_performance_meta (
    isin TEXT PRIMARY KEY REFERENCES instruments(isin) ON DELETE CASCADE,
    fetched_at TEXT NOT NULL,
    point_count INTEGER NOT NULL
);

-- +goose Down
DROP TABLE instrument_performance_meta;
DROP TABLE instrument_performance;
