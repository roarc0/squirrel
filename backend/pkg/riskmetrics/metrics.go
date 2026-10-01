// Package riskmetrics calculates historical risk from regularly sampled prices
// or total-return index levels. It has no dependencies outside the Go standard
// library and does not fetch, resample, sort, or mutate its input.
package riskmetrics

import (
	"errors"
	"fmt"
	"math"
	"time"
)

const DaysPerYear = 365.25

type Point struct {
	Time  time.Time
	Price float64
}

type Options struct {
	// PeriodsPerYear must match the sampling: e.g. 12 monthly, 252 trading
	// days, or 365.25 calendar days. Missing observations must be resolved
	// by the caller, not treated as single-period returns.
	PeriodsPerYear float64
	// Effective annual rates, expressed as fractions (0.02 = 2%).
	RiskFreeRate float64
	TargetReturn float64
}

type Metrics struct {
	// Returns, volatility, and drawdowns are fractions, not percentages.
	// Drawdowns are positive loss magnitudes. UlcerIndex is not annualized.
	TotalReturn       float64
	CAGR              *float64
	Volatility        float64
	DownsideDeviation float64
	MaxDrawdown       float64
	UlcerIndex        float64
	// Undefined ratios (zero denominator) and non-finite results are nil.
	Sharpe  *float64
	Sortino *float64
	Calmar  *float64
}

// Calculate uses simple period returns, sample standard deviation (n-1),
// and downside squared shortfalls averaged over ALL n returns. Sharpe and
// Sortino use arithmetic mean excess returns and square-root annualization;
// these are historical estimates, not distribution-free forecasts. CAGR uses
// actual elapsed time on an ACT/365.25 basis. Calmar uses the entire supplied
// window (traditionally three years). Ulcer Index includes the initial point.
// Prices must be finite and strictly positive, dates strictly increasing, and
// at least three points are required. Use adjusted prices to account for
// splits/distributions; raw prices only describe price return.
func Calculate(points []Point, options Options) (Metrics, error) {
	var result Metrics
	if !finite(options.PeriodsPerYear) || options.PeriodsPerYear <= 0 ||
		!finite(options.RiskFreeRate) || options.RiskFreeRate <= -1 ||
		!finite(options.TargetReturn) || options.TargetReturn <= -1 {
		return result, errors.New("invalid sampling frequency or annual rate")
	}
	if len(points) < 3 {
		return result, errors.New("at least three price observations are required")
	}
	riskFree := math.Expm1(math.Log1p(options.RiskFreeRate) / options.PeriodsPerYear)
	target := math.Expm1(math.Log1p(options.TargetReturn) / options.PeriodsPerYear)
	if !finite(riskFree) || !finite(target) {
		return result, errors.New("period rate is outside the numeric range")
	}
	var mean, m2, downsideSquares, drawdownSquares, peak float64
	for i, p := range points {
		if p.Time.IsZero() || !finite(p.Price) || p.Price <= 0 {
			return Metrics{}, fmt.Errorf("invalid observation at index %d", i)
		}
		if i > 0 && !p.Time.After(points[i-1].Time) {
			return Metrics{}, errors.New("observation times must be strictly increasing")
		}
		peak = math.Max(peak, p.Price)
		drawdown := 1 - p.Price/peak
		result.MaxDrawdown = math.Max(result.MaxDrawdown, drawdown)
		drawdownSquares += drawdown * drawdown
		if i == 0 {
			continue
		}
		r := p.Price/points[i-1].Price - 1
		// Welford's algorithm avoids cancellation in low-volatility series.
		delta := r - mean
		mean += delta / float64(i)
		m2 += delta * (r - mean)
		shortfall := math.Min(0, r-target)
		downsideSquares += shortfall * shortfall
	}
	n := float64(len(points) - 1)
	stddev := math.Sqrt(math.Max(0, m2) / (n - 1))
	downside := math.Sqrt(downsideSquares / n)
	annualScale := math.Sqrt(options.PeriodsPerYear)
	result.Volatility = stddev * annualScale
	result.DownsideDeviation = downside * annualScale
	result.UlcerIndex = math.Sqrt(drawdownSquares / float64(len(points)))
	result.TotalReturn = points[len(points)-1].Price/points[0].Price - 1
	if !finite(mean) || !finite(result.TotalReturn) || !finite(result.Volatility) || !finite(result.DownsideDeviation) {
		return Metrics{}, errors.New("returns are outside the numeric range")
	}
	if stddev > 0 {
		result.Sharpe = number((mean - riskFree) / stddev * annualScale)
	}
	if downside > 0 {
		result.Sortino = number((mean - target) / downside * annualScale)
	}
	years := points[len(points)-1].Time.Sub(points[0].Time).Hours() / (24 * DaysPerYear)
	result.CAGR = number(math.Expm1((math.Log(points[len(points)-1].Price) - math.Log(points[0].Price)) / years))
	if result.CAGR != nil && result.MaxDrawdown > 0 {
		result.Calmar = number(*result.CAGR / result.MaxDrawdown)
	}
	return result, nil
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func number(v float64) *float64 {
	if !finite(v) {
		return nil
	}
	return &v
}
