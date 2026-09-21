package store

import (
	"context"
	"database/sql"
	"time"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

func (s *Store) GetPerformanceMeta(ctx context.Context, isin string) (portfolio.PerformanceMeta, error) {
	var meta portfolio.PerformanceMeta
	err := s.db.QueryRowContext(ctx, `SELECT isin, fetched_at, point_count FROM instrument_performance_meta WHERE isin = ?`, isin).
		Scan(&meta.ISIN, &meta.FetchedAt, &meta.PointCount)
	if err == sql.ErrNoRows {
		return portfolio.PerformanceMeta{}, ErrNotFound
	}
	return meta, err
}

func (s *Store) GetPerformance(ctx context.Context, isin string) ([]portfolio.PerformancePoint, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT date, change_bps FROM instrument_performance WHERE isin = ? ORDER BY date`, isin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var points []portfolio.PerformancePoint
	for rows.Next() {
		var p portfolio.PerformancePoint
		if err := rows.Scan(&p.Date, &p.ChangeBPS); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

func (s *Store) SavePerformance(ctx context.Context, isin string, points []portfolio.PerformancePoint) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM instrument_performance WHERE isin = ?`, isin); err != nil {
		return err
	}

	stmt, err := tx.PrepareContext(ctx, `INSERT INTO instrument_performance (isin, date, change_bps) VALUES (?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, p := range points {
		if _, err := stmt.ExecContext(ctx, isin, p.Date, p.ChangeBPS); err != nil {
			return err
		}
	}

	now := time.Now().UTC().Format(time.RFC3339)
	_, err = tx.ExecContext(ctx,
		`INSERT INTO instrument_performance_meta (isin, fetched_at, point_count) VALUES (?, ?, ?)
		 ON CONFLICT(isin) DO UPDATE SET fetched_at = excluded.fetched_at, point_count = excluded.point_count`,
		isin, now, len(points))
	if err != nil {
		return err
	}

	return tx.Commit()
}
