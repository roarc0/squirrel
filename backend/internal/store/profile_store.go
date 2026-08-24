package store

import (
	"context"
	"database/sql"
	"errors"
)

type UserProfile struct {
	Theme                 string
	PreferredCurrency     string
	MonthlyExpensesMinor  int64
	ReserveMonths         int32
	HideBalances          bool
	EmergencyGoalMinor    int64
	FireExpensesMinor     int64
	InstrumentColumnsJSON string
	ShowFireCalculator    bool
}

func ensureUserProfilesTable(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS user_profiles (
		user_id TEXT PRIMARY KEY,
		theme TEXT NOT NULL DEFAULT '',
		preferred_currency TEXT NOT NULL DEFAULT '',
		monthly_expenses_minor INTEGER NOT NULL DEFAULT 0,
		reserve_months INTEGER NOT NULL DEFAULT 6,
		hide_balances INTEGER NOT NULL DEFAULT 0,
		emergency_goal_minor INTEGER NOT NULL DEFAULT 1000000,
		fire_expenses_minor INTEGER NOT NULL DEFAULT 2400000,
		instrument_columns_json TEXT NOT NULL DEFAULT '',
		show_fire_calculator INTEGER NOT NULL DEFAULT 0
	)`)
	if err != nil {
		return err
	}
	// Add columns if upgrading from older schema
	for _, col := range []struct{ name, def string }{
		{"monthly_expenses_minor", "INTEGER NOT NULL DEFAULT 0"},
		{"reserve_months", "INTEGER NOT NULL DEFAULT 6"},
		{"hide_balances", "INTEGER NOT NULL DEFAULT 0"},
		{"emergency_goal_minor", "INTEGER NOT NULL DEFAULT 1000000"},
		{"fire_expenses_minor", "INTEGER NOT NULL DEFAULT 2400000"},
		{"instrument_columns_json", "TEXT NOT NULL DEFAULT ''"},
		{"show_fire_calculator", "INTEGER NOT NULL DEFAULT 0"},
	} {
		var has int
		if db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('user_profiles') WHERE name=?`, col.name).Scan(&has); has == 0 {
			db.Exec(`ALTER TABLE user_profiles ADD COLUMN ` + col.name + ` ` + col.def)
		}
	}
	return nil
}

func (s *Store) GetProfile(ctx context.Context, userID string) (UserProfile, error) {
	if userID == "" {
		return UserProfile{ReserveMonths: 6}, nil
	}
	var p UserProfile
	err := s.db.QueryRowContext(ctx,
		`SELECT theme, preferred_currency, monthly_expenses_minor, reserve_months, hide_balances, emergency_goal_minor, fire_expenses_minor, instrument_columns_json, show_fire_calculator FROM user_profiles WHERE user_id = ?`, userID,
	).Scan(&p.Theme, &p.PreferredCurrency, &p.MonthlyExpensesMinor, &p.ReserveMonths, &p.HideBalances, &p.EmergencyGoalMinor, &p.FireExpensesMinor, &p.InstrumentColumnsJSON, &p.ShowFireCalculator)
	if errors.Is(err, sql.ErrNoRows) {
		return UserProfile{ReserveMonths: 6}, nil
	}
	return p, err
}

func (s *Store) SaveProfile(ctx context.Context, userID string, p UserProfile) error {
	if userID == "" {
		return errors.New("user_id required")
	}
	if p.ReserveMonths == 0 {
		p.ReserveMonths = 6
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO user_profiles (user_id, theme, preferred_currency, monthly_expenses_minor, reserve_months, hide_balances, emergency_goal_minor, fire_expenses_minor, instrument_columns_json, show_fire_calculator)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET
		   theme=excluded.theme,
		   preferred_currency=excluded.preferred_currency,
		   monthly_expenses_minor=excluded.monthly_expenses_minor,
		   reserve_months=excluded.reserve_months,
		   hide_balances=excluded.hide_balances,
		   emergency_goal_minor=excluded.emergency_goal_minor,
		   fire_expenses_minor=excluded.fire_expenses_minor,
		   instrument_columns_json=excluded.instrument_columns_json,
		   show_fire_calculator=excluded.show_fire_calculator`,
		userID, p.Theme, p.PreferredCurrency, p.MonthlyExpensesMinor, p.ReserveMonths, p.HideBalances, p.EmergencyGoalMinor, p.FireExpensesMinor, p.InstrumentColumnsJSON, p.ShowFireCalculator,
	)
	return err
}
