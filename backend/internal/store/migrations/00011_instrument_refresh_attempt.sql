-- +goose Up
ALTER TABLE instruments ADD COLUMN last_refresh_attempt_at TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE instruments DROP COLUMN last_refresh_attempt_at;
