-- +goose Up
ALTER TABLE instruments DROP COLUMN enriched_at;

-- +goose Down
ALTER TABLE instruments ADD COLUMN enriched_at TEXT NOT NULL DEFAULT '';
