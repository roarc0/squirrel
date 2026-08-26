package service

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	"github.com/roarc0/squirrel/backend/internal/ecb"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

func (s *Server) GetMarketContext(ctx context.Context, req *connect.Request[portv1.GetMarketContextRequest]) (*connect.Response[portv1.GetMarketContextResponse], error) {
	observationCount, err := inflationObservationCount(req.Msg.InflationRange)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	var warnings []string
	var market ecb.MarketContext

	storedMetrics, errMetrics := s.store.ListMarketMetrics(ctx)
	storedObs, errObs := s.store.ListMarketObservations(ctx)
	hasCache := errMetrics == nil && errObs == nil && len(storedMetrics) > 0

	forceRefresh := req.Msg.GetForceRefresh()

	if hasCache && !forceRefresh {
		// Return stored metrics instantly (< 1 ms latency)
		market.Metrics = storedMetrics
		market.Observations = storedObs

		// Fire-and-forget background refresh to update SQLite cache
		go func() {
			bgCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			fresh, err := s.ecb.FetchMarketContext(bgCtx, observationCount)
			if err == nil {
				_ = s.store.SaveMarketContext(bgCtx, fresh)
			}
		}()
	} else {
		// Synchronous live fetch
		liveMarket, err := s.ecb.FetchMarketContext(ctx, observationCount)
		if err == nil {
			market = liveMarket
			if err := s.store.SaveMarketContext(ctx, market); err != nil {
				warnings = append(warnings, fmt.Sprintf("failed to save market context cache: %v", err))
			}
		} else if hasCache {
			warnings = append(warnings, fmt.Sprintf("live fetch warning: %v", err))
			market.Metrics = storedMetrics
			market.Observations = storedObs
		} else {
			return nil, connect.NewError(connect.CodeUnavailable, err)
		}
	}

	warnings = append(warnings, market.Warnings...)

	metrics := make([]*portv1.MarketMetric, len(market.Metrics))
	for i, metric := range market.Metrics {
		metrics[i] = &portv1.MarketMetric{
			Code:            metric.Code,
			Label:           metric.Label,
			Category:        metric.Category,
			Value:           metric.Value,
			Unit:            metric.Unit,
			ObservedOn:      metric.ObservedOn,
			SourceUrl:       metric.SourceURL,
			Change_1Y:       metric.Change1Y,
			Distance_52WHigh: metric.Distance52WHigh,
			Sma_200:         metric.SMA200,
		}
	}
	observations := make([]*portv1.MarketObservation, len(market.Observations))
	for i, observation := range market.Observations {
		observations[i] = &portv1.MarketObservation{
			Code:       observation.Code,
			ObservedOn: observation.ObservedOn,
			Value:      observation.Value,
		}
	}
	return connect.NewResponse(&portv1.GetMarketContextResponse{Metrics: metrics, Warnings: warnings, Observations: observations}), nil
}

func inflationObservationCount(historyRange string) (int, error) {
	switch historyRange {
	case "", "1y":
		return 365, nil
	case "3y":
		return 1095, nil
	case "5y":
		return 1825, nil
	case "max":
		return 3650, nil
	default:
		return 0, fmt.Errorf("unsupported inflation range %q", historyRange)
	}
}
