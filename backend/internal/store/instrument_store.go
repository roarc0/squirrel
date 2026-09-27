package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

var ErrNotFound = errors.New("record not found")

func (s *Store) ListInstruments(ctx context.Context) ([]portfolio.Instrument, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, isin, name, ticker, instrument_type, provider, index_name, investment_focus, asset_class, strategy, currency_hedged, starred, data_status, distribution, replication, domicile, fund_currency, ter_bps, fund_size_million, inception_date, tracking_difference_bps, tracking_error_bps, ucits, source_url, refreshed_at FROM instruments ORDER BY starred DESC, fund_size_million DESC, name, isin`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var instruments []portfolio.Instrument
	for rows.Next() {
		var instrument portfolio.Instrument
		var trackingDifference, trackingError sql.NullInt64
		if err := rows.Scan(&instrument.ID, &instrument.ISIN, &instrument.Name, &instrument.Ticker, &instrument.InstrumentType, &instrument.Provider, &instrument.IndexName, &instrument.InvestmentFocus, &instrument.AssetClass, &instrument.Strategy, &instrument.CurrencyHedged, &instrument.Starred, &instrument.DataStatus, &instrument.Distribution, &instrument.Replication, &instrument.Domicile, &instrument.FundCurrency, &instrument.TERBPS, &instrument.FundSizeMillion, &instrument.InceptionDate, &trackingDifference, &trackingError, &instrument.UCITS, &instrument.SourceURL, &instrument.RefreshedAt); err != nil {
			return nil, err
		}
		if trackingDifference.Valid {
			instrument.TrackingDifferenceBPS = &trackingDifference.Int64
		}
		if trackingError.Valid {
			instrument.TrackingErrorBPS = &trackingError.Int64
		}
		if inferred := portfolio.InferInstrumentType(instrument.Name); instrument.InstrumentType == portfolio.InstrumentTypeETF && inferred != portfolio.InstrumentTypeETF {
			instrument.InstrumentType = inferred
		}
		instruments = append(instruments, instrument)
	}
	return instruments, rows.Err()
}

func (s *Store) GetInstrumentByID(ctx context.Context, id int64) (portfolio.Instrument, error) {
	instruments, err := s.ListInstruments(ctx)
	if err != nil {
		return portfolio.Instrument{}, err
	}
	for _, inst := range instruments {
		if inst.ID == id {
			return inst, nil
		}
	}
	return portfolio.Instrument{}, ErrNotFound
}

func (s *Store) GetInstrumentByISIN(ctx context.Context, isin string) (portfolio.Instrument, error) {
	isin = strings.ToUpper(strings.TrimSpace(isin))
	instruments, err := s.ListInstruments(ctx)
	if err != nil {
		return portfolio.Instrument{}, err
	}
	for _, inst := range instruments {
		if inst.ISIN == isin {
			return inst, nil
		}
	}
	return portfolio.Instrument{}, ErrNotFound
}

func (s *Store) SaveInstrument(ctx context.Context, instrument *portfolio.Instrument) error {
	instrument.ISIN = strings.ToUpper(strings.TrimSpace(instrument.ISIN))
	instrument.Name = strings.TrimSpace(instrument.Name)
	instrument.Ticker = strings.ToUpper(strings.TrimSpace(instrument.Ticker))
	instrument.InstrumentType = strings.ToLower(strings.TrimSpace(instrument.InstrumentType))
	if instrument.InstrumentType == "" {
		instrument.InstrumentType = portfolio.InferInstrumentType(instrument.Name)
	}
	instrument.Domicile = strings.ToUpper(strings.TrimSpace(instrument.Domicile))
	instrument.FundCurrency = strings.ToUpper(strings.TrimSpace(instrument.FundCurrency))
	if instrument.DataStatus == "" {
		instrument.DataStatus = portfolio.InstrumentStatusEnriched
	}
	if err := portfolio.ValidateInstrument(*instrument); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if instrument.RefreshedAt == "" {
		instrument.RefreshedAt = now
	}
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO instruments (isin, name, ticker, instrument_type, provider, index_name, investment_focus, asset_class, strategy, currency_hedged, starred, data_status, distribution, replication, domicile, fund_currency, ter_bps, fund_size_million, inception_date, tracking_difference_bps, tracking_error_bps, ucits, source_url, refreshed_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(isin) DO UPDATE SET name=excluded.name, ticker=excluded.ticker,
		instrument_type=excluded.instrument_type,
		provider=excluded.provider,
		index_name=excluded.index_name,
		investment_focus=excluded.investment_focus,
		asset_class=excluded.asset_class,
		strategy=excluded.strategy,
		currency_hedged=excluded.currency_hedged,
		data_status=excluded.data_status,
		distribution=excluded.distribution, replication=excluded.replication,
		domicile=excluded.domicile, fund_currency=excluded.fund_currency, ter_bps=excluded.ter_bps,
		fund_size_million=excluded.fund_size_million, inception_date=excluded.inception_date,
		tracking_difference_bps=excluded.tracking_difference_bps,
		tracking_error_bps=excluded.tracking_error_bps, ucits=excluded.ucits,
		source_url=excluded.source_url,
		refreshed_at=excluded.refreshed_at,
		updated_at=excluded.updated_at
		WHERE instruments.data_status <> 'enriched' OR excluded.data_status <> 'catalog'
		RETURNING id, starred`, instrument.ISIN, instrument.Name, instrument.Ticker, instrument.InstrumentType, instrument.Provider, instrument.IndexName, instrument.InvestmentFocus, instrument.AssetClass, instrument.Strategy, instrument.CurrencyHedged, instrument.Starred, instrument.DataStatus, instrument.Distribution, instrument.Replication, instrument.Domicile, instrument.FundCurrency, instrument.TERBPS, instrument.FundSizeMillion, instrument.InceptionDate, instrument.TrackingDifferenceBPS, instrument.TrackingErrorBPS, instrument.UCITS, instrument.SourceURL, instrument.RefreshedAt, now, now).Scan(&instrument.ID, &instrument.Starred)
	if errors.Is(err, sql.ErrNoRows) {
		stored, readErr := s.GetInstrumentByISIN(ctx, instrument.ISIN)
		if readErr != nil {
			return readErr
		}
		*instrument = stored
		return nil
	}
	return err
}

