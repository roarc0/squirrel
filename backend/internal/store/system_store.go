package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const backupVersion = 1

// UserBackup is the JSON schema for portable, user-scoped backups.
type UserBackup struct {
	Version    int             `json:"version"`
	App        string          `json:"app"`
	ExportedAt string          `json:"exported_at"`
	Accounts   []BackupAccount `json:"accounts"`
	Snapshots  []BackupSnapshot `json:"snapshots"`
	Profile    *BackupProfile  `json:"profile,omitempty"`
}

type BackupAccount struct {
	Name           string          `json:"name"`
	Institution    string          `json:"institution"`
	AccountType    string          `json:"account_type"`
	Preferred      bool            `json:"preferred"`
	Archived       bool            `json:"archived"`
	Currency       string          `json:"currency"`
	BalanceMinor   int64           `json:"balance_minor"`
	TaxBps         int             `json:"tax_bps"`
	AnnualFeeMinor int64           `json:"annual_fee_minor"`
	PacAmountMinor int64           `json:"pac_amount_minor"`
	Notes          string          `json:"notes"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
	InterestTiers  []BackupTier    `json:"interest_tiers,omitempty"`
	Holdings       []BackupHolding `json:"holdings,omitempty"`
}

type BackupTier struct {
	Position      int     `json:"position"`
	UpToMinor     *int64  `json:"up_to_minor,omitempty"`
	FixedRateBps  *int    `json:"fixed_rate_bps,omitempty"`
	ReferenceCode *string `json:"reference_code,omitempty"`
	SpreadBps     int     `json:"spread_bps"`
}

type BackupHolding struct {
	InstrumentISIN string `json:"instrument_isin"`
	InvestedMinor  int64  `json:"invested_minor"`
	ValueMinor     int64  `json:"value_minor"`
	TaxBps         int    `json:"tax_bps"`
	PlannedBps     int    `json:"planned_bps"`
	IsPac          bool   `json:"is_pac"`
	PacBps         int    `json:"pac_bps"`
	PacFrequency   string `json:"pac_frequency"`
	Notes          string `json:"notes"`
	UpdatedAt      string `json:"updated_at"`
}

type BackupSnapshot struct {
	ObservedOn string        `json:"observed_on"`
	CreatedAt  string        `json:"created_at"`
	Entries    []BackupEntry `json:"entries"`
}

type BackupEntry struct {
	AccountName   string `json:"account_name"`
	Currency      string `json:"currency"`
	Kind          string `json:"kind"`
	AssetKey      string `json:"asset_key"`
	AssetName     string `json:"asset_name"`
	InvestedMinor int64  `json:"invested_minor"`
	ValueMinor    int64  `json:"value_minor"`
	TaxBps        int    `json:"tax_bps"`
}

type BackupProfile struct {
	Theme                 string `json:"theme"`
	PreferredCurrency     string `json:"preferred_currency"`
	MonthlyExpensesMinor  int64  `json:"monthly_expenses_minor"`
	ReserveMonths         int32  `json:"reserve_months"`
	HideBalances          bool   `json:"hide_balances"`
	EmergencyGoalMinor    int64  `json:"emergency_goal_minor"`
	FireExpensesMinor     int64  `json:"fire_expenses_minor"`
	InstrumentColumnsJSON string `json:"instrument_columns_json"`
	ShowFireCalculator    bool   `json:"show_fire_calculator"`
	ActiveTab             string `json:"active_tab,omitempty"`
	AISettingsJSON        string `json:"ai_settings_json,omitempty"`
	DraftPortfoliosJSON   string `json:"draft_portfolios_json,omitempty"`
}

// ExportBackup exports only the authenticated user's data as JSON.
func (s *Store) ExportBackup(ctx context.Context, userID string) ([]byte, string, error) {
	backup := UserBackup{
		Version:    backupVersion,
		App:        "squirrel",
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
	}

	// Accounts
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, institution, account_type, preferred, archived, currency,
		       balance_minor, tax_bps, annual_fee_minor, pac_amount_minor, notes, created_at, updated_at
		FROM accounts WHERE user_id=? ORDER BY id`, userID)
	if err != nil {
		return nil, "", fmt.Errorf("query accounts: %w", err)
	}
	defer rows.Close()

	accountIDs := map[int64]*BackupAccount{}
	for rows.Next() {
		var id int64
		var a BackupAccount
		if err := rows.Scan(&id, &a.Name, &a.Institution, &a.AccountType, &a.Preferred, &a.Archived,
			&a.Currency, &a.BalanceMinor, &a.TaxBps, &a.AnnualFeeMinor, &a.PacAmountMinor,
			&a.Notes, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, "", fmt.Errorf("scan account: %w", err)
		}
		backup.Accounts = append(backup.Accounts, a)
		accountIDs[id] = &backup.Accounts[len(backup.Accounts)-1]
	}
	rows.Close()

	// Interest tiers per account
	if len(accountIDs) > 0 {
		tierRows, err := s.db.QueryContext(ctx, `
			SELECT account_id, position, up_to_minor, fixed_rate_bps, reference_code, spread_bps
			FROM interest_tiers
			WHERE account_id IN (SELECT id FROM accounts WHERE user_id=?)
			ORDER BY account_id, position`, userID)
		if err != nil {
			return nil, "", fmt.Errorf("query interest_tiers: %w", err)
		}
		defer tierRows.Close()
		for tierRows.Next() {
			var accountID int64
			var t BackupTier
			if err := tierRows.Scan(&accountID, &t.Position, &t.UpToMinor, &t.FixedRateBps, &t.ReferenceCode, &t.SpreadBps); err != nil {
				return nil, "", fmt.Errorf("scan tier: %w", err)
			}
			if acc, ok := accountIDs[accountID]; ok {
				acc.InterestTiers = append(acc.InterestTiers, t)
			}
		}
		tierRows.Close()

		// Holdings per account (with instrument ISIN)
		holdingRows, err := s.db.QueryContext(ctx, `
			SELECT h.account_id, i.isin, h.invested_minor, h.value_minor, h.tax_bps,
			       h.planned_bps, h.is_pac, h.pac_bps, h.pac_frequency, h.notes, h.updated_at
			FROM holdings h
			JOIN instruments i ON i.id = h.instrument_id
			WHERE h.account_id IN (SELECT id FROM accounts WHERE user_id=?)
			ORDER BY h.account_id`, userID)
		if err != nil {
			return nil, "", fmt.Errorf("query holdings: %w", err)
		}
		defer holdingRows.Close()
		for holdingRows.Next() {
			var accountID int64
			var h BackupHolding
			if err := holdingRows.Scan(&accountID, &h.InstrumentISIN, &h.InvestedMinor, &h.ValueMinor,
				&h.TaxBps, &h.PlannedBps, &h.IsPac, &h.PacBps, &h.PacFrequency, &h.Notes, &h.UpdatedAt); err != nil {
				return nil, "", fmt.Errorf("scan holding: %w", err)
			}
			if acc, ok := accountIDs[accountID]; ok {
				acc.Holdings = append(acc.Holdings, h)
			}
		}
		holdingRows.Close()
	}

	// Snapshots
	snapRows, err := s.db.QueryContext(ctx, `
		SELECT id, observed_on, created_at FROM snapshots WHERE user_id=? ORDER BY observed_on`, userID)
	if err != nil {
		return nil, "", fmt.Errorf("query snapshots: %w", err)
	}
	defer snapRows.Close()

	snapIDs := map[int64]*BackupSnapshot{}
	for snapRows.Next() {
		var id int64
		var sn BackupSnapshot
		if err := snapRows.Scan(&id, &sn.ObservedOn, &sn.CreatedAt); err != nil {
			return nil, "", fmt.Errorf("scan snapshot: %w", err)
		}
		backup.Snapshots = append(backup.Snapshots, sn)
		snapIDs[id] = &backup.Snapshots[len(backup.Snapshots)-1]
	}
	snapRows.Close()

	// Snapshot entries
	if len(snapIDs) > 0 {
		entryRows, err := s.db.QueryContext(ctx, `
			SELECT e.snapshot_id, e.account_name, e.currency, e.kind, e.asset_key,
			       e.asset_name, e.invested_minor, e.value_minor, e.tax_bps
			FROM snapshot_entries e
			WHERE e.snapshot_id IN (SELECT id FROM snapshots WHERE user_id=?)
			ORDER BY e.snapshot_id`, userID)
		if err != nil {
			return nil, "", fmt.Errorf("query snapshot_entries: %w", err)
		}
		defer entryRows.Close()
		for entryRows.Next() {
			var snapID int64
			var e BackupEntry
			if err := entryRows.Scan(&snapID, &e.AccountName, &e.Currency, &e.Kind, &e.AssetKey,
				&e.AssetName, &e.InvestedMinor, &e.ValueMinor, &e.TaxBps); err != nil {
				return nil, "", fmt.Errorf("scan snapshot entry: %w", err)
			}
			if sn, ok := snapIDs[snapID]; ok {
				sn.Entries = append(sn.Entries, e)
			}
		}
		entryRows.Close()
	}

	// Profile
	var p BackupProfile
	err = s.db.QueryRowContext(ctx, `
		SELECT theme, preferred_currency, monthly_expenses_minor, reserve_months,
		       hide_balances, emergency_goal_minor, fire_expenses_minor,
		       instrument_columns_json, show_fire_calculator
		FROM user_profiles WHERE user_id=?`, userID).Scan(
		&p.Theme, &p.PreferredCurrency, &p.MonthlyExpensesMinor, &p.ReserveMonths,
		&p.HideBalances, &p.EmergencyGoalMinor, &p.FireExpensesMinor,
		&p.InstrumentColumnsJSON, &p.ShowFireCalculator)
	if err == nil {
		backup.Profile = &p
	}

	data, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		return nil, "", fmt.Errorf("marshal backup: %w", err)
	}

	filename := fmt.Sprintf("squirrel-backup-%s.json", time.Now().UTC().Format("2006-01-02"))
	return data, filename, nil
}

