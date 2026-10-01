package service

import (
	"math"
	"time"

	"github.com/roarc0/squirrel/backend/pkg/backtest"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

func dateString(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.DateOnly)
}

func backtestToProto(result backtest.Result, plans []backtest.Plan, options backtest.Options, fetched map[string]string) (*portv1.RunBacktestResponse, error) {
	h := result.History
	res := &portv1.RunBacktestResponse{StartDate: dateString(h.Dates[0]), EndDate: dateString(h.Dates[len(h.Dates)-1]), Currency: "EUR",
		Rebalance: options.Rebalance, RiskFreeRate: options.RiskFree, TargetReturn: options.Target}
	var err error
	res.Combined, err = backtestPortfolioToProto(result.Combined, options)
	if err != nil {
		return nil, err
	}
	if len(plans) == 1 {
		res.Combined.Name = plans[0].Name
	}
	for _, p := range result.Portfolios {
		pb, err := backtestPortfolioToProto(p, options)
		if err != nil {
			return nil, err
		}
		res.Portfolios = append(res.Portfolios, pb)
	}
	for _, c := range h.Coverage {
		res.Coverage = append(res.Coverage, &portv1.BacktestCoverage{Isin: c.ID, Name: c.Name, StartDate: dateString(c.Start), EndDate: dateString(c.End), FetchedAt: fetched[c.ID]})
		if c.Start.Equal(h.Dates[0]) {
			res.Notes = append(res.Notes, c.Name+" limits the available start date to "+dateString(c.Start)+".")
		}
	}
	if !options.Start.IsZero() && h.Dates[0].After(options.Start) || !options.End.IsZero() && h.Dates[len(h.Dates)-1].Before(options.End) {
		res.Notes = append(res.Notes, "The requested period was shortened to the instruments’ shared history.")
	}
	for _, years := range []int{0, 1, 3, 5} {
		c := backtest.Correlations(h, years)
		pb := &portv1.BacktestCorrelationWindow{Years: int32(years), Observations: int32(c.Observations)}
		for _, pair := range c.Pairs {
			pb.Pairs = append(pb.Pairs, &portv1.BacktestCorrelation{Left: pair.Left, Right: pair.Right, Value: pair.Value})
		}
		res.Correlations = append(res.Correlations, pb)
	}
	for _, plan := range plans {
		pb := &portv1.BacktestPlan{Id: plan.ID, Name: plan.Name, Initial: plan.Initial, Monthly: plan.Monthly}
		for _, a := range plan.Allocations {
			pb.Allocations = append(pb.Allocations, &portv1.BacktestAllocation{Isin: a.AssetID, WeightBps: int32(math.Round(a.Weight * 10000))})
		}
		res.Plans = append(res.Plans, pb)
	}
	return res, nil
}

func backtestPortfolioToProto(p backtest.Portfolio, options backtest.Options) (*portv1.BacktestPortfolio, error) {
	a, err := backtest.Analyze(p.Days, options)
	if err != nil {
		return nil, err
	}
	pb := &portv1.BacktestPortfolio{Id: p.ID, Name: p.Name, Xirr: a.XIRR, CompleteMonths: int32(a.Monthly.Count), PositiveMonths: a.Monthly.PositiveFraction,
		DurationYears: a.DurationYears,
		MaxDrawdown:   a.Drawdowns.Maximum,
		MonthlyVar95:  a.Monthly.VaR95, MonthlyVar99: a.Monthly.VaR99, AverageDrawdown: a.Drawdowns.Average,
		LongestDrawdownDays: int32(a.Drawdowns.LongestDays), LongestDrawdownStart: dateString(a.Drawdowns.LongestStart), LongestDrawdownEnd: dateString(a.Drawdowns.LongestEnd),
		LongestDrawdownUnrecovered: a.Drawdowns.Unrecovered, Notes: a.Notes}
	if a.Metrics != nil {
		pb.Metrics = riskMetricsToProto(*a.Metrics)
	}
	for i, day := range p.Days {
		pb.Series = append(pb.Series, &portv1.BacktestObservation{Date: dateString(day.Time), Value: day.Value, Contributed: day.Contributed, Index: day.Index, Drawdown: a.Drawdowns.Values[i]})
	}
	for _, m := range a.Months {
		pb.Months = append(pb.Months, &portv1.BacktestMonth{Year: int32(m.Year), Month: int32(m.Month), ReturnValue: m.Return, Partial: m.Partial})
	}
	for _, y := range a.Years {
		pb.Years = append(pb.Years, &portv1.BacktestYear{Year: int32(y.Year), ReturnValue: y.Return, Partial: y.Partial})
	}
	for _, r := range a.Rolling {
		window := &portv1.BacktestRollingWindow{Years: int32(r.Years)}
		for _, point := range r.Points {
			window.Points = append(window.Points, &portv1.BacktestReturnPoint{Date: dateString(point.Time), ReturnValue: point.Return})
		}
		pb.Rolling = append(pb.Rolling, window)
	}
	for _, hp := range a.HoldingPeriods {
		pb.HoldingPeriods = append(pb.HoldingPeriods, &portv1.BacktestHoldingPeriod{Years: int32(hp.Years), Samples: int32(hp.Samples), WorstReturn: hp.WorstReturn, NonnegativeFraction: hp.NonnegativeFraction})
	}
	return pb, nil
}
