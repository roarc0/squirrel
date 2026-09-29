-- +goose Up
ALTER TABLE holdings DROP COLUMN planned_bps;

-- +goose Down
ALTER TABLE holdings ADD COLUMN planned_bps INTEGER NOT NULL DEFAULT 0 CHECK (planned_bps BETWEEN 0 AND 10000);