// RestoreBackup replaces the authenticated user's data with the contents of a backup.
// Instruments referenced by holdings must already exist in the database.
func (s *Store) RestoreBackup(ctx context.Context, userID string, backupData []byte) error {
	if userID == "" {
		return errors.New("user_id required to restore backup")
	}
	if len(backupData) == 0 {
		return errors.New("backup data is empty")
	}

	var backup UserBackup
	if err := json.Unmarshal(backupData, &backup); err != nil {
		return errors.New("invalid backup: not valid JSON")
	}
	if backup.App != "" && backup.App != "squirrel" {
		return fmt.Errorf("backup belongs to unknown application %q", backup.App)
	}
	if backup.Version > backupVersion {
		return fmt.Errorf("backup version %d is newer than supported version %d", backup.Version, backupVersion)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Delete all existing user data (cascade handles child rows).
	if _, err := tx.ExecContext(ctx, `DELETE FROM snapshots WHERE user_id=?`, userID); err != nil {
		return fmt.Errorf("delete snapshots: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM accounts WHERE user_id=?`, userID); err != nil {
		return fmt.Errorf("delete accounts: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_profiles WHERE user_id=?`, userID); err != nil {
		return fmt.Errorf("delete profile: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)

	// Insert accounts with nested tiers and holdings.
	for _, a := range backup.Accounts {
		createdAt := a.CreatedAt
		if createdAt == "" {
			createdAt = now
		}
		updatedAt := a.UpdatedAt
		if updatedAt == "" {
			updatedAt = now
		}
		preferred := 0
		if a.Preferred {
			preferred = 1
		}
		archived := 0
		if a.Archived {
			archived = 1
		}

		var accountID int64
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO accounts (user_id, name, institution, account_type, preferred, archived,
			                      currency, balance_minor, tax_bps, annual_fee_minor, pac_amount_minor,
			                      notes, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
			userID, a.Name, a.Institution, a.AccountType, preferred, archived,
			a.Currency, a.BalanceMinor, a.TaxBps, a.AnnualFeeMinor, a.PacAmountMinor,
			a.Notes, createdAt, updatedAt).Scan(&accountID); err != nil {
			return fmt.Errorf("insert account %q: %w", a.Name, err)
		}

		for _, t := range a.InterestTiers {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO interest_tiers (account_id, position, up_to_minor, fixed_rate_bps, reference_code, spread_bps)
				VALUES (?, ?, ?, ?, ?, ?)`,
				accountID, t.Position, t.UpToMinor, t.FixedRateBps, t.ReferenceCode, t.SpreadBps); err != nil {
				return fmt.Errorf("insert tier for account %q: %w", a.Name, err)
			}
		}

		for _, h := range a.Holdings {
			var instrumentID int64
			if err := tx.QueryRowContext(ctx, `SELECT id FROM instruments WHERE isin=?`, h.InstrumentISIN).Scan(&instrumentID); err != nil {
				// Skip holdings whose instrument isn't in this database's catalog.
				continue
			}
			isPac := 0
			if h.IsPac {
				isPac = 1
			}
			updatedAt := h.UpdatedAt
			if updatedAt == "" {
				updatedAt = now
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO holdings (account_id, instrument_id, invested_minor, value_minor, tax_bps,
				                      planned_bps, is_pac, pac_bps, pac_frequency, notes, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				accountID, instrumentID, h.InvestedMinor, h.ValueMinor, h.TaxBps,
				h.PlannedBps, isPac, h.PacBps, h.PacFrequency, h.Notes, updatedAt); err != nil {
				return fmt.Errorf("insert holding %s for account %q: %w", h.InstrumentISIN, a.Name, err)
			}
		}
	}

	// Insert snapshots with entries.
	for _, sn := range backup.Snapshots {
		createdAt := sn.CreatedAt
		if createdAt == "" {
			createdAt = now
		}
		var snapshotID int64
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO snapshots (user_id, observed_on, created_at) VALUES (?, ?, ?) RETURNING id`,
			userID, sn.ObservedOn, createdAt).Scan(&snapshotID); err != nil {
			return fmt.Errorf("insert snapshot %s: %w", sn.ObservedOn, err)
		}
		for _, e := range sn.Entries {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO snapshot_entries (snapshot_id, account_name, currency, kind, asset_key,
				                              asset_name, invested_minor, value_minor, tax_bps)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				snapshotID, e.AccountName, e.Currency, e.Kind, e.AssetKey,
				e.AssetName, e.InvestedMinor, e.ValueMinor, e.TaxBps); err != nil {
				return fmt.Errorf("insert snapshot entry: %w", err)
			}
		}
	}

	// Upsert profile.
	if backup.Profile != nil {
		p := backup.Profile
		hideBalances := 0
		if p.HideBalances {
			hideBalances = 1
		}
		showFire := 0
		if p.ShowFireCalculator {
			showFire = 1
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_profiles (user_id, theme, preferred_currency, monthly_expenses_minor,
			                           reserve_months, hide_balances, emergency_goal_minor,
			                           fire_expenses_minor, instrument_columns_json, show_fire_calculator)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET
			  theme=excluded.theme, preferred_currency=excluded.preferred_currency,
			  monthly_expenses_minor=excluded.monthly_expenses_minor, reserve_months=excluded.reserve_months,
			  hide_balances=excluded.hide_balances, emergency_goal_minor=excluded.emergency_goal_minor,
			  fire_expenses_minor=excluded.fire_expenses_minor,
			  instrument_columns_json=excluded.instrument_columns_json,
			  show_fire_calculator=excluded.show_fire_calculator`,
			userID, p.Theme, p.PreferredCurrency, p.MonthlyExpensesMinor, p.ReserveMonths,
			hideBalances, p.EmergencyGoalMinor, p.FireExpensesMinor, p.InstrumentColumnsJSON, showFire); err != nil {
			return fmt.Errorf("upsert profile: %w", err)
		}
	}

	return tx.Commit()
}
