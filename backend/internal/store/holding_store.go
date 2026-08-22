package store

import (
	"context"
	"errors"
	"time"

	"loot/backend/internal/portfolio"
)

func (s *Store) ListHoldings(ctx context.Context) ([]portfolio.Holding, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT h.id, h.account_id, h.instrument_id, a.name, a.currency, i.name, i.isin, i.ticker, i.instrument_type, i.asset_class, i.ter_bps,
			h.invested_minor, h.value_minor, h.tax_bps, h.planned_bps, h.is_pac, h.pac_bps, h.pac_frequency
		FROM holdings h
		JOIN accounts a ON a.id = h.account_id
		JOIN instruments i ON i.id = h.instrument_id
		ORDER BY h.is_pac DESC, h.value_minor DESC, i.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var holdings []portfolio.Holding
	totals := make(map[string]int64)
	for rows.Next() {
		var holding portfolio.Holding
		var isPacInt int
		if err := rows.Scan(&holding.ID, &holding.AccountID, &holding.InstrumentID, &holding.AccountName, &holding.Currency, &holding.InstrumentName, &holding.InstrumentISIN, &holding.InstrumentTicker, &holding.InstrumentType, &holding.AssetClass, &holding.TERBPS, &holding.InvestedMinor, &holding.ValueMinor, &holding.TaxBPS, &holding.PlannedBPS, &isPacInt, &holding.PACBPS, &holding.PACFrequency); err != nil {
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

func (s *Store) SaveHolding(ctx context.Context, holding *portfolio.Holding) error {
	if err := portfolio.ValidateHolding(*holding); err != nil {
		return err
	}

	// Validate DB constraint: total PAC allocation percentage for an account cannot exceed 100% (10,000 bps)
	if holding.IsPAC && holding.PACBPS > 0 {
		var currentSum int64
		if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(pac_bps), 0) FROM holdings WHERE account_id = ? AND id != ?`, holding.AccountID, holding.ID).Scan(&currentSum); err != nil {
			return err
		}
		if currentSum+holding.PACBPS > 10_000 {
			return errors.New("total PAC allocation percentage for this account cannot exceed 100%")
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
			INSERT INTO holdings (account_id, instrument_id, invested_minor, value_minor, tax_bps, planned_bps, is_pac, pac_bps, pac_frequency, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_id, instrument_id) DO UPDATE SET invested_minor=excluded.invested_minor,
				value_minor=excluded.value_minor, tax_bps=excluded.tax_bps, planned_bps=excluded.planned_bps,
				is_pac=excluded.is_pac, pac_bps=excluded.pac_bps, pac_frequency=excluded.pac_frequency, updated_at=excluded.updated_at
			RETURNING id`, holding.AccountID, holding.InstrumentID, holding.InvestedMinor, holding.ValueMinor, holding.TaxBPS, holding.PlannedBPS, isPacInt, holding.PACBPS, holding.PACFrequency, now).Scan(&holding.ID)
	}
	result, err := s.db.ExecContext(ctx, `UPDATE holdings SET account_id=?, instrument_id=?, invested_minor=?, value_minor=?, tax_bps=?, planned_bps=?, is_pac=?, pac_bps=?, pac_frequency=?, updated_at=? WHERE id=?`, holding.AccountID, holding.InstrumentID, holding.InvestedMinor, holding.ValueMinor, holding.TaxBPS, holding.PlannedBPS, isPacInt, holding.PACBPS, holding.PACFrequency, now, holding.ID)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return errors.New("holding not found")
	}
	return nil
}

func (s *Store) DeleteHolding(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM holdings WHERE id=?`, id)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return errors.New("holding not found")
	}
	return nil
}
