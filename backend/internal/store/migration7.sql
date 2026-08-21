ALTER TABLE etfs ADD COLUMN instrument_type TEXT NOT NULL DEFAULT 'etf'
    CHECK (instrument_type IN ('etf', 'etc', 'etn', 'fund', 'stock', 'bond', 'crypto', 'commodity', 'real_estate', 'other'));
