-- +goose Up
DROP INDEX accounts_one_preferred;
CREATE UNIQUE INDEX accounts_one_preferred ON accounts(user_id) WHERE preferred = 1;

-- +goose Down
DROP INDEX accounts_one_preferred;
CREATE UNIQUE INDEX accounts_one_preferred ON accounts(preferred) WHERE preferred = 1;
