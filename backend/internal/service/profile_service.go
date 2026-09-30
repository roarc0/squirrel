package service

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	"github.com/roarc0/squirrel/backend/internal/auth"
	"github.com/roarc0/squirrel/backend/internal/store"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

func (s *Server) GetProfile(ctx context.Context, _ *connect.Request[portv1.GetProfileRequest]) (*connect.Response[portv1.GetProfileResponse], error) {
	userID := auth.UserIDOrEmpty(ctx)
	p, err := s.store.GetProfile(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.GetProfileResponse{
		Profile: profileToProto(p),
	}), nil
}

func (s *Server) UpdateProfile(ctx context.Context, req *connect.Request[portv1.UpdateProfileRequest]) (*connect.Response[portv1.UpdateProfileResponse], error) {
	userID := auth.UserIDOrEmpty(ctx)
	if userID == "" && s.config.Auth.SessionSecret != "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, auth.ErrUnauthenticated)
	}
	if req.Msg.Profile == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("profile is required"))
	}
	p, err := s.store.GetProfile(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	applyProfilePatch(&p, req.Msg.Profile)
	if err := s.store.SaveProfile(ctx, userID, p); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	p, err = s.store.GetProfile(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.UpdateProfileResponse{
		Profile: profileToProto(p),
	}), nil
}

func applyProfilePatch(p *store.UserProfile, patch *portv1.UserProfile) {
	if patch.Theme != nil {
		p.Theme = *patch.Theme
	}
	if patch.PreferredCurrency != nil {
		p.PreferredCurrency = *patch.PreferredCurrency
	}
	if patch.MonthlyExpensesMinor != nil {
		p.MonthlyExpensesMinor = *patch.MonthlyExpensesMinor
	}
	if patch.ReserveMonths != nil {
		p.ReserveMonths = *patch.ReserveMonths
	}
	if patch.HideBalances != nil {
		p.HideBalances = *patch.HideBalances
	}
	if patch.EmergencyGoalMinor != nil {
		p.EmergencyGoalMinor = *patch.EmergencyGoalMinor
	}
	if patch.FireExpensesMinor != nil {
		p.FireExpensesMinor = *patch.FireExpensesMinor
	}
	if patch.InstrumentColumnsJson != nil {
		p.InstrumentColumnsJSON = *patch.InstrumentColumnsJson
	}
	if patch.ShowFireCalculator != nil {
		p.ShowFireCalculator = *patch.ShowFireCalculator
	}
	if patch.EnableBtpRanks != nil {
		p.EnableBtpRanks = *patch.EnableBtpRanks
	}
	if patch.ActiveTab != nil {
		p.ActiveTab = *patch.ActiveTab
	}
	if patch.AiSettingsJson != nil {
		p.AISettingsJSON = *patch.AiSettingsJson
	}
	if patch.DraftPortfoliosJson != nil {
		p.DraftPortfoliosJSON = *patch.DraftPortfoliosJson
	}
	if patch.UserDescription != nil {
		p.UserDescription = *patch.UserDescription
	}
	if patch.StarredInstruments != nil {
		p.StarredInstruments = patch.StarredInstruments
	}
	if patch.StarredBtps != nil {
		p.StarredBTPs = patch.StarredBtps
	}
}

func profileToProto(p store.UserProfile) *portv1.UserProfile {
	return &portv1.UserProfile{
		Theme: proto.String(p.Theme), PreferredCurrency: proto.String(p.PreferredCurrency),
		MonthlyExpensesMinor: proto.Int64(p.MonthlyExpensesMinor), ReserveMonths: proto.Int32(p.ReserveMonths),
		HideBalances: proto.Bool(p.HideBalances), EmergencyGoalMinor: proto.Int64(p.EmergencyGoalMinor),
		FireExpensesMinor: proto.Int64(p.FireExpensesMinor), InstrumentColumnsJson: proto.String(p.InstrumentColumnsJSON),
		ShowFireCalculator: proto.Bool(p.ShowFireCalculator), EnableBtpRanks: proto.Bool(p.EnableBtpRanks),
		ActiveTab: proto.String(p.ActiveTab), AiSettingsJson: proto.String(p.AISettingsJSON),
		DraftPortfoliosJson: proto.String(p.DraftPortfoliosJSON), UserDescription: proto.String(p.UserDescription),
		StarredInstruments: p.StarredInstruments,
		StarredBtps:        p.StarredBTPs,
	}
}
