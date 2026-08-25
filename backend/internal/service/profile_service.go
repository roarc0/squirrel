package service

import (
	"context"

	"connectrpc.com/connect"

	"squirrel/backend/internal/auth"
	"squirrel/backend/internal/store"
	portv1 "squirrel/proto/gen/go/v1"
)

func (s *Server) GetProfile(ctx context.Context, _ *connect.Request[portv1.GetProfileRequest]) (*connect.Response[portv1.GetProfileResponse], error) {
	userID := auth.UserIDOrEmpty(ctx)
	p, err := s.store.GetProfile(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.GetProfileResponse{
		Profile: &portv1.UserProfile{
			Theme:                 p.Theme,
			PreferredCurrency:     p.PreferredCurrency,
			MonthlyExpensesMinor:  p.MonthlyExpensesMinor,
			ReserveMonths:         p.ReserveMonths,
			HideBalances:          p.HideBalances,
			EmergencyGoalMinor:    p.EmergencyGoalMinor,
			FireExpensesMinor:     p.FireExpensesMinor,
			InstrumentColumnsJson: p.InstrumentColumnsJSON,
			ShowFireCalculator:    p.ShowFireCalculator,
			EnableBtpRanks:        p.EnableBtpRanks,
			ActiveTab:             p.ActiveTab,
			AiSettingsJson:        p.AISettingsJSON,
			DraftPortfoliosJson:   p.DraftPortfoliosJSON,
		},
	}), nil
}

func (s *Server) UpdateProfile(ctx context.Context, req *connect.Request[portv1.UpdateProfileRequest]) (*connect.Response[portv1.UpdateProfileResponse], error) {
	userID := auth.UserIDOrEmpty(ctx)
	if userID == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, auth.ErrUnauthenticated)
	}
	var p store.UserProfile
	if req.Msg.Profile != nil {
		p.Theme = req.Msg.Profile.Theme
		p.PreferredCurrency = req.Msg.Profile.PreferredCurrency
		p.MonthlyExpensesMinor = req.Msg.Profile.MonthlyExpensesMinor
		p.ReserveMonths = req.Msg.Profile.ReserveMonths
		p.HideBalances = req.Msg.Profile.HideBalances
		p.EmergencyGoalMinor = req.Msg.Profile.EmergencyGoalMinor
		p.FireExpensesMinor = req.Msg.Profile.FireExpensesMinor
		p.InstrumentColumnsJSON = req.Msg.Profile.InstrumentColumnsJson
		p.ShowFireCalculator = req.Msg.Profile.ShowFireCalculator
		p.EnableBtpRanks = req.Msg.Profile.EnableBtpRanks
		p.ActiveTab = req.Msg.Profile.ActiveTab
		p.AISettingsJSON = req.Msg.Profile.AiSettingsJson
		p.DraftPortfoliosJSON = req.Msg.Profile.DraftPortfoliosJson
	}
	if err := s.store.SaveProfile(ctx, userID, p); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.UpdateProfileResponse{
		Profile: &portv1.UserProfile{
			Theme:                 p.Theme,
			PreferredCurrency:     p.PreferredCurrency,
			MonthlyExpensesMinor:  p.MonthlyExpensesMinor,
			ReserveMonths:         p.ReserveMonths,
			HideBalances:          p.HideBalances,
			EmergencyGoalMinor:    p.EmergencyGoalMinor,
			FireExpensesMinor:     p.FireExpensesMinor,
			InstrumentColumnsJson: p.InstrumentColumnsJSON,
			ShowFireCalculator:    p.ShowFireCalculator,
			EnableBtpRanks:        p.EnableBtpRanks,
			ActiveTab:             p.ActiveTab,
			AiSettingsJson:        p.AISettingsJSON,
			DraftPortfoliosJson:   p.DraftPortfoliosJSON,
		},
	}), nil
}