func (s *Store) SaveInstrumentCatalogBatch(ctx context.Context, instruments []portfolio.Instrument) (int, error) {
	if len(instruments) == 0 {
		return 0, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	now := time.Now().UTC().Format(time.RFC3339)
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO instruments (isin, name, ticker, instrument_type, provider, index_name, investment_focus, asset_class, strategy, currency_hedged, starred, data_status, distribution, replication, domicile, fund_currency, ter_bps, fund_size_million, inception_date, tracking_difference_bps, tracking_error_bps, ucits, source_url, refreshed_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(isin) DO UPDATE SET name=excluded.name, ticker=excluded.ticker,
		instrument_type=excluded.instrument_type,
		distribution=excluded.distribution, replication=excluded.replication,
		domicile=excluded.domicile, fund_currency=excluded.fund_currency, ter_bps=excluded.ter_bps,
		fund_size_million=excluded.fund_size_million, inception_date=excluded.inception_date,
		ucits=excluded.ucits, source_url=excluded.source_url,
		refreshed_at=excluded.refreshed_at,
		updated_at=excluded.updated_at WHERE instruments.data_status <> 'enriched'`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()
	var saved int
	for i := range instruments {
		inst := &instruments[i]
		inst.ISIN = strings.ToUpper(strings.TrimSpace(inst.ISIN))
		inst.Name = strings.TrimSpace(inst.Name)
		inst.Ticker = strings.ToUpper(strings.TrimSpace(inst.Ticker))
		inst.InstrumentType = strings.ToLower(strings.TrimSpace(inst.InstrumentType))
		if inst.InstrumentType == "" {
			inst.InstrumentType = portfolio.InferInstrumentType(inst.Name)
		}
		inst.Domicile = strings.ToUpper(strings.TrimSpace(inst.Domicile))
		inst.FundCurrency = strings.ToUpper(strings.TrimSpace(inst.FundCurrency))
		inst.DataStatus = portfolio.InstrumentStatusCatalog
		if err := portfolio.ValidateInstrument(*inst); err != nil {
			continue
		}
		if _, err := stmt.ExecContext(ctx, inst.ISIN, inst.Name, inst.Ticker, inst.InstrumentType, inst.Provider, inst.IndexName, inst.InvestmentFocus, inst.AssetClass, inst.Strategy, inst.CurrencyHedged, inst.Starred, inst.DataStatus, inst.Distribution, inst.Replication, inst.Domicile, inst.FundCurrency, inst.TERBPS, inst.FundSizeMillion, inst.InceptionDate, inst.TrackingDifferenceBPS, inst.TrackingErrorBPS, inst.UCITS, inst.SourceURL, now, now, now); err != nil {
			return 0, err
		}
		saved++
	}
	return saved, tx.Commit()
}

func (s *Store) SetInstrumentStarred(ctx context.Context, isin string, starred bool) error {
	isin = strings.ToUpper(strings.TrimSpace(isin))
	if !portfolio.ValidISIN(isin) {
		return errors.New("ISIN is invalid")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE instruments SET starred=?, updated_at=? WHERE isin=?`, starred, time.Now().UTC().Format(time.RFC3339), isin)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return errors.New("instrument not found")
	}
	return nil
}

