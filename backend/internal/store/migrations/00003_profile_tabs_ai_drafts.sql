-- +goose Up
-- +goose StatementBegin
ALTER TABLE user_profiles ADD COLUMN active_tab TEXT NOT NULL DEFAULT 'overview';
ALTER TABLE user_profiles ADD COLUMN ai_settings_json TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN draft_portfolios_json TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- SQLite does not support ALTER TABLE DROP COLUMN cleanly in older versions
-- +goose StatementEnd
