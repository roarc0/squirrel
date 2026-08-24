package service

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"connectrpc.com/connect"

	"loot/backend/internal/auth"
	"loot/backend/internal/portfolio"
	portv1 "loot/proto/gen/go/v1"
)

func (s *Server) ListHoldings(ctx context.Context, req *connect.Request[portv1.ListHoldingsRequest]) (*connect.Response[portv1.ListHoldingsResponse], error) {
	holdings, err := s.store.ListHoldings(ctx, auth.UserIDOrEmpty(ctx))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	sortField := ""
	if req.Msg.Sort != nil {
		sortField = *req.Msg.Sort
	}

	if sortField == "" {
		slices.SortStableFunc(holdings, func(a, b portfolio.Holding) int {
			if a.IsPAC != b.IsPAC {
				if a.IsPAC {
					return -1
				}
				return 1
			}
			if order := cmp.Compare(b.ValueMinor, a.ValueMinor); order != 0 {
				return order
			}
			return cmp.Compare(strings.ToLower(a.InstrumentName), strings.ToLower(b.InstrumentName))
		})
	} else {
		columns := map[string]func(portfolio.Holding, portfolio.Holding) int{
			"account":     func(a, b portfolio.Holding) int { return cmp.Compare(strings.ToLower(a.AccountName), strings.ToLower(b.AccountName)) },
			"name":        func(a, b portfolio.Holding) int { return cmp.Compare(strings.ToLower(a.InstrumentName), strings.ToLower(b.InstrumentName)) },
			"isin":        func(a, b portfolio.Holding) int { return cmp.Compare(a.InstrumentISIN, b.InstrumentISIN) },
			"type":        func(a, b portfolio.Holding) int { return cmp.Compare(a.InstrumentType, b.InstrumentType) },
			"asset":       func(a, b portfolio.Holding) int { return cmp.Compare(a.AssetClass, b.AssetClass) },
			"asset_class": func(a, b portfolio.Holding) int { return cmp.Compare(a.AssetClass, b.AssetClass) },
			"assetClass":  func(a, b portfolio.Holding) int { return cmp.Compare(a.AssetClass, b.AssetClass) },
			"invested":    func(a, b portfolio.Holding) int { return cmp.Compare(a.InvestedMinor, b.InvestedMinor) },
			"value": func(a, b portfolio.Holding) int {
				if order := cmp.Compare(a.ValueMinor, b.ValueMinor); order != 0 {
					return order
				}
				if a.IsPAC != b.IsPAC {
					if a.IsPAC {
						return 1
					}
					return -1
				}
				return cmp.Compare(strings.ToLower(a.InstrumentName), strings.ToLower(b.InstrumentName))
			},
			"profit":  func(a, b portfolio.Holding) int { return cmp.Compare(a.ValueMinor-a.InvestedMinor, b.ValueMinor-b.InvestedMinor) },
			"planned": func(a, b portfolio.Holding) int { return cmp.Compare(a.PlannedBPS, b.PlannedBPS) },
			"actual":  func(a, b portfolio.Holding) int { return cmp.Compare(a.ActualBPS, b.ActualBPS) },
			"ter":     func(a, b portfolio.Holding) int { return cmp.Compare(a.TERBPS, b.TERBPS) },
			"pac": func(a, b portfolio.Holding) int {
				if order := cmp.Compare(a.PACBPS, b.PACBPS); order != 0 {
					return order
				}
				return cmp.Compare(strings.ToLower(a.InstrumentName), strings.ToLower(b.InstrumentName))
			},
		}
		if err := sortSlice(sortField, holdings, columns); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
	}

	pbHoldings := make([]*portv1.Holding, len(holdings))
	for i, h := range holdings {
		pbHoldings[i] = holdingToProto(h)
	}
	return connect.NewResponse(&portv1.ListHoldingsResponse{Holdings: pbHoldings}), nil
}

func (s *Server) CreateHolding(ctx context.Context, req *connect.Request[portv1.CreateHoldingRequest]) (*connect.Response[portv1.CreateHoldingResponse], error) {
	if req.Msg.Holding == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("holding is required"))
	}
	holding := holdingFromProto(req.Msg.Holding)
	holding.ID = 0
	userID := auth.UserIDOrEmpty(ctx)
	if userID != "" {
		accounts, err := s.store.ListAccounts(ctx, userID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		owned := false
		for _, a := range accounts {
			if a.ID == holding.AccountID {
				owned = true
				break
			}
		}
		if !owned {
			return nil, connect.NewError(connect.CodePermissionDenied, errors.New("account not found"))
		}
	}
	if err := s.store.SaveHolding(ctx, &holding); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.CreateHoldingResponse{Holding: holdingToProto(holding)}), nil
}

func (s *Server) UpdateHolding(ctx context.Context, req *connect.Request[portv1.UpdateHoldingRequest]) (*connect.Response[portv1.UpdateHoldingResponse], error) {
	if req.Msg.Holding == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("holding is required"))
	}
	// Accept ID from either root field or holding.id — both refer to the same entity.
	holdingID := req.Msg.Id
	if holdingID == 0 {
		holdingID = req.Msg.Holding.Id
	}
	// Load existing so FK fields (account_id, instrument_id) are never zeroed out by a partial update.
	existing, err := s.store.GetHolding(ctx, holdingID, auth.UserIDOrEmpty(ctx))
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("holding %d not found: %w", holdingID, err))
	}
	patch := req.Msg.Holding
	// Apply all user-editable fields; protect FK fields from accidental zero.
	if patch.AccountId != 0 {
		existing.AccountID = patch.AccountId
	}
	if patch.InstrumentId != 0 {
		existing.InstrumentID = patch.InstrumentId
	}
	existing.InvestedMinor = patch.InvestedMinor
	existing.ValueMinor = patch.ValueMinor
	existing.TaxBPS = patch.TaxBps
	existing.PlannedBPS = patch.PlannedBps
	existing.IsPAC = patch.IsPac
	existing.PACBPS = patch.PacBps
	if patch.PacFrequency != "" {
		existing.PACFrequency = patch.PacFrequency
	}
	existing.Notes = patch.Notes
	if err := s.store.SaveHolding(ctx, existing); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.UpdateHoldingResponse{Holding: holdingToProto(*existing)}), nil
}

func (s *Server) DeleteHolding(ctx context.Context, req *connect.Request[portv1.DeleteHoldingRequest]) (*connect.Response[portv1.DeleteHoldingResponse], error) {
	if err := s.store.DeleteHolding(ctx, req.Msg.Id, auth.UserIDOrEmpty(ctx)); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.DeleteHoldingResponse{}), nil
}
