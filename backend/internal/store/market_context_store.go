package store

import (
	"context"
	"time"

	"github.com/roarc0/squirrel/backend/internal/ecb"
)

func (s *Store) SaveMarketContext(ctx context.Context, market ecb.MarketContext) error {
	now := time.Now().UTC().Format(time.RFC3339)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	metricStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO market_metrics (code, label, category, value, unit, observed_on, source_url, change_1y, distance_52w_high, sma_200, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(code) DO UPDATE SET
			label = excluded.label,
			category = excluded.category,
			value = excluded.value,
			unit = excluded.unit,
			observed_on = excluded.observed_on,
			source_url = excluded.source_url,
			change_1y = excluded.change_1y,
			distance_52w_high = excluded.distance_52w_high,
			sma_200 = excluded.sma_200,
			updated_at = excluded.updated_at
	`)
	if err != nil {
		return err
	}
	defer metricStmt.Close()

	for _, m := range market.Metrics {
		if _, err := metricStmt.ExecContext(ctx, m.Code, m.Label, m.Category, m.Value, m.Unit, m.ObservedOn, m.SourceURL, m.Change1Y, m.Distance52WHigh, m.SMA200, now); err != nil {
			return err
		}
	}

	obsStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO market_observations (code, observed_on, value, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(code, observed_on) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`)
	if err != nil {
		return err
	}
	defer obsStmt.Close()

	for _, obs := range market.Observations {
		if _, err := obsStmt.ExecContext(ctx, obs.Code, obs.ObservedOn, obs.Value, now); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) ListMarketMetrics(ctx context.Context) ([]ecb.Metric, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT code, label, category, value, unit, observed_on, source_url, change_1y, distance_52w_high, sma_200
		FROM market_metrics
		ORDER BY category, code
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var metrics []ecb.Metric
	for rows.Next() {
		var m ecb.Metric
		if err := rows.Scan(&m.Code, &m.Label, &m.Category, &m.Value, &m.Unit, &m.ObservedOn, &m.SourceURL, &m.Change1Y, &m.Distance52WHigh, &m.SMA200); err != nil {
			return nil, err
		}
		metrics = append(metrics, m)
	}
	return metrics, rows.Err()
}

func (s *Store) ListMarketObservations(ctx context.Context) ([]ecb.Observation, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT code, observed_on, value
		FROM market_observations
		ORDER BY observed_on ASC, code ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var observations []ecb.Observation
	for rows.Next() {
		var obs ecb.Observation
		if err := rows.Scan(&obs.Code, &obs.ObservedOn, &obs.Value); err != nil {
			return nil, err
		}
		observations = append(observations, obs)
	}
	return observations, rows.Err()
}
