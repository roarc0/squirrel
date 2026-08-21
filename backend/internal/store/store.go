package store

import (
	"cmp"
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"loot/backend/internal/portfolio"

	_ "modernc.org/sqlite"
)

const schemaVersion = 9

//go:embed schema.sql
var schema string

//go:embed migration2.sql
var migration2 string

//go:embed migration3.sql
var migration3 string

//go:embed migration4.sql
var migration4 string

//go:embed migration5.sql
var migration5 string

//go:embed migration6.sql
var migration6 string

//go:embed migration7.sql
var migration7 string

//go:embed migration8.sql
var migration8 string

//go:embed migration9.sql
var migration9 string

type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("configure database: %w", err)
	}
	if err = migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	if path != ":memory:" {
		if err := os.Chmod(path, 0o600); err != nil {
			db.Close()
			return nil, fmt.Errorf("protect database: %w", err)
		}
	}
	return &Store{db: db}, nil
}

func migrate(db *sql.DB) error {
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if version > schemaVersion {
		return fmt.Errorf("database schema %d is newer than supported schema %d", version, schemaVersion)
	}
	if version == schemaVersion {
		return backfillInstrumentTypes(db)
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var migration string
	switch version {
	case 0:
		migration = schema
	case 1:
		migration = migration2 + "\n" + migration3 + "\n" + migration4 + "\n" + migration5 + "\n" + migration6 + "\n" + migration7 + "\n" + migration8 + "\n" + migration9
	case 2:
		migration = migration3 + "\n" + migration4 + "\n" + migration5 + "\n" + migration6 + "\n" + migration7 + "\n" + migration8 + "\n" + migration9
	case 3:
		migration = migration4 + "\n" + migration5 + "\n" + migration6 + "\n" + migration7 + "\n" + migration8 + "\n" + migration9
	case 4:
		migration = migration5 + "\n" + migration6 + "\n" + migration7 + "\n" + migration8 + "\n" + migration9
	case 5:
		migration = migration6 + "\n" + migration7 + "\n" + migration8 + "\n" + migration9
	case 6:
		migration = migration7 + "\n" + migration8 + "\n" + migration9
	case 7:
		migration = migration8 + "\n" + migration9
	case 8:
		migration = migration9
	}
	if _, err := tx.Exec(migration); err != nil {
		return fmt.Errorf("migrate schema from version %d: %w", version, err)
	}
	if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, schemaVersion)); err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return backfillInstrumentTypes(db)
}

func backfillInstrumentTypes(db *sql.DB) error {
	var hasName int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('instruments') WHERE name='name'`).Scan(&hasName); err != nil || hasName == 0 {
		return err
	}
	_, err := db.Exec(`
		UPDATE instruments SET instrument_type='etc' WHERE instrument_type='etf' AND upper(name) LIKE '% ETC%';
		UPDATE instruments SET instrument_type='etn' WHERE instrument_type='etf' AND upper(name) LIKE '% ETN%';
		UPDATE instruments SET asset_class='bond' WHERE asset_class IN ('', 'other') AND
			(lower(investment_focus) LIKE 'bond%' OR lower(name) LIKE '% bond%' OR lower(index_name) LIKE '% treasury%');
		UPDATE instruments SET asset_class='commodity' WHERE asset_class IN ('', 'other') AND
			(lower(investment_focus) LIKE 'commodit%' OR lower(investment_focus) LIKE 'precious metal%' OR lower(name) LIKE '% gold%' OR lower(name) LIKE '% silver%');`)
	return err
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) ListReferenceRates(ctx context.Context) ([]portfolio.ReferenceRate, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT code, label, rate_bps, observed_on, updated_at FROM reference_rates ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var rates []portfolio.ReferenceRate
	for rows.Next() {
		var rate portfolio.ReferenceRate
		if err := rows.Scan(&rate.Code, &rate.Label, &rate.RateBPS, &rate.ObservedOn, &rate.UpdatedAt); err != nil {
			return nil, err
		}
		rates = append(rates, rate)
	}
	return rates, rows.Err()
}

func (s *Store) SaveReferenceRate(ctx context.Context, rate portfolio.ReferenceRate) error {
	rate.Code = strings.ToUpper(strings.TrimSpace(rate.Code))
	rate.Label = strings.TrimSpace(rate.Label)
	if rate.Code == "" || rate.Label == "" {
		return errors.New("reference rate code and label are required")
	}
	if rate.RateBPS < -10_000 || rate.RateBPS > 100_000 {
		return errors.New("reference rate is outside the supported range")
	}
	if _, err := time.Parse(time.DateOnly, rate.ObservedOn); err != nil {
		return errors.New("observed_on must use YYYY-MM-DD")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO reference_rates (code, label, rate_bps, observed_on, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(code) DO UPDATE SET label=excluded.label, rate_bps=excluded.rate_bps,
		observed_on=excluded.observed_on, updated_at=excluded.updated_at`, rate.Code, rate.Label, rate.RateBPS, rate.ObservedOn, now)
	return err
}

