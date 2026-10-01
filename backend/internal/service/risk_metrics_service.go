package service

import (
	"context"
	"errors"
	"math"
	"time"

	"connectrpc.com/connect"
	"github.com/roarc0/squirrel/backend/pkg/riskmetrics"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

func (s *Server) GetInstrumentRiskMetrics(ctx context.Context, req *connect.Request[portv1.GetInstrumentRiskMetricsRequest]) (*connect.Response[portv1.GetInstrumentRiskMetricsResponse], error) {
	for _, date := range []string{req.Msg.StartDate, req.Msg.EndDate} {
		if date != "" {
			if _, err := time.Parse(time.DateOnly, date); err != nil {
				return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("dates must use YYYY-MM-DD"))
			}
		}
	}
	if req.Msg.StartDate != "" && req.Msg.EndDate != "" && req.Msg.StartDate > req.Msg.EndDate {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("start date must not follow end date"))
	}
	for _, rate := range []float64{req.Msg.RiskFreeRate, req.Msg.TargetReturn} {
		if math.IsNaN(rate) || math.IsInf(rate, 0) || rate <= -1 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("annual rates must be finite and greater than -100%"))
		}
	}
	// Reuse the same cache and first-fetch behavior as the performance chart.
	history, err := s.GetInstrumentPerformance(ctx, connect.NewRequest(&portv1.GetInstrumentPerformanceRequest{Isin: req.Msg.Isin}))
	if err != nil {
		return nil, err
	}
	result := &portv1.GetInstrumentRiskMetricsResponse{
		FetchedAt: history.Msg.FetchedAt, Currency: "EUR",
		PeriodsPerYear: riskmetrics.DaysPerYear,
		RiskFreeRate:   req.Msg.RiskFreeRate, TargetReturn: req.Msg.TargetReturn,
	}
	var points []riskmetrics.Point
	for _, p := range history.Msg.Series {
		if req.Msg.StartDate != "" && p.Date < req.Msg.StartDate || req.Msg.EndDate != "" && p.Date > req.Msg.EndDate {
			continue
		}
		date, err := time.Parse(time.DateOnly, p.Date)
		if err != nil {
			result.Note = "Risk metrics unavailable: history contains an invalid date."
			return connect.NewResponse(result), nil
		}
		// justETF stores cumulative percentage changes in basis points, not
		// daily returns. Reconstruct an index level before taking ratios.
		points = append(points, riskmetrics.Point{Time: date, Price: 1 + float64(p.ChangeBps)/10000})
	}
	result.PointCount = int32(len(points))
	if len(points) > 0 {
		result.StartDate = points[0].Time.Format(time.DateOnly)
		result.EndDate = points[len(points)-1].Time.Format(time.DateOnly)
	}
	if len(points) < 31 {
		result.Note = "Risk metrics need at least 30 daily returns (31 observations) in the selected period."
		return connect.NewResponse(result), nil
	}
	// This provider includes calendar days, including unchanged weekend levels.
	// Do not silently annualize a multi-day gap as a single daily return.
	for i := 1; i < len(points); i++ {
		if points[i].Time.Sub(points[i-1].Time) != 24*time.Hour {
			result.Note = "Risk metrics unavailable: the selected history has missing calendar days. Try a shorter period or refresh the history."
			return connect.NewResponse(result), nil
		}
	}
	m, err := riskmetrics.Calculate(points, riskmetrics.Options{
		PeriodsPerYear: result.PeriodsPerYear, RiskFreeRate: result.RiskFreeRate, TargetReturn: result.TargetReturn,
	})
	if err != nil {
		result.Note = "Risk metrics unavailable: " + err.Error() + "."
		return connect.NewResponse(result), nil
	}
	result.Metrics = riskMetricsToProto(m)
	if points[len(points)-1].Time.Sub(points[0].Time).Hours() < 24*riskmetrics.DaysPerYear {
		result.Metrics.Cagr, result.Metrics.Calmar = nil, nil
		result.Note = "Less than one year of history: annualized risk estimates are sensitive to this short window. CAGR and Calmar need at least one year."
	}
	return connect.NewResponse(result), nil
}

func riskMetricsToProto(m riskmetrics.Metrics) *portv1.InstrumentRiskMetrics {
	return &portv1.InstrumentRiskMetrics{TotalReturn: m.TotalReturn, Cagr: m.CAGR, Volatility: m.Volatility, DownsideDeviation: m.DownsideDeviation,
		MaxDrawdown: m.MaxDrawdown, UlcerIndex: m.UlcerIndex, Sharpe: m.Sharpe, Sortino: m.Sortino, Calmar: m.Calmar}
}
