package service

import (
	"cmp"
	"context"
	"errors"
	"slices"

	"connectrpc.com/connect"

	"loot/backend/internal/portfolio"
	portv1 "loot/proto/gen/go/v1"
)

func (s *Server) ListSnapshots(ctx context.Context, req *connect.Request[portv1.ListSnapshotsRequest]) (*connect.Response[portv1.ListSnapshotsResponse], error) {
	snapshots, err := s.store.ListSnapshots(ctx)
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
			"date":      func(a, b portfolio.Snapshot) int { return cmp.Compare(a.ObservedOn, b.ObservedOn) },
			"cash":      func(a, b portfolio.Snapshot) int { return cmp.Compare(a.CashMinor, b.CashMinor) },
			"invested":  func(a, b portfolio.Snapshot) int { return cmp.Compare(a.InvestedMinor, b.InvestedMinor) },
			"portfolio": func(a, b portfolio.Snapshot) int { return cmp.Compare(a.PortfolioMinor, b.PortfolioMinor) },
			"total":     func(a, b portfolio.Snapshot) int { return cmp.Compare(a.TotalMinor, b.TotalMinor) },
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
	if err := s.store.SaveSnapshot(ctx, observedOn); err != nil {
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
	if err := s.store.UpdateSnapshot(ctx, &snapshot); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.UpdateSnapshotResponse{Snapshot: snapshotToProto(snapshot)}), nil
}

func (s *Server) DeleteSnapshot(ctx context.Context, req *connect.Request[portv1.DeleteSnapshotRequest]) (*connect.Response[portv1.DeleteSnapshotResponse], error) {
	if err := s.store.DeleteSnapshot(ctx, req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.DeleteSnapshotResponse{}), nil
}
