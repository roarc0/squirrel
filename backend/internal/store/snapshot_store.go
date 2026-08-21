package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"loot/backend/internal/portfolio"
)

func (s *Store) CreateSnapshot(ctx context.Context, observedOn string, defaultCurrency string) (portfolio.Snapshot, error) {
	if _, err := time.Parse(time.DateOnly, observedOn); err != nil {
		return portfolio.Snapshot{}, errors.New("snapshot date must use YYYY-MM-DD")
	}
	if err := s.SaveSnapshot(ctx, observedOn); err != nil {
		return portfolio.Snapshot{}, err
	}
	snapshots, err := s.ListSnapshots(ctx)
	if err != nil {
		return portfolio.Snapshot{}, err
	}
	for _, snap := range snapshots {
		if snap.ObservedOn == observedOn {
			return snap, nil
		}
	}
	return portfolio.Snapshot{}, errors.New("snapshot creation failed")
}

func (s *Store) SaveSnapshot(ctx context.Context, observedOn string) error {
	if _, err := time.Parse(time.DateOnly, observedOn); err != nil {
		return errors.New("snapshot date must use YYYY-MM-DD")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var accountCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM accounts WHERE archived=0`).Scan(&accountCount); err != nil {
		return err
	}
	if accountCount == 0 {
		return errors.New("add an account before saving a snapshot")
	}
	var snapshotID int64
	now := time.Now().UTC().Format(time.RFC3339)
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO snapshots (observed_on, created_at) VALUES (?, ?)
		ON CONFLICT(observed_on) DO UPDATE SET created_at=excluded.created_at
		RETURNING id`, observedOn, now).Scan(&snapshotID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM snapshot_entries WHERE snapshot_id=?`, snapshotID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO snapshot_entries (snapshot_id, account_name, currency, kind, asset_name, value_minor, tax_bps)
		SELECT ?, name, currency, 'cash', 'Cash', balance_minor, tax_bps FROM accounts WHERE archived=0`, snapshotID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO snapshot_entries (snapshot_id, account_name, currency, kind, asset_key, asset_name, invested_minor, value_minor, tax_bps)
		SELECT ?, a.name, a.currency, 'holding', i.isin, i.name, h.invested_minor, h.value_minor, h.tax_bps
		FROM holdings h JOIN accounts a ON a.id=h.account_id JOIN instruments i ON i.id=h.instrument_id WHERE a.archived=0`, snapshotID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ListSnapshots(ctx context.Context) ([]portfolio.Snapshot, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.observed_on, e.currency,
			SUM(CASE WHEN e.kind='cash' THEN e.value_minor ELSE 0 END),
			SUM(CASE WHEN e.kind='holding' THEN e.invested_minor ELSE 0 END),
			SUM(CASE WHEN e.kind='holding' THEN e.value_minor ELSE 0 END),
			SUM(e.value_minor)
		FROM snapshots s JOIN snapshot_entries e ON e.snapshot_id=s.id
		GROUP BY s.id, s.observed_on, e.currency
		ORDER BY s.observed_on, e.currency`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var snapshots []portfolio.Snapshot
	for rows.Next() {
		var snapshot portfolio.Snapshot
		if err := rows.Scan(&snapshot.ID, &snapshot.ObservedOn, &snapshot.Currency, &snapshot.CashMinor, &snapshot.InvestedMinor, &snapshot.PortfolioMinor, &snapshot.TotalMinor); err != nil {
			return nil, err
		}
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, rows.Err()
}

func (s *Store) UpdateSnapshot(ctx context.Context, snapshot *portfolio.Snapshot) error {
	snapshot.Currency = strings.ToUpper(strings.TrimSpace(snapshot.Currency))
	if snapshot.ID <= 0 {
		return errors.New("snapshot is required")
	}
	if err := portfolio.ValidateSnapshot(*snapshot); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var conflicts, entries int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM snapshots WHERE observed_on=? AND id<>?`, snapshot.ObservedOn, snapshot.ID).Scan(&conflicts); err != nil {
		return err
	}
	if conflicts > 0 {
		return errors.New("a snapshot already exists for that date")
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM snapshot_entries WHERE snapshot_id=? AND currency=?`, snapshot.ID, snapshot.Currency).Scan(&entries); err != nil {
		return err
	}
	if entries == 0 {
		return errors.New("snapshot currency not found")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE snapshots SET observed_on=? WHERE id=?`, snapshot.ObservedOn, snapshot.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM snapshot_entries WHERE snapshot_id=? AND currency=?`, snapshot.ID, snapshot.Currency); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO snapshot_entries (snapshot_id, account_name, currency, kind, asset_name, value_minor, tax_bps) VALUES (?, 'Manual correction', ?, 'cash', 'Cash', ?, 0)`, snapshot.ID, snapshot.Currency, snapshot.CashMinor); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO snapshot_entries (snapshot_id, account_name, currency, kind, asset_key, asset_name, invested_minor, value_minor, tax_bps) VALUES (?, 'Manual correction', ?, 'holding', 'manual', 'Investments', ?, ?, 0)`, snapshot.ID, snapshot.Currency, snapshot.InvestedMinor, snapshot.PortfolioMinor); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteSnapshot(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM snapshots WHERE id=?`, id)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return errors.New("snapshot not found")
	}
	return nil
}
