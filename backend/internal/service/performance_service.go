package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
	"github.com/roarc0/squirrel/backend/internal/store"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

func (s *Server) GetInstrumentPerformance(ctx context.Context, req *connect.Request[portv1.GetInstrumentPerformanceRequest]) (*connect.Response[portv1.GetInstrumentPerformanceResponse], error) {
	isin := strings.ToUpper(strings.TrimSpace(req.Msg.Isin))
	if !portfolio.ValidISIN(isin) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid ISIN"))
	}

	meta, err := s.store.GetPerformanceMeta(ctx, isin)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	fetchedAt, timestampErr := time.Parse(time.RFC3339, meta.FetchedAt)
	// All consumers, including backtests, must eventually refresh saved charts.
	// A failed refresh remains an error; never silently present old data as current.
	if errors.Is(err, store.ErrNotFound) || timestampErr != nil || time.Since(fetchedAt) >= 24*time.Hour {
		points, fetchErr := s.justETF.FetchPerformance(ctx, isin)
		if fetchErr != nil {
			return nil, justETFConnectError(ctx, isin, fetchErr)
		}
		if saveErr := s.store.SavePerformance(ctx, isin, points); saveErr != nil {
			return nil, connect.NewError(connect.CodeInternal, saveErr)
		}
		meta, err = s.store.GetPerformanceMeta(ctx, isin)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	points, err := s.store.GetPerformance(ctx, isin)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&portv1.GetInstrumentPerformanceResponse{
		Series:     toProtoPerformancePoints(points),
		FetchedAt:  meta.FetchedAt,
		PointCount: int32(meta.PointCount),
	}), nil
}

func (s *Server) RefreshInstrumentPerformance(ctx context.Context, req *connect.Request[portv1.RefreshInstrumentPerformanceRequest]) (*connect.Response[portv1.RefreshInstrumentPerformanceResponse], error) {
	isin := strings.ToUpper(strings.TrimSpace(req.Msg.Isin))
	if !portfolio.ValidISIN(isin) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid ISIN"))
	}

	points, err := s.justETF.FetchPerformance(ctx, isin)
	if err != nil {
		return nil, justETFConnectError(ctx, isin, err)
	}

	if err := s.store.SavePerformance(ctx, isin, points); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	meta, err := s.store.GetPerformanceMeta(ctx, isin)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	points, err = s.store.GetPerformance(ctx, isin)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.RefreshInstrumentPerformanceResponse{
		Series:     toProtoPerformancePoints(points),
		FetchedAt:  meta.FetchedAt,
		PointCount: int32(meta.PointCount),
	}), nil
}

func toProtoPerformancePoints(points []portfolio.PerformancePoint) []*portv1.PerformancePoint {
	result := make([]*portv1.PerformancePoint, len(points))
	for i, p := range points {
		result[i] = &portv1.PerformancePoint{
			Date:      p.Date,
			ChangeBps: p.ChangeBPS,
		}
	}
	return result
}
