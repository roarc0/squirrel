package service

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

func (s *Server) GetMarketContext(ctx context.Context, req *connect.Request[portv1.GetMarketContextRequest]) (*connect.Response[portv1.GetMarketContextResponse], error) {
	observationCount, err := inflationObservationCount(req.Msg.InflationRange)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	var warnings []string
	market, err := s.ecb.FetchMarketContext(ctx, observationCount)
	if err == nil {
		if err := s.store.SaveMarketContext(ctx, market); err != nil {
			warnings = append(warnings, fmt.Sprintf("failed to save market context cache: %v", err))
		}
	} else {
		warnings = append(warnings, fmt.Sprintf("ECB fetch error: %v", err))
		storedMetrics, errMetrics := s.store.ListMarketMetrics(ctx)
		storedObs, errObs := s.store.ListMarketObservations(ctx)
		if errMetrics == nil && errObs == nil && len(storedMetrics) > 0 {
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
			Code:       metric.Code,
			Label:      metric.Label,
			Category:   metric.Category,
			Value:      metric.Value,
			Unit:       metric.Unit,
			ObservedOn: metric.ObservedOn,
			SourceUrl:  metric.SourceURL,
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
		return 12, nil
	case "3y":
		return 36, nil
	case "5y":
		return 60, nil
	case "max":
		return 120, nil
	default:
		return 0, fmt.Errorf("unsupported inflation range %q", historyRange)
	}
}
