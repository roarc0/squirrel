package store

import (
	"context"
	"errors"
	"time"

	"loot/backend/internal/portfolio"
)

func (s *Store) ListHoldings(ctx context.Context) ([]portfolio.Holding, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT h.id, h.account_id, h.instrument_id, a.name, a.currency, i.name, i.isin, i.ticker, i.instrument_type, i.asset_class,
			h.invested_minor, h.value_minor, h.tax_bps, h.planned_bps
		FROM holdings h
		JOIN accounts a ON a.id = h.account_id
		JOIN instruments i ON i.id = h.instrument_id
		ORDER BY h.value_minor DESC, i.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var holdings []portfolio.Holding
	totals := make(map[string]int64)
	for rows.Next() {
		var holding portfolio.Holding
		if err := rows.Scan(&holding.ID, &holding.AccountID, &holding.InstrumentID, &holding.AccountName, &holding.Currency, &holding.InstrumentName, &holding.InstrumentISIN, &holding.InstrumentTicker, &holding.InstrumentType, &holding.AssetClass, &holding.InvestedMinor, &holding.ValueMinor, &holding.TaxBPS, &holding.PlannedBPS); err != nil {
			return nil, err
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
	now := time.Now().UTC().Format(time.RFC3339)
	if holding.ID == 0 {
		return s.db.QueryRowContext(ctx, `
			INSERT INTO holdings (account_id, instrument_id, invested_minor, value_minor, tax_bps, planned_bps, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_id, instrument_id) DO UPDATE SET invested_minor=excluded.invested_minor,
				value_minor=excluded.value_minor, tax_bps=excluded.tax_bps, planned_bps=excluded.planned_bps, updated_at=excluded.updated_at
			RETURNING id`, holding.AccountID, holding.InstrumentID, holding.InvestedMinor, holding.ValueMinor, holding.TaxBPS, holding.PlannedBPS, now).Scan(&holding.ID)
	}
	result, err := s.db.ExecContext(ctx, `UPDATE holdings SET account_id=?, instrument_id=?, invested_minor=?, value_minor=?, tax_bps=?, planned_bps=?, updated_at=? WHERE id=?`, holding.AccountID, holding.InstrumentID, holding.InvestedMinor, holding.ValueMinor, holding.TaxBPS, holding.PlannedBPS, now, holding.ID)
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