func (s *Store) ListInstrumentExclusions(ctx context.Context) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT isin FROM instrument_exclusions`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]bool)
	for rows.Next() {
		var isin string
		if err := rows.Scan(&isin); err != nil {
			return nil, err
		}
		result[isin] = true
	}
	return result, rows.Err()
}

func (s *Store) SaveInstrumentExclusion(ctx context.Context, isin, reason string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO instrument_exclusions (isin, reason, checked_at) VALUES (?, ?, ?)
		ON CONFLICT(isin) DO UPDATE SET reason=excluded.reason, checked_at=excluded.checked_at`,
		strings.ToUpper(strings.TrimSpace(isin)), reason, time.Now().UTC().Format(time.RFC3339))
	return err
}

func (s *Store) ListInstrumentsToEnrich(ctx context.Context, limit int) ([]portfolio.Instrument, error) {
	if limit < 1 || limit > 50 {
		return nil, errors.New("enrichment limit must be between 1 and 50")
	}
	instruments, err := s.ListInstrumentsForEnrichment(ctx, "missing")
	if err != nil {
		return nil, err
	}
	if len(instruments) > limit {
		instruments = instruments[:limit]
	}
	return instruments, nil
}

func (s *Store) ListInstrumentsForEnrichment(ctx context.Context, mode string) ([]portfolio.Instrument, error) {
	if mode != "missing" && mode != "oldest" && mode != "discover" {
		return nil, errors.New("enrichment mode must be missing, discover, or oldest")
	}
	instruments, err := s.ListInstruments(ctx)
	if err != nil {
		return nil, err
	}
	byISIN := make(map[string]portfolio.Instrument, len(instruments))
	for _, instrument := range instruments {
		byISIN[instrument.ISIN] = instrument
	}
	// Failed attempts stay pending, but cool down so another product can progress.
	// Catalog sync timestamps never take priority over missing profile data.
	rows, err := s.db.QueryContext(ctx, `SELECT isin FROM instruments
		WHERE (? = 'oldest' OR data_status = 'catalog')
		AND (last_refresh_attempt_at = '' OR julianday(last_refresh_attempt_at) <= julianday('now', '-5 minutes'))
		ORDER BY (data_status = 'catalog') DESC, last_refresh_attempt_at, refreshed_at, isin`, mode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []portfolio.Instrument
	for rows.Next() {
		var isin string
		if err := rows.Scan(&isin); err != nil {
			return nil, err
		}
		if instrument, ok := byISIN[isin]; ok {
			result = append(result, instrument)
		}
	}
	return result, rows.Err()
}

func (s *Store) RecordInstrumentRefreshAttempt(ctx context.Context, isin string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE instruments SET last_refresh_attempt_at=? WHERE isin=?`, time.Now().UTC().Format(time.RFC3339), isin)
	return err
}

func (s *Store) CountRefreshedToday(ctx context.Context) (int32, error) {
	var count int32
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM instruments WHERE data_status='enriched' AND julianday(refreshed_at) >= julianday('now', '-24 hours')`).Scan(&count)
	return count, err
}

func (s *Store) NextInstrumentToRefresh(ctx context.Context) (*portfolio.Instrument, error) {
	instruments, err := s.ListInstrumentsForEnrichment(ctx, "oldest")
	if err != nil || len(instruments) == 0 {
		return nil, err
	}
	return &instruments[0], nil
}

func (s *Store) DeleteInstrument(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM instruments WHERE id=?`, id)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return errors.New("instrument not found")
	}
	return nil
}
