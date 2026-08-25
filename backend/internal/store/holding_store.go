package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"squirrel/backend/internal/portfolio"
)

func (s *Store) ListHoldings(ctx context.Context, userID string) ([]portfolio.Holding, error) {
	where := ""
	var args []any
	if userID != "" {
		where = ` WHERE (a.user_id = ? OR a.user_id = '')`
		args = append(args, userID)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT h.id, h.account_id, h.instrument_id, a.name, a.currency, i.name, i.isin, i.ticker, i.instrument_type, i.asset_class, i.ter_bps,
			h.invested_minor, h.value_minor, h.tax_bps, h.planned_bps, h.is_pac, h.pac_bps, h.pac_frequency, COALESCE(h.notes, '')
		FROM holdings h
		JOIN accounts a ON a.id = h.account_id
		JOIN instruments i ON i.id = h.instrument_id`+where+`
		ORDER BY h.is_pac DESC, h.value_minor DESC, i.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var holdings []portfolio.Holding
	totals := make(map[string]int64)
	for rows.Next() {
		var holding portfolio.Holding
		var isPacInt int
		if err := rows.Scan(&holding.ID, &holding.AccountID, &holding.InstrumentID, &holding.AccountName, &holding.Currency, &holding.InstrumentName, &holding.InstrumentISIN, &holding.InstrumentTicker, &holding.InstrumentType, &holding.AssetClass, &holding.TERBPS, &holding.InvestedMinor, &holding.ValueMinor, &holding.TaxBPS, &holding.PlannedBPS, &isPacInt, &holding.PACBPS, &holding.PACFrequency, &holding.Notes); err != nil {
			return nil, err
		}
		holding.IsPAC = isPacInt != 0
		if holding.PACFrequency == "" {
			holding.PACFrequency = "monthly"
		}
		holdings = append(holdings, holding)
		totals[holding.Currency] += holding.ValueMinor
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for index := range holdings {
		if total := totals[holdings[index].Currency]; total > 0 {
			holdings[index].ActualBPS = (holdings[index].ValueMinor*10_000 + total/2) / total
		}
	}
	return holdings, nil
}

func (s *Store) GetHolding(ctx context.Context, id int64, userID string) (*portfolio.Holding, error) {
	var h portfolio.Holding
	var isPacInt int
	where := `WHERE h.id = ?`
	args := []any{id}
	if userID != "" {
		where += ` AND (a.user_id = ? OR a.user_id = '')`
		args = append(args, userID)
	}
	err := s.db.QueryRowContext(ctx, `
		SELECT h.id, h.account_id, h.instrument_id, a.name, a.currency, i.name, i.isin, i.ticker, i.instrument_type, i.asset_class, i.ter_bps,
			h.invested_minor, h.value_minor, h.tax_bps, h.planned_bps, h.is_pac, h.pac_bps, h.pac_frequency, COALESCE(h.notes, '')
		FROM holdings h
		JOIN accounts a ON a.id = h.account_id
		JOIN instruments i ON i.id = h.instrument_id
		`+where, args...).Scan(
		&h.ID, &h.AccountID, &h.InstrumentID, &h.AccountName, &h.Currency, &h.InstrumentName, &h.InstrumentISIN, &h.InstrumentTicker, &h.InstrumentType, &h.AssetClass, &h.TERBPS,
		&h.InvestedMinor, &h.ValueMinor, &h.TaxBPS, &h.PlannedBPS, &isPacInt, &h.PACBPS, &h.PACFrequency, &h.Notes,
	)
	if err != nil {
		return nil, err
	}
	h.IsPAC = isPacInt != 0
	if h.PACFrequency == "" {
		h.PACFrequency = "monthly"
	}
	return &h, nil
}

func (s *Store) SaveHolding(ctx context.Context, holding *portfolio.Holding) error {
	if err := portfolio.ValidateHolding(*holding); err != nil {
		return err
	}

	if holding.PACBPS > 0 {
		holding.IsPAC = true
	}

	// Validate DB constraint: total PAC allocation percentage for an account cannot exceed 100% (10,000 bps)
	if holding.PACBPS > 0 {
		var currentSum int64
		if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(pac_bps), 0) FROM holdings WHERE account_id = ? AND id != ?`, holding.AccountID, holding.ID).Scan(&currentSum); err != nil {
			return err
		}
		if currentSum+holding.PACBPS > 10_000 {
			return fmt.Errorf("total PAC allocation for this account would be %d.%02d%% (max allowed is 100.00%%)", (currentSum+holding.PACBPS)/100, (currentSum+holding.PACBPS)%100)
		}
	}

	now := time.Now().UTC().Format(time.RFC3339)
	isPacInt := 0
	if holding.IsPAC {
		isPacInt = 1
	}
	if holding.PACFrequency == "" {
		holding.PACFrequency = "monthly"
	}
	if holding.ID == 0 {
		return s.db.QueryRowContext(ctx, `
			INSERT INTO holdings (account_id, instrument_id, invested_minor, value_minor, tax_bps, planned_bps, is_pac, pac_bps, pac_frequency, notes, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_id, instrument_id) DO UPDATE SET invested_minor=excluded.invested_minor,
				value_minor=excluded.value_minor, tax_bps=excluded.tax_bps, planned_bps=excluded.planned_bps,
				is_pac=excluded.is_pac, pac_bps=excluded.pac_bps, pac_frequency=excluded.pac_frequency, notes=excluded.notes, updated_at=excluded.updated_at
			RETURNING id`, holding.AccountID, holding.InstrumentID, holding.InvestedMinor, holding.ValueMinor, holding.TaxBPS, holding.PlannedBPS, isPacInt, holding.PACBPS, holding.PACFrequency, holding.Notes, now).Scan(&holding.ID)
	}
	// Guard against moving to an (account, instrument) pair that already exists.
	var conflict int64
	if err := s.db.QueryRowContext(ctx, `SELECT id FROM holdings WHERE account_id=? AND instrument_id=? AND id!=?`, holding.AccountID, holding.InstrumentID, holding.ID).Scan(&conflict); err == nil {
		return fmt.Errorf("a holding for this instrument already exists in this account — delete the duplicate first")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE holdings SET account_id=?, instrument_id=?, invested_minor=?, value_minor=?, tax_bps=?, planned_bps=?, is_pac=?, pac_bps=?, pac_frequency=?, notes=?, updated_at=? WHERE id=?`, holding.AccountID, holding.InstrumentID, holding.InvestedMinor, holding.ValueMinor, holding.TaxBPS, holding.PlannedBPS, isPacInt, holding.PACBPS, holding.PACFrequency, holding.Notes, now, holding.ID)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return errors.New("holding not found")
	}
	return nil
}

func (s *Store) DeleteHolding(ctx context.Context, id int64, userID string) error {
	query := `DELETE FROM holdings WHERE id=?`
	args := []any{id}
	if userID != "" {
		query += ` AND account_id IN (SELECT id FROM accounts WHERE user_id = ? OR user_id = '')`
		args = append(args, userID)
	}
	result, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return errors.New("holding not found")
	}
	return nil
}
