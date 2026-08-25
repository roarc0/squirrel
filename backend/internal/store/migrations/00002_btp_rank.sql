-- +goose Up
ALTER TABLE user_profiles ADD COLUMN enable_btp_ranks INTEGER NOT NULL DEFAULT 0 CHECK (enable_btp_ranks IN (0, 1));

CREATE TABLE btp_cache (
    isin TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bond_type TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    coupon REAL NOT NULL DEFAULT 0,
    expiry_date TEXT NOT NULL,
    maturity_years REAL NOT NULL DEFAULT 0,
    duration_mac REAL NOT NULL DEFAULT 0,
    duration_mod REAL NOT NULL DEFAULT 0,
    rate_hike_impact REAL NOT NULL DEFAULT 0,
    simple_yield_net REAL NOT NULL DEFAULT 0,
    simple_yield_gross REAL NOT NULL DEFAULT 0,
    ytm_gross REAL NOT NULL DEFAULT 0,
    ytm_net REAL NOT NULL DEFAULT 0,
    total_return_net REAL NOT NULL DEFAULT 0,
    total_return_gross REAL NOT NULL DEFAULT 0,
    score REAL NOT NULL DEFAULT 0,
    tier_rank TEXT NOT NULL DEFAULT 'F',
    is_traded INTEGER NOT NULL DEFAULT 1 CHECK (is_traded IN (0, 1)),
    scraped_at TEXT NOT NULL
);

CREATE TABLE btp_starred (
    user_id TEXT NOT NULL DEFAULT '',
    isin TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, isin)
);

-- +goose Down
DROP TABLE IF EXISTS btp_starred;
DROP TABLE IF EXISTS btp_cache;
-- SQLite does not support dropping columns directly in older versions, so enable_btp_ranks can remain.
