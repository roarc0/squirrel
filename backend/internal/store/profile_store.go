package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
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
	StarredInstruments    []string
	StarredBTPs           []string
}

func (s *Store) GetProfile(ctx context.Context, userID string) (UserProfile, error) {
	var p UserProfile
	err := s.db.QueryRowContext(ctx,
		`SELECT theme, preferred_currency, monthly_expenses_minor, reserve_months, hide_balances, emergency_goal_minor, fire_expenses_minor, instrument_columns_json, show_fire_calculator, enable_btp_ranks, active_tab, ai_settings_json, draft_portfolios_json, user_description FROM user_profiles WHERE user_id = ?`, userID,
	).Scan(&p.Theme, &p.PreferredCurrency, &p.MonthlyExpensesMinor, &p.ReserveMonths, &p.HideBalances, &p.EmergencyGoalMinor, &p.FireExpensesMinor, &p.InstrumentColumnsJSON, &p.ShowFireCalculator, &p.EnableBtpRanks, &p.ActiveTab, &p.AISettingsJSON, &p.DraftPortfoliosJSON, &p.UserDescription)
	if errors.Is(err, sql.ErrNoRows) {
		p = UserProfile{ReserveMonths: 6, ActiveTab: "overview"}
		err = nil
	}
	p.AISettingsJSON = stripAIAPIKey(p.AISettingsJSON)

	starredInst, _ := s.ListStarredInstruments(ctx, userID)
	p.StarredInstruments = starredInst
	if p.StarredInstruments == nil {
		p.StarredInstruments = []string{}
	}

	var starredBtps []string
	if rows, qErr := s.db.QueryContext(ctx, `SELECT isin FROM btp_starred WHERE user_id = ? ORDER BY isin`, userID); qErr == nil {
		defer rows.Close()
		for rows.Next() {
			var isin string
			if rows.Scan(&isin) == nil {
				starredBtps = append(starredBtps, isin)
			}
		}
	}
	p.StarredBTPs = starredBtps
	if p.StarredBTPs == nil {
		p.StarredBTPs = []string{}
	}

	return p, err
}

func (s *Store) SaveProfile(ctx context.Context, userID string, p UserProfile) error {
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
	if err != nil {
		return err
	}
	if p.StarredInstruments != nil {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM instrument_starred WHERE user_id=?`, userID); err != nil {
			return err
		}
		now := time.Now().UTC().Format(time.RFC3339)
		for _, isin := range p.StarredInstruments {
			isin = strings.ToUpper(strings.TrimSpace(isin))
			if portfolio.ValidISIN(isin) {
				_, _ = s.db.ExecContext(ctx, `INSERT INTO instrument_starred (user_id, isin, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id, isin) DO NOTHING`, userID, isin, now)
			}
		}
	}
	if p.StarredBTPs != nil {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM btp_starred WHERE user_id=?`, userID); err != nil {
			return err
		}
		now := time.Now().UTC().Format(time.RFC3339)
		for _, isin := range p.StarredBTPs {
			isin = strings.ToUpper(strings.TrimSpace(isin))
			if len(isin) == 12 {
				_, _ = s.db.ExecContext(ctx, `INSERT INTO btp_starred (user_id, isin, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id, isin) DO NOTHING`, userID, isin, now)
			}
		}
	}
	return nil
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
	p.AISettingsJSON = stripAIAPIKey(p.AISettingsJSON)
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

func stripAIAPIKey(raw string) string {
	var settings map[string]json.RawMessage
	if raw == "" || json.Unmarshal([]byte(raw), &settings) != nil {
		return raw
	}
	delete(settings, "apiKey")
	delete(settings, "api_key")
	clean, err := json.Marshal(settings)
	if err != nil {
		return raw
	}
	return string(clean)
}
