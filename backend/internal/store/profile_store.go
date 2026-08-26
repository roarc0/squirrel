package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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
	UserDescription       string
}

func (s *Store) GetProfile(ctx context.Context, userID string) (UserProfile, error) {
	var p UserProfile
	err := s.db.QueryRowContext(ctx,
		`SELECT theme, preferred_currency, monthly_expenses_minor, reserve_months, hide_balances, emergency_goal_minor, fire_expenses_minor, instrument_columns_json, show_fire_calculator, enable_btp_ranks, active_tab, ai_settings_json, draft_portfolios_json, user_description FROM user_profiles WHERE user_id = ?`, userID,
	).Scan(&p.Theme, &p.PreferredCurrency, &p.MonthlyExpensesMinor, &p.ReserveMonths, &p.HideBalances, &p.EmergencyGoalMinor, &p.FireExpensesMinor, &p.InstrumentColumnsJSON, &p.ShowFireCalculator, &p.EnableBtpRanks, &p.ActiveTab, &p.AISettingsJSON, &p.DraftPortfoliosJSON, &p.UserDescription)
	if errors.Is(err, sql.ErrNoRows) {
		return UserProfile{ReserveMonths: 6, ActiveTab: "overview"}, nil
	}
	return p, err
}

func (s *Store) SaveProfile(ctx context.Context, userID string, p UserProfile) error {
	if userID == "" {
		return errors.New("user_id required")
	}
	if err := normalizeProfile(&p); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO user_profiles (user_id, theme, preferred_currency, monthly_expenses_minor, reserve_months, hide_balances, emergency_goal_minor, fire_expenses_minor, instrument_columns_json, show_fire_calculator, enable_btp_ranks, active_tab, ai_settings_json, draft_portfolios_json, user_description)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
		   draft_portfolios_json=excluded.draft_portfolios_json,
		   user_description=excluded.user_description`,
		userID, p.Theme, p.PreferredCurrency, p.MonthlyExpensesMinor, p.ReserveMonths, p.HideBalances, p.EmergencyGoalMinor, p.FireExpensesMinor, p.InstrumentColumnsJSON, p.ShowFireCalculator, p.EnableBtpRanks, p.ActiveTab, p.AISettingsJSON, p.DraftPortfoliosJSON, p.UserDescription,
	)
	return err
}

func normalizeProfile(p *UserProfile) error {
	p.PreferredCurrency = strings.ToUpper(strings.TrimSpace(p.PreferredCurrency))
	if p.PreferredCurrency != "" && len(p.PreferredCurrency) != 3 {
		return errors.New("preferred currency must be a three-letter code")
	}
	if p.MonthlyExpensesMinor < 0 || p.MonthlyExpensesMinor > 1_000_000_000_000 || p.EmergencyGoalMinor < 0 || p.EmergencyGoalMinor > 1_000_000_000_000 || p.FireExpensesMinor < 0 || p.FireExpensesMinor > 1_000_000_000_000 {
		return errors.New("profile monetary values are outside the supported range")
	}
	if p.ReserveMonths < 0 || p.ReserveMonths > 120 {
		return errors.New("reserve months must be between 1 and 120")
	}
	for name, value := range map[string]string{"instrument columns": p.InstrumentColumnsJSON, "AI settings": p.AISettingsJSON, "draft portfolios": p.DraftPortfoliosJSON} {
		if value != "" && (len(value) > 1<<20 || !json.Valid([]byte(value))) {
			return fmt.Errorf("%s must be valid JSON no larger than 1 MiB", name)
		}
	}
	if len(p.UserDescription) > 1<<20 {
		return errors.New("user description must not exceed 1 MiB")
	}
	if p.ReserveMonths == 0 {
		p.ReserveMonths = 6
	}
	if p.ActiveTab == "" {
		p.ActiveTab = "overview"
	}
	return nil
}