func (s *Store) ListAccounts(ctx context.Context) ([]portfolio.Account, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, institution, account_type, preferred, archived, currency, balance_minor, tax_bps, annual_fee_minor FROM accounts ORDER BY archived, name, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var accounts []portfolio.Account
	byID := make(map[int64]int)
	for rows.Next() {
		var account portfolio.Account
		if err := rows.Scan(&account.ID, &account.Name, &account.Institution, &account.Type, &account.Preferred, &account.Archived, &account.Currency, &account.BalanceMinor, &account.TaxBPS, &account.AnnualFeeMinor); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
		byID[account.ID] = len(accounts) - 1
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	tiers, err := s.db.QueryContext(ctx, `SELECT id, account_id, up_to_minor, fixed_rate_bps, COALESCE(reference_code, ''), spread_bps FROM interest_tiers ORDER BY account_id, position`)
	if err != nil {
		return nil, err
	}
	defer tiers.Close()
	for tiers.Next() {
		var tier portfolio.InterestTier
		var accountID int64
		var upTo, fixed sql.NullInt64
		if err := tiers.Scan(&tier.ID, &accountID, &upTo, &fixed, &tier.ReferenceCode, &tier.SpreadBPS); err != nil {
			return nil, err
		}
		if upTo.Valid {
			tier.UpToMinor = &upTo.Int64
		}
		if fixed.Valid {
			tier.FixedRateBPS = &fixed.Int64
		}
		if index, ok := byID[accountID]; ok {
			accounts[index].Tiers = append(accounts[index].Tiers, tier)
		}
	}
	return accounts, tiers.Err()
}

func (s *Store) SaveAccount(ctx context.Context, account *portfolio.Account) error {
	account.Name = strings.TrimSpace(account.Name)
	account.Institution = strings.TrimSpace(account.Institution)
	account.Currency = strings.ToUpper(strings.TrimSpace(account.Currency))
	account.Type = strings.ToLower(strings.TrimSpace(account.Type))
	if account.Type == "" {
		account.Type = portfolio.AccountTypeOther
	}
	for i := range account.Tiers {
		account.Tiers[i].ReferenceCode = strings.ToUpper(strings.TrimSpace(account.Tiers[i].ReferenceCode))
	}
	if err := portfolio.ValidateAccount(*account); err != nil {
		return err
	}
	if account.Archived {
		account.Preferred = false
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var preferredCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM accounts WHERE preferred=1 AND archived=0 AND id<>?`, account.ID).Scan(&preferredCount); err != nil {
		return err
	}
	if !account.Archived && (account.Preferred || preferredCount == 0) {
		account.Preferred = true
		if _, err := tx.ExecContext(ctx, `UPDATE accounts SET preferred=0 WHERE id<>?`, account.ID); err != nil {
			return err
		}
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if account.ID == 0 {
		result, err := tx.ExecContext(ctx, `INSERT INTO accounts (name, institution, account_type, preferred, archived, currency, balance_minor, tax_bps, annual_fee_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, account.Name, account.Institution, account.Type, account.Preferred, account.Archived, account.Currency, account.BalanceMinor, account.TaxBPS, account.AnnualFeeMinor, now, now)
		if err != nil {
			return err
		}
		account.ID, err = result.LastInsertId()
		if err != nil {
			return err
		}
	} else {
		result, err := tx.ExecContext(ctx, `UPDATE accounts SET name=?, institution=?, account_type=?, preferred=?, archived=?, currency=?, balance_minor=?, tax_bps=?, annual_fee_minor=?, updated_at=? WHERE id=?`, account.Name, account.Institution, account.Type, account.Preferred, account.Archived, account.Currency, account.BalanceMinor, account.TaxBPS, account.AnnualFeeMinor, now, account.ID)
		if err != nil {
			return err
		}
		if changed, _ := result.RowsAffected(); changed == 0 {
			return errors.New("account not found")
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM interest_tiers WHERE account_id=?`, account.ID); err != nil {
			return err
		}
	}
	for position, tier := range account.Tiers {
		if _, err := tx.ExecContext(ctx, `INSERT INTO interest_tiers (account_id, position, up_to_minor, fixed_rate_bps, reference_code, spread_bps) VALUES (?, ?, ?, ?, NULLIF(?, ''), ?)`, account.ID, position, tier.UpToMinor, tier.FixedRateBPS, tier.ReferenceCode, tier.SpreadBPS); err != nil {
			return fmt.Errorf("save tier %d: %w", position+1, err)
		}
	}
	if account.Archived {
		if _, err := tx.ExecContext(ctx, `UPDATE accounts SET preferred=1 WHERE id=(SELECT id FROM accounts WHERE archived=0 ORDER BY id LIMIT 1) AND NOT EXISTS (SELECT 1 FROM accounts WHERE preferred=1 AND archived=0)`); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) DeleteAccount(ctx context.Context, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var preferred bool
	if err := tx.QueryRowContext(ctx, `SELECT preferred FROM accounts WHERE id=?`, id).Scan(&preferred); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("account not found")
		}
		return err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM accounts WHERE id=?`, id)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return errors.New("account not found")
	}
	if preferred {
		if _, err := tx.ExecContext(ctx, `UPDATE accounts SET preferred=1 WHERE id=(SELECT id FROM accounts WHERE archived=0 ORDER BY id LIMIT 1)`); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListInstruments(ctx context.Context) ([]portfolio.Instrument, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, isin, name, ticker, instrument_type, provider, index_name, investment_focus, asset_class, strategy, currency_hedged, starred, data_status, distribution, replication, domicile, fund_currency, ter_bps, fund_size_million, inception_date, tracking_difference_bps, tracking_error_bps, ucits, source_url, refreshed_at, enriched_at FROM instruments ORDER BY starred DESC, fund_size_million DESC, name, isin`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var instruments []portfolio.Instrument
	for rows.Next() {
		var instrument portfolio.Instrument
		var trackingDifference, trackingError sql.NullInt64
		if err := rows.Scan(&instrument.ID, &instrument.ISIN, &instrument.Name, &instrument.Ticker, &instrument.InstrumentType, &instrument.Provider, &instrument.IndexName, &instrument.InvestmentFocus, &instrument.AssetClass, &instrument.Strategy, &instrument.CurrencyHedged, &instrument.Starred, &instrument.DataStatus, &instrument.Distribution, &instrument.Replication, &instrument.Domicile, &instrument.FundCurrency, &instrument.TERBPS, &instrument.FundSizeMillion, &instrument.InceptionDate, &trackingDifference, &trackingError, &instrument.UCITS, &instrument.SourceURL, &instrument.RefreshedAt, &instrument.EnrichedAt); err != nil {
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
	return s.db.QueryRowContext(ctx, `
		INSERT INTO instruments (isin, name, ticker, instrument_type, provider, index_name, investment_focus, asset_class, strategy, currency_hedged, starred, data_status, distribution, replication, domicile, fund_currency, ter_bps, fund_size_million, inception_date, tracking_difference_bps, tracking_error_bps, ucits, source_url, refreshed_at, enriched_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(isin) DO UPDATE SET name=excluded.name, ticker=excluded.ticker,
		instrument_type=CASE WHEN instruments.data_status='enriched' AND excluded.data_status='catalog' THEN instruments.instrument_type ELSE excluded.instrument_type END,
		provider=CASE WHEN instruments.data_status='enriched' AND excluded.data_status='catalog' THEN instruments.provider ELSE excluded.provider END,
		index_name=CASE WHEN instruments.data_status='enriched' AND excluded.data_status='catalog' THEN instruments.index_name ELSE excluded.index_name END,
		investment_focus=CASE WHEN instruments.data_status='enriched' AND excluded.data_status='catalog' THEN instruments.investment_focus ELSE excluded.investment_focus END,
		asset_class=CASE WHEN instruments.data_status='enriched' AND excluded.data_status='catalog' THEN instruments.asset_class ELSE excluded.asset_class END,
		strategy=CASE WHEN instruments.data_status='enriched' AND excluded.data_status='catalog' THEN instruments.strategy ELSE excluded.strategy END,
		currency_hedged=CASE WHEN instruments.data_status='enriched' AND excluded.data_status='catalog' THEN instruments.currency_hedged ELSE excluded.currency_hedged END,
		data_status=CASE WHEN instruments.data_status='enriched' AND excluded.data_status='catalog' THEN instruments.data_status ELSE excluded.data_status END,
		distribution=excluded.distribution, replication=excluded.replication,
		domicile=excluded.domicile, fund_currency=excluded.fund_currency, ter_bps=excluded.ter_bps,
		fund_size_million=excluded.fund_size_million, inception_date=excluded.inception_date,
		tracking_difference_bps=CASE WHEN instruments.data_status='enriched' AND excluded.data_status='catalog' THEN instruments.tracking_difference_bps ELSE excluded.tracking_difference_bps END,
		tracking_error_bps=CASE WHEN instruments.data_status='enriched' AND excluded.data_status='catalog' THEN instruments.tracking_error_bps ELSE excluded.tracking_error_bps END, ucits=excluded.ucits,
		source_url=excluded.source_url, refreshed_at=excluded.refreshed_at,
		enriched_at=CASE WHEN excluded.enriched_at='' OR (instruments.data_status='enriched' AND excluded.data_status='catalog') THEN instruments.enriched_at ELSE excluded.enriched_at END,
		updated_at=excluded.updated_at
		RETURNING id, starred, enriched_at`, instrument.ISIN, instrument.Name, instrument.Ticker, instrument.InstrumentType, instrument.Provider, instrument.IndexName, instrument.InvestmentFocus, instrument.AssetClass, instrument.Strategy, instrument.CurrencyHedged, instrument.Starred, instrument.DataStatus, instrument.Distribution, instrument.Replication, instrument.Domicile, instrument.FundCurrency, instrument.TERBPS, instrument.FundSizeMillion, instrument.InceptionDate, instrument.TrackingDifferenceBPS, instrument.TrackingErrorBPS, instrument.UCITS, instrument.SourceURL, instrument.RefreshedAt, instrument.EnrichedAt, now, now).Scan(&instrument.ID, &instrument.Starred, &instrument.EnrichedAt)
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
	instruments, err := s.ListInstruments(ctx)
	if err != nil {
		return nil, err
	}
	result := instruments[:0]
	for _, instrument := range instruments {
		if (mode == "missing" && instrument.DataStatus == portfolio.InstrumentStatusCatalog) || (mode == "oldest" && instrument.DataStatus == portfolio.InstrumentStatusEnriched) {
			result = append(result, instrument)
		}
	}
	if mode != "missing" && mode != "oldest" {
		return nil, errors.New("enrichment mode must be missing or oldest")
	}
	if mode == "oldest" {
		slices.SortStableFunc(result, func(a, b portfolio.Instrument) int {
			if value := cmp.Compare(a.EnrichedAt, b.EnrichedAt); value != 0 {
				return value
			}
			return strings.Compare(a.ISIN, b.ISIN)
		})
	}
	return result, nil
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

func (s *Store) UpdateSnapshot(ctx context.Context, snapshot portfolio.Snapshot) error {
	snapshot.Currency = strings.ToUpper(strings.TrimSpace(snapshot.Currency))
	if snapshot.ID <= 0 {
		return errors.New("snapshot is required")
	}
	if err := portfolio.ValidateSnapshot(snapshot); err != nil {
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
