-- +goose Up
ALTER TABLE instruments ADD COLUMN previous_instrument_type TEXT;
UPDATE instruments SET previous_instrument_type = instrument_type;
ALTER TABLE instruments DROP COLUMN instrument_type;
ALTER TABLE instruments ADD COLUMN instrument_type TEXT NOT NULL DEFAULT 'etf' CHECK (instrument_type IN ('etf', 'etc', 'etn', 'etp', 'fund', 'stock', 'bond', 'crypto', 'commodity', 'real_estate', 'other'));
UPDATE instruments SET instrument_type = previous_instrument_type;
ALTER TABLE instruments DROP COLUMN previous_instrument_type;

UPDATE instruments SET instrument_type = 'etp'
WHERE instrument_type = 'etf'
  AND (' ' || upper(name) || ' ') GLOB '*[^A-Z]ETP[^A-Z]*'
  AND (' ' || upper(name) || ' ') NOT GLOB '*[^A-Z]ETF[^A-Z]*'
  AND (' ' || upper(name) || ' ') NOT GLOB '*[^A-Z]ETC[^A-Z]*'
  AND (' ' || upper(name) || ' ') NOT GLOB '*[^A-Z]ETN[^A-Z]*';

-- +goose Down
ALTER TABLE instruments ADD COLUMN previous_instrument_type TEXT;
UPDATE instruments SET previous_instrument_type = instrument_type;
ALTER TABLE instruments DROP COLUMN instrument_type;
ALTER TABLE instruments ADD COLUMN instrument_type TEXT NOT NULL DEFAULT 'etf' CHECK (instrument_type IN ('etf', 'etc', 'etn', 'fund', 'stock', 'bond', 'crypto', 'commodity', 'real_estate', 'other'));
UPDATE instruments SET instrument_type = CASE WHEN previous_instrument_type = 'etp' THEN 'other' ELSE previous_instrument_type END;
ALTER TABLE instruments DROP COLUMN previous_instrument_type;
