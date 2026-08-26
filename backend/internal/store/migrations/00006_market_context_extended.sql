-- +goose Up
ALTER TABLE market_metrics ADD COLUMN change_1y REAL;
ALTER TABLE market_metrics ADD COLUMN distance_52w_high REAL;
ALTER TABLE market_metrics ADD COLUMN sma_200 REAL;

-- +goose Down
ALTER TABLE market_metrics DROP COLUMN sma_200;
ALTER TABLE market_metrics DROP COLUMN distance_52w_high;
ALTER TABLE market_metrics DROP COLUMN change_1y;
