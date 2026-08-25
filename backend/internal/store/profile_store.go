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
	EnableBtpRanks        bool
	ActiveTab             string
	AISettingsJSON        string
	DraftPortfoliosJSON   string
}

func (s *Store) GetProfile(ctx context.Context, userID string) (UserProfile, error) {
	if userID == "" {
		return UserProfile{ReserveMonths: 6, ActiveTab: "overview"}, nil
	}
	var p UserProfile
	err := s.db.QueryRowContext(ctx,
		`SELECT theme, preferred_currency, monthly_expenses_minor, reserve_months, hide_balances, emergency_goal_minor, fire_expenses_minor, instrument_columns_json, show_fire_calculator, enable_btp_ranks, active_tab, ai_settings_json, draft_portfolios_json FROM user_profiles WHERE user_id = ?`, userID,
	).Scan(&p.Theme, &p.PreferredCurrency, &p.MonthlyExpensesMinor, &p.ReserveMonths, &p.HideBalances, &p.EmergencyGoalMinor, &p.FireExpensesMinor, &p.InstrumentColumnsJSON, &p.ShowFireCalculator, &p.EnableBtpRanks, &p.ActiveTab, &p.AISettingsJSON, &p.DraftPortfoliosJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return UserProfile{ReserveMonths: 6, ActiveTab: "overview"}, nil
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
	if p.ActiveTab == "" {
		p.ActiveTab = "overview"
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO user_profiles (user_id, theme, preferred_currency, monthly_expenses_minor, reserve_months, hide_balances, emergency_goal_minor, fire_expenses_minor, instrument_columns_json, show_fire_calculator, enable_btp_ranks, active_tab, ai_settings_json, draft_portfolios_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET
		   theme=excluded.theme,
		   preferred_currency=excluded.preferred_currency,
		   monthly_expenses_minor=excluded.monthly_expenses_minor,
		   reserve_months=excluded.reserve_months,
		   hide_balances=excluded.hide_balances,
		   emergency_goal_minor=excluded.emergency_goal_minor,
		   fire_expenses_minor=excluded.fire_expenses_minor,
		   instrument_columns_json=excluded.instrument_columns_json,
		   show_fire_calculator=excluded.show_fire_calculator,
		   enable_btp_ranks=excluded.enable_btp_ranks,
		   active_tab=excluded.active_tab,
		   ai_settings_json=excluded.ai_settings_json,
		   draft_portfolios_json=excluded.draft_portfolios_json`,
		userID, p.Theme, p.PreferredCurrency, p.MonthlyExpensesMinor, p.ReserveMonths, p.HideBalances, p.EmergencyGoalMinor, p.FireExpensesMinor, p.InstrumentColumnsJSON, p.ShowFireCalculator, p.EnableBtpRanks, p.ActiveTab, p.AISettingsJSON, p.DraftPortfoliosJSON,
	)
	return err
}
