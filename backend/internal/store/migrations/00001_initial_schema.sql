-- +goose Up
CREATE TABLE reference_rates (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    rate_bps INTEGER NOT NULL,
    observed_on TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    institution TEXT NOT NULL DEFAULT '',
    account_type TEXT NOT NULL DEFAULT 'other' CHECK (account_type IN ('bank', 'broker', 'other')),
    preferred INTEGER NOT NULL DEFAULT 0 CHECK (preferred IN (0, 1)),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    balance_minor INTEGER NOT NULL CHECK (balance_minor >= 0),
    tax_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_bps BETWEEN 0 AND 10000),
    annual_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (annual_fee_minor >= 0),
    pac_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (pac_amount_minor >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX accounts_one_preferred ON accounts(preferred) WHERE preferred = 1;

CREATE TABLE interest_tiers (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    up_to_minor INTEGER,
    fixed_rate_bps INTEGER,
    reference_code TEXT REFERENCES reference_rates(code),
    spread_bps INTEGER NOT NULL DEFAULT 0,
    CHECK ((fixed_rate_bps IS NOT NULL) <> (reference_code IS NOT NULL)),
    UNIQUE (account_id, position)
);

CREATE TABLE instruments (
    id INTEGER PRIMARY KEY,
    isin TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    ticker TEXT NOT NULL DEFAULT '',
    instrument_type TEXT NOT NULL DEFAULT 'etf' CHECK (instrument_type IN ('etf', 'etc', 'etn', 'fund', 'stock', 'bond', 'crypto', 'commodity', 'real_estate', 'other')),
    provider TEXT NOT NULL DEFAULT '',
    index_name TEXT NOT NULL DEFAULT '',
    investment_focus TEXT NOT NULL DEFAULT '',
    asset_class TEXT NOT NULL DEFAULT '',
    strategy TEXT NOT NULL DEFAULT '',
    currency_hedged INTEGER NOT NULL DEFAULT 0 CHECK (currency_hedged IN (0, 1)),
    starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
    data_status TEXT NOT NULL DEFAULT 'enriched' CHECK (data_status IN ('catalog', 'enriched')),
    distribution TEXT NOT NULL CHECK (distribution IN ('accumulating', 'distributing')),
    replication TEXT NOT NULL CHECK (replication IN ('physical_full', 'physical_sampling', 'synthetic')),
    domicile TEXT NOT NULL DEFAULT '',
    fund_currency TEXT NOT NULL CHECK (length(fund_currency) = 3),
    ter_bps INTEGER NOT NULL CHECK (ter_bps BETWEEN 0 AND 1000),
    fund_size_million INTEGER NOT NULL DEFAULT 0 CHECK (fund_size_million >= 0),
    inception_date TEXT NOT NULL DEFAULT '',
    tracking_difference_bps INTEGER,
    tracking_error_bps INTEGER,
    ucits INTEGER NOT NULL DEFAULT 0 CHECK (ucits IN (0, 1)),
    source_url TEXT NOT NULL DEFAULT '',
    refreshed_at TEXT NOT NULL,
    enriched_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE instrument_exclusions (
    isin TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    checked_at TEXT NOT NULL
);

CREATE TABLE holdings (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id),
    invested_minor INTEGER NOT NULL DEFAULT 0 CHECK (invested_minor >= 0),
    value_minor INTEGER NOT NULL DEFAULT 0 CHECK (value_minor >= 0),
    tax_bps INTEGER NOT NULL DEFAULT 2600 CHECK (tax_bps BETWEEN 0 AND 10000),
    planned_bps INTEGER NOT NULL DEFAULT 0 CHECK (planned_bps BETWEEN 0 AND 10000),
    is_pac INTEGER NOT NULL DEFAULT 0,
    pac_bps INTEGER NOT NULL DEFAULT 0 CHECK (pac_bps BETWEEN 0 AND 10000),
    pac_frequency TEXT NOT NULL DEFAULT 'monthly',
    updated_at TEXT NOT NULL,
    UNIQUE (account_id, instrument_id)
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
    kind TEXT NOT NULL CHECK (kind IN ('cash', 'holding')),
    asset_key TEXT NOT NULL DEFAULT '',
    asset_name TEXT NOT NULL,
    invested_minor INTEGER NOT NULL DEFAULT 0 CHECK (invested_minor >= 0),
    value_minor INTEGER NOT NULL DEFAULT 0 CHECK (value_minor >= 0),
    tax_bps INTEGER NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000)
);

-- +goose Down
DROP TABLE snapshot_entries;
DROP TABLE snapshots;
DROP TABLE holdings;
DROP TABLE instrument_exclusions;
DROP TABLE instruments;
DROP TABLE interest_tiers;
DROP TABLE accounts;
DROP TABLE reference_rates;
