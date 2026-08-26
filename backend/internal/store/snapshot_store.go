package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

func (s *Store) SaveSnapshot(ctx context.Context, observedOn string, userID string) error {
	if _, err := time.Parse(time.DateOnly, observedOn); err != nil {
		return errors.New("snapshot date must use YYYY-MM-DD")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	userFilter := ` AND user_id=?`
	userArgs := []any{userID}

	var accountCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM accounts WHERE archived=0`+userFilter, userArgs...).Scan(&accountCount); err != nil {
		return err
	}
	if accountCount == 0 {
		return errors.New("add an account before saving a snapshot")
	}
	var snapshotID int64
	now := time.Now().UTC().Format(time.RFC3339)
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO snapshots (user_id, observed_on, created_at) VALUES (?, ?, ?)
		ON CONFLICT(observed_on, user_id) DO UPDATE SET created_at=excluded.created_at
		RETURNING id`, userID, observedOn, now).Scan(&snapshotID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM snapshot_entries WHERE snapshot_id=?`, snapshotID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO snapshot_entries (snapshot_id, account_name, currency, kind, asset_name, value_minor, tax_bps)
		SELECT ?, name, currency, 'cash', 'Cash', balance_minor, tax_bps FROM accounts WHERE archived=0`+userFilter,
		append([]any{snapshotID}, userArgs...)...); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO snapshot_entries (snapshot_id, account_name, currency, kind, asset_key, asset_name, invested_minor, value_minor, tax_bps)
		SELECT ?, a.name, a.currency, 'holding', i.isin, i.name, h.invested_minor, h.value_minor, h.tax_bps
		FROM holdings h JOIN accounts a ON a.id=h.account_id JOIN instruments i ON i.id=h.instrument_id WHERE a.archived=0 AND a.user_id=?`,
		append([]any{snapshotID}, userArgs...)...); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ListSnapshots(ctx context.Context, userID string) ([]portfolio.Snapshot, error) {
	query := `
		SELECT s.id, s.observed_on, e.currency,
			SUM(CASE WHEN e.kind='cash' THEN e.value_minor ELSE 0 END),
			SUM(CASE WHEN e.kind='holding' THEN e.invested_minor ELSE 0 END),
			SUM(CASE WHEN e.kind='holding' THEN e.value_minor ELSE 0 END),
			SUM(e.value_minor)
		FROM snapshots s JOIN snapshot_entries e ON e.snapshot_id=s.id`
	query += ` WHERE s.user_id = ?`
	query += ` GROUP BY s.id, s.observed_on, e.currency ORDER BY s.observed_on, e.currency`
	rows, err := s.db.QueryContext(ctx, query, userID)
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

func (s *Store) UpdateSnapshot(ctx context.Context, snapshot *portfolio.Snapshot, userID string) error {
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

	ownerClause := ` AND user_id=?`
	ownerArgs := []any{userID}

	var conflicts, entries int
	queryConflict := `SELECT COUNT(*) FROM snapshots WHERE observed_on=? AND id<>?` + ownerClause
	argsConflict := append([]any{snapshot.ObservedOn, snapshot.ID}, ownerArgs...)
	if err := tx.QueryRowContext(ctx, queryConflict, argsConflict...).Scan(&conflicts); err != nil {
		return err
	}
	if conflicts > 0 {
		return errors.New("a snapshot already exists for that date")
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM snapshot_entries e JOIN snapshots s ON s.id=e.snapshot_id WHERE e.snapshot_id=? AND e.currency=? AND s.user_id=?`, snapshot.ID, snapshot.Currency, userID).Scan(&entries); err != nil {
		return err
	}
	if entries == 0 {
		return errors.New("snapshot currency not found")
	}
	result, err := tx.ExecContext(ctx, `UPDATE snapshots SET observed_on=? WHERE id=?`+ownerClause, append([]any{snapshot.ObservedOn, snapshot.ID}, ownerArgs...)...)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return errors.New("snapshot not found")
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

func (s *Store) DeleteSnapshot(ctx context.Context, id int64, userID string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM snapshots WHERE id=? AND user_id=?`, id, userID)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return errors.New("snapshot not found")
	}
	return nil
}

func (s *Store) UpdateSituation(ctx context.Context, userID string, accountUpdates map[int64]int64, holdingValueUpdates map[int64]int64, holdingInvestedUpdates map[int64]*int64, saveSnapshot bool, observedOn string) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339)

	accountOwner := ` AND user_id=?`
	holdingOwner := ` AND account_id IN (SELECT id FROM accounts WHERE user_id=?)`

	for accountID, balanceMinor := range accountUpdates {
		if balanceMinor < 0 || balanceMinor > 1_000_000_000_000 {
			return false, errors.New("account balance is outside the supported range")
		}
		result, err := tx.ExecContext(ctx, `UPDATE accounts SET balance_minor=?, updated_at=? WHERE id=?`+accountOwner, balanceMinor, now, accountID, userID)
		if err != nil {
			return false, fmt.Errorf("update account %d cash: %w", accountID, err)
		}
		if changed, _ := result.RowsAffected(); changed == 0 {
			return false, fmt.Errorf("account %d not found", accountID)
		}
	}

	for holdingID, valueMinor := range holdingValueUpdates {
		if valueMinor < 0 || valueMinor > 1_000_000_000_000 {
			return false, errors.New("holding value is outside the supported range")
		}
		if investedPtr := holdingInvestedUpdates[holdingID]; investedPtr != nil {
			investedMinor := *investedPtr
			if investedMinor < 0 || investedMinor > 1_000_000_000_000 {
				return false, errors.New("invested value is outside the supported range")
			}
			result, err := tx.ExecContext(ctx, `UPDATE holdings SET value_minor=?, invested_minor=?, updated_at=? WHERE id=?`+holdingOwner, valueMinor, investedMinor, now, holdingID, userID)
			if err != nil {
				return false, fmt.Errorf("update holding %d value and invested: %w", holdingID, err)
			}
			if changed, _ := result.RowsAffected(); changed == 0 {
				return false, fmt.Errorf("holding %d not found", holdingID)
			}
		} else {
			result, err := tx.ExecContext(ctx, `UPDATE holdings SET value_minor=?, updated_at=? WHERE id=?`+holdingOwner, valueMinor, now, holdingID, userID)
			if err != nil {
				return false, fmt.Errorf("update holding %d value: %w", holdingID, err)
			}
			if changed, _ := result.RowsAffected(); changed == 0 {
				return false, fmt.Errorf("holding %d not found", holdingID)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return false, err
	}

	if saveSnapshot {
		if observedOn == "" {
			observedOn = time.Now().Format(time.DateOnly)
		}
		if err := s.SaveSnapshot(ctx, observedOn, userID); err != nil {
			return false, fmt.Errorf("save snapshot: %w", err)
		}
		return true, nil
	}

	return false, nil
}
