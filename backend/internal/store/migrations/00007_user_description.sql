-- +goose Up
-- +goose StatementBegin
ALTER TABLE user_profiles ADD COLUMN user_description TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- SQLite does not support ALTER TABLE DROP COLUMN cleanly in older versions
-- +goose StatementEnd
