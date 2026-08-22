package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"loot/backend/internal/portfolio"
)

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
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, institution, account_type, preferred, archived, currency, balance_minor, tax_bps, annual_fee_minor, pac_amount_minor, COALESCE(notes, '') FROM accounts ORDER BY archived, name, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var accounts []portfolio.Account
	byID := make(map[int64]int)
	for rows.Next() {
		var account portfolio.Account
		if err := rows.Scan(&account.ID, &account.Name, &account.Institution, &account.Type, &account.Preferred, &account.Archived, &account.Currency, &account.BalanceMinor, &account.TaxBPS, &account.AnnualFeeMinor, &account.PACAmountMinor, &account.Notes); err != nil {
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
		result, err := tx.ExecContext(ctx, `INSERT INTO accounts (name, institution, account_type, preferred, archived, currency, balance_minor, tax_bps, annual_fee_minor, pac_amount_minor, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, account.Name, account.Institution, account.Type, account.Preferred, account.Archived, account.Currency, account.BalanceMinor, account.TaxBPS, account.AnnualFeeMinor, account.PACAmountMinor, account.Notes, now, now)
		if err != nil {
			return err
		}
		account.ID, err = result.LastInsertId()
		if err != nil {
			return err
		}
	} else {
		result, err := tx.ExecContext(ctx, `UPDATE accounts SET name=?, institution=?, account_type=?, preferred=?, archived=?, currency=?, balance_minor=?, tax_bps=?, annual_fee_minor=?, pac_amount_minor=?, notes=?, updated_at=? WHERE id=?`, account.Name, account.Institution, account.Type, account.Preferred, account.Archived, account.Currency, account.BalanceMinor, account.TaxBPS, account.AnnualFeeMinor, account.PACAmountMinor, account.Notes, now, account.ID)
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
