ALTER TABLE etfs ADD COLUMN investment_focus TEXT NOT NULL DEFAULT '';
ALTER TABLE etfs ADD COLUMN asset_class TEXT NOT NULL DEFAULT '';
ALTER TABLE etfs ADD COLUMN strategy TEXT NOT NULL DEFAULT '';
ALTER TABLE etfs ADD COLUMN currency_hedged INTEGER NOT NULL DEFAULT 0 CHECK (currency_hedged IN (0, 1));
ALTER TABLE etfs ADD COLUMN data_status TEXT NOT NULL DEFAULT 'enriched' CHECK (data_status IN ('catalog', 'enriched'));
