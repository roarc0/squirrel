package riskmetrics

import (
	"math"
	"testing"
	"time"
)

func TestCalculate(t *testing.T) {
	start := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	points := make([]Point, 4)
	for i, price := range []float64{100, 110, 88, 110} {
		points[i] = Point{Time: start.Add(time.Duration(i) * 8766 * time.Hour), Price: price}
	}
	// Three annual returns: +10%, -20%, +25%. Mean=5%, sample
	// variance=.0525, downside mean square=.04/3, drawdowns=[0,0,.2,0].
	m, err := Calculate(points, Options{PeriodsPerYear: 1})
	if err != nil {
		t.Fatal(err)
	}
	closeTo := func(name string, got, want float64) {
		t.Helper()
		if math.IsNaN(got) || math.Abs(got-want) > 1e-12 {
			t.Errorf("%s = %.15g, want %.15g", name, got, want)
		}
	}
	closeTo("total return", m.TotalReturn, .1)
	closeTo("volatility", m.Volatility, math.Sqrt(.0525))
	closeTo("downside", m.DownsideDeviation, math.Sqrt(.04/3))
	closeTo("max drawdown", m.MaxDrawdown, .2)
	closeTo("ulcer", m.UlcerIndex, .1)
	if m.Sharpe == nil || m.Sortino == nil || m.CAGR == nil || m.Calmar == nil {
		t.Fatalf("expected defined ratios: %+v", m)
	}
	closeTo("sharpe", *m.Sharpe, .05/math.Sqrt(.0525))
	closeTo("sortino", *m.Sortino, .05/math.Sqrt(.04/3))
	closeTo("CAGR", *m.CAGR, math.Cbrt(1.1)-1)
	closeTo("calmar", *m.Calmar, (math.Cbrt(1.1)-1)/.2)

	// Sampling frequency is explicit; effective annual rates are converted
	// to matching period rates before subtracting from simple returns.
	m, err = Calculate(points, Options{PeriodsPerYear: 12, RiskFreeRate: math.Pow(1.02, 12) - 1, TargetReturn: math.Pow(1.05, 12) - 1})
	if err != nil {
		t.Fatal(err)
	}
	closeTo("annual volatility", m.Volatility, math.Sqrt(.0525*12))
	closeTo("annual downside", m.DownsideDeviation, .5)
	closeTo("excess sharpe", *m.Sharpe, .03/math.Sqrt(.0525)*math.Sqrt(12))
	closeTo("target sortino", *m.Sortino, 0)
	closeTo("CAGR uses elapsed time, not frequency", *m.CAGR, math.Cbrt(1.1)-1)

	for i := range points {
		points[i].Price *= 7
	}
	scaled, err := Calculate(points, Options{PeriodsPerYear: 1})
	if err != nil {
		t.Fatal(err)
	}
	closeTo("scale invariant ulcer", scaled.UlcerIndex, .1)
	closeTo("scale invariant volatility", scaled.Volatility, math.Sqrt(.0525))
}

func TestCalculateEdgeCases(t *testing.T) {
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name   string
		prices []float64
	}{
		{"flat", []float64{100, 100, 100, 100}},
		{"rising", []float64{100, 110, 130, 170}},
		{"falling", []float64{100, 90, 70, 50}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			points := make([]Point, len(tc.prices))
			for i, price := range tc.prices {
				points[i] = Point{Time: start.AddDate(i, 0, 0), Price: price}
			}
			m, err := Calculate(points, Options{PeriodsPerYear: 1})
			if err != nil {
				t.Fatal(err)
			}
			if tc.name == "flat" && (m.Sharpe != nil || m.Volatility != 0 || *m.CAGR != 0) {
				t.Fatalf("flat prices: %+v", m)
			}
			if tc.name != "falling" && (m.Sortino != nil || m.Calmar != nil || m.MaxDrawdown != 0 || m.UlcerIndex != 0) {
				t.Fatalf("no downside: %+v", m)
			}
			if tc.name == "falling" && (m.MaxDrawdown != .5 || *m.Sharpe >= 0 || *m.Sortino >= 0 || *m.Calmar >= 0) {
				t.Fatalf("falling prices: %+v", m)
			}
		})
	}
	valid := []Point{{Time: start, Price: 100}, {Time: start.AddDate(0, 0, 1), Price: 101}, {Time: start.AddDate(0, 0, 2), Price: 102}}
	for _, tc := range []struct {
		name string
		edit func([]Point, *Options) []Point
	}{
		{"empty", func(p []Point, o *Options) []Point { return nil }},
		{"one return", func(p []Point, o *Options) []Point { return p[:2] }},
		{"zero price", func(p []Point, o *Options) []Point { p[1].Price = 0; return p }},
		{"negative price", func(p []Point, o *Options) []Point { p[1].Price = -1; return p }},
		{"NaN", func(p []Point, o *Options) []Point { p[1].Price = math.NaN(); return p }},
		{"infinity", func(p []Point, o *Options) []Point { p[1].Price = math.Inf(1); return p }},
		{"overflow", func(p []Point, o *Options) []Point { p[1].Price = math.SmallestNonzeroFloat64; return p }},
		{"missing date", func(p []Point, o *Options) []Point { p[0].Time = time.Time{}; return p }},
		{"duplicate date", func(p []Point, o *Options) []Point { p[1].Time = p[0].Time; return p }},
		{"unsorted", func(p []Point, o *Options) []Point { p[0], p[1] = p[1], p[0]; return p }},
		{"zero frequency", func(p []Point, o *Options) []Point { o.PeriodsPerYear = 0; return p }},
		{"infinite frequency", func(p []Point, o *Options) []Point { o.PeriodsPerYear = math.Inf(1); return p }},
		{"invalid risk free", func(p []Point, o *Options) []Point { o.RiskFreeRate = -1; return p }},
		{"invalid target", func(p []Point, o *Options) []Point { o.TargetReturn = math.NaN(); return p }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o := Options{PeriodsPerYear: DaysPerYear}
			points := tc.edit(append([]Point(nil), valid...), &o)
			if _, err := Calculate(points, o); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}
