package backtest

import (
	"errors"
	"time"

	"github.com/roarc0/squirrel/backend/pkg/riskmetrics"
)

type Analysis struct {
	DurationYears  float64 // elapsed time on the same ACT/365.25 basis as CAGR
	Metrics        *riskmetrics.Metrics
	XIRR           *float64
	Months         []MonthReturn
	Years          []YearReturn
	Monthly        MonthlyStats
	Rolling        []RollingWindow
	Drawdowns      DrawdownAnalysis
	HoldingPeriods []HoldingPeriod
	Notes          []string
}

// Analyze accepts a positive, daily unitized series with nondecreasing cumulative
// contributions. Risk analytics use Index; investor XIRR uses Value and deposits.
func Analyze(days []Day, options Options) (Analysis, error) {
	var a Analysis
	if len(days) < 2 {
		return a, errors.New("analysis needs at least two daily valuations")
	}
	for i, d := range days {
		if d.Time.IsZero() || !finite(d.Value) || d.Value <= 0 || !finite(d.Index) || d.Index <= 0 || !finite(d.Contributed) || d.Contributed <= 0 {
			return a, errors.New("invalid portfolio valuation")
		}
		if i > 0 && (d.Time.Sub(days[i-1].Time) != 24*time.Hour || d.Contributed < days[i-1].Contributed) {
			return a, errors.New("analysis needs consecutive daily valuations and nondecreasing contributions")
		}
	}
	if !finite(options.RiskFree) || options.RiskFree <= -1 || !finite(options.Target) || options.Target <= -1 {
		return a, errors.New("invalid annual rate assumptions")
	}
	points := levels(days)
	a.DurationYears = days[len(days)-1].Time.Sub(days[0].Time).Hours() / (24 * riskmetrics.DaysPerYear)
	if len(days) >= 31 {
		m, err := riskmetrics.Calculate(points, riskmetrics.Options{PeriodsPerYear: riskmetrics.DaysPerYear, RiskFreeRate: options.RiskFree, TargetReturn: options.Target})
		if err != nil {
			return a, err
		}
		a.Metrics = &m
	} else {
		a.Notes = append(a.Notes, "Annualized risk metrics need at least 30 daily returns.")
	}
	if a.DurationYears < 1 {
		if a.Metrics != nil {
			a.Metrics.CAGR, a.Metrics.Calmar = nil, nil
		}
		a.Notes = append(a.Notes, "Less than one year: CAGR, Calmar and annualized XIRR are unavailable; other annualized estimates are sensitive to this short window.")
	} else {
		a.XIRR = moneyWeightedReturn(days)
		if a.XIRR == nil {
			a.Notes = append(a.Notes, "XIRR has no finite solution in the supported numeric range.")
		}
	}
	a.Months, a.Years = heatmap(days)
	a.Monthly = monthlyStatistics(a.Months)
	a.Drawdowns = drawdownAnalysis(points)
	for _, years := range []int{1, 3, 5} {
		a.Rolling = append(a.Rolling, rollingReturns(days, years))
	}
	for _, years := range []int{1, 3, 5, 10, 15, 20} {
		a.HoldingPeriods = append(a.HoldingPeriods, holdingPeriod(days, years))
	}
	return a, nil
}
