package service

import (
	"cmp"
	"context"
	"errors"
	"slices"

	"connectrpc.com/connect"

	"github.com/roarc0/squirrel/backend/internal/auth"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

func (s *Server) ListSnapshots(ctx context.Context, req *connect.Request[portv1.ListSnapshotsRequest]) (*connect.Response[portv1.ListSnapshotsResponse], error) {
	snapshots, err := s.store.ListSnapshots(ctx, auth.UserIDOrEmpty(ctx))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	sortField := ""
	if req.Msg.Sort != nil {
		sortField = *req.Msg.Sort
	}

	if sortField == "" {
		slices.SortStableFunc(snapshots, func(a, b portfolio.Snapshot) int {
			return cmp.Compare(b.ObservedOn, a.ObservedOn)
		})
	} else {
		columns := map[string]func(portfolio.Snapshot, portfolio.Snapshot) int{
			"date":        func(a, b portfolio.Snapshot) int { return cmp.Compare(a.ObservedOn, b.ObservedOn) },
			"observed_on": func(a, b portfolio.Snapshot) int { return cmp.Compare(a.ObservedOn, b.ObservedOn) },
			"observedOn":  func(a, b portfolio.Snapshot) int { return cmp.Compare(a.ObservedOn, b.ObservedOn) },
			"cash":        func(a, b portfolio.Snapshot) int { return cmp.Compare(a.CashMinor, b.CashMinor) },
			"invested":    func(a, b portfolio.Snapshot) int { return cmp.Compare(a.InvestedMinor, b.InvestedMinor) },
			"portfolio":   func(a, b portfolio.Snapshot) int { return cmp.Compare(a.PortfolioMinor, b.PortfolioMinor) },
			"total":       func(a, b portfolio.Snapshot) int { return cmp.Compare(a.TotalMinor, b.TotalMinor) },
		}
		if err := sortSlice(sortField, snapshots, columns); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
	}

	pbSnapshots := make([]*portv1.Snapshot, len(snapshots))
	for i, snap := range snapshots {
		pbSnapshots[i] = snapshotToProto(snap)
	}
	return connect.NewResponse(&portv1.ListSnapshotsResponse{Snapshots: pbSnapshots}), nil
}

func (s *Server) CreateSnapshot(ctx context.Context, req *connect.Request[portv1.CreateSnapshotRequest]) (*connect.Response[portv1.CreateSnapshotResponse], error) {
	observedOn := req.Msg.ObservedOn
	if observedOn == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("observed_on is required"))
	}
	if err := s.store.SaveSnapshot(ctx, observedOn, auth.UserIDOrEmpty(ctx)); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.CreateSnapshotResponse{}), nil
}

func (s *Server) UpdateSnapshot(ctx context.Context, req *connect.Request[portv1.UpdateSnapshotRequest]) (*connect.Response[portv1.UpdateSnapshotResponse], error) {
	snapshot := portfolio.Snapshot{
		ID:             req.Msg.Id,
		ObservedOn:     req.Msg.ObservedOn,
		Currency:       req.Msg.Currency,
		CashMinor:      req.Msg.CashMinor,
		InvestedMinor:  req.Msg.InvestedMinor,
		PortfolioMinor: req.Msg.PortfolioMinor,
	}
	if err := s.store.UpdateSnapshot(ctx, &snapshot, auth.UserIDOrEmpty(ctx)); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.UpdateSnapshotResponse{Snapshot: snapshotToProto(snapshot)}), nil
}

func (s *Server) DeleteSnapshot(ctx context.Context, req *connect.Request[portv1.DeleteSnapshotRequest]) (*connect.Response[portv1.DeleteSnapshotResponse], error) {
	if err := s.store.DeleteSnapshot(ctx, req.Msg.Id, auth.UserIDOrEmpty(ctx)); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.DeleteSnapshotResponse{}), nil
}

func (s *Server) UpdateSituation(ctx context.Context, req *connect.Request[portv1.UpdateSituationRequest]) (*connect.Response[portv1.UpdateSituationResponse], error) {
	accountUpdates := make(map[int64]int64, len(req.Msg.AccountUpdates))
	for _, u := range req.Msg.AccountUpdates {
		accountUpdates[u.AccountId] = u.BalanceMinor
	}

	holdingValueUpdates := make(map[int64]int64, len(req.Msg.HoldingUpdates))
	holdingInvestedUpdates := make(map[int64]*int64, len(req.Msg.HoldingUpdates))
	for _, u := range req.Msg.HoldingUpdates {
		holdingValueUpdates[u.HoldingId] = u.ValueMinor
		if u.InvestedMinor != nil {
			val := *u.InvestedMinor
			holdingInvestedUpdates[u.HoldingId] = &val
		}
	}

	observedOn := ""
	if req.Msg.ObservedOn != nil {
		observedOn = *req.Msg.ObservedOn
	}

	saved, err := s.store.UpdateSituation(ctx, auth.UserIDOrEmpty(ctx), accountUpdates, holdingValueUpdates, holdingInvestedUpdates, req.Msg.SaveSnapshot, observedOn)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&portv1.UpdateSituationResponse{SnapshotSaved: saved}), nil
}
