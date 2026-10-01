package backtest

import (
	"math"
	"testing"
	"time"

	"github.com/roarc0/squirrel/backend/pkg/riskmetrics"
)

func assetHistory(id string, start time.Time, count int, price func(int) float64) Asset {
	a := Asset{ID: id, Name: id}
	for i := 0; i < count; i++ {
		a.Points = append(a.Points, riskmetrics.Point{Time: start.AddDate(0, 0, i), Price: price(i)})
	}
	return a
}

func near(t *testing.T, got, want float64) {
	t.Helper()
	if !finite(got) || math.Abs(got-want) > 1e-9*math.Max(1, math.Abs(want)) {
		t.Fatalf("got %.15g, want %.15g", got, want)
	}
}

func TestDepositsAreNotPerformance(t *testing.T) {
	start := time.Date(2024, 1, 31, 0, 0, 0, 0, time.UTC)
	asset := assetHistory("a", start, 32, func(i int) float64 {
		if i == 0 {
			return 100
		}
		return 50
	})
	result, err := Run([]Asset{asset}, []Plan{{ID: "pac", Monthly: 100, Allocations: []Allocation{{"a", 1}}}}, Options{Rebalance: "none"})
	if err != nil {
		t.Fatal(err)
	}
	// Feb 1: old 100 loses 50; the next 100 deposit buys at the new close.
	d := result.Combined.Days[1]
	near(t, d.Value, 150)
	near(t, d.Contributed, 200)
	near(t, d.Index, .5)
	last := result.Combined.Days[31] // Mar 2, third deposit already invested
	near(t, last.Value, 250)
	near(t, last.Contributed, 300)
	near(t, last.Index, .5)
	a, err := Analyze(result.Combined.Days, Options{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, a.Metrics.MaxDrawdown, .5)
	if a.Metrics.CAGR != nil || a.XIRR != nil {
		t.Fatal("short periods must not show annual CAGR/XIRR")
	}
	if !a.Drawdowns.Unrecovered || a.Drawdowns.LongestDays != 31 {
		t.Fatalf("drawdown duration: %+v", a.Drawdowns)
	}
}

func TestCombinedUsesCapitalAndResidualCash(t *testing.T) {
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	assets := []Asset{assetHistory("a", start, 3, func(i int) float64 { return 100 * math.Pow(2, float64(i)) })}
	plans := []Plan{{ID: "small", Initial: 100, Allocations: []Allocation{{"a", 1}}}, {ID: "large", Initial: 900, Allocations: []Allocation{{"a", .5}}}}
	r, err := Run(assets, plans, Options{Rebalance: "none"})
	if err != nil {
		t.Fatal(err)
	}
	near(t, r.Portfolios[0].Days[1].Index, 2)
	near(t, r.Portfolios[1].Days[1].Value, 1350) // 450 cash + 900 invested
	near(t, r.Combined.Days[1].Value, 1550)
	near(t, r.Combined.Days[1].Index, 1.55) // capital-weighted, not average 1.75
}

func TestRebalancing(t *testing.T) {
	start := time.Date(2023, 12, 31, 0, 0, 0, 0, time.UTC)
	assets := []Asset{
		assetHistory("a", start, 3, func(i int) float64 {
			if i == 1 {
				return 200
			}
			return 100
		}),
		assetHistory("b", start, 3, func(i int) float64 { return 100 }),
	}
	plans := []Plan{{ID: "p", Initial: 100, Allocations: []Allocation{{"a", .5}, {"b", .5}}}}
	for _, schedule := range []string{"none", "monthly", "annually"} {
		r, err := Run(assets, plans, Options{Rebalance: schedule})
		if err != nil {
			t.Fatal(err)
		}
		want := 100.0
		if schedule != "none" {
			want = 112.5
		} // Jan 1: rebalance 150 to 75/75, then a halves
		near(t, r.Combined.Days[2].Value, want)
		near(t, r.Combined.Days[2].Contributed, 100)
	}
}

func TestJoinHistory(t *testing.T) {
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	a := assetHistory("a", start, 10, func(i int) float64 { return 100 })
	b := assetHistory("b", start.AddDate(0, 0, 3), 4, func(i int) float64 { return 200 })
	h, err := JoinHistory([]Asset{a, b}, start, start.AddDate(0, 0, 20))
	if err != nil {
		t.Fatal(err)
	}
	if len(h.Dates) != 4 || !h.Dates[0].Equal(b.Points[0].Time) || h.Levels["a"][0] != 100 {
		t.Fatalf("wrong common history: %+v", h)
	}
	a.Points = append(a.Points[:4:4], a.Points[5:]...)
	if _, err := JoinHistory([]Asset{a, b}, time.Time{}, time.Time{}); err == nil {
		t.Fatal("missing shared day accepted")
	}
	if _, err := JoinHistory([]Asset{a, b}, start.AddDate(0, 0, 5), time.Time{}); err != nil {
		t.Fatal("gap outside selected window should not exclude it", err)
	}
	for _, price := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		bad := assetHistory("a", start, 3, func(i int) float64 { return price })
		if _, err := JoinHistory([]Asset{bad}, time.Time{}, time.Time{}); err == nil {
			t.Fatal("invalid level accepted")
		}
	}
	if _, err := JoinHistory([]Asset{b}, start.AddDate(0, 0, 8), time.Time{}); err == nil {
		t.Fatal("nonoverlap accepted")
	}
	if _, err := JoinHistory([]Asset{b, b}, time.Time{}, time.Time{}); err == nil {
		t.Fatal("duplicate instrument accepted")
	}
}

func TestAnalyticsCalendarAndXIRR(t *testing.T) {
	start := time.Date(2022, 12, 31, 0, 0, 0, 0, time.UTC)
	asset := assetHistory("a", start, 800, func(i int) float64 { return 100 * math.Pow(1.1, float64(i)/365.25) })
	r, err := Run([]Asset{asset}, []Plan{{ID: "p", Initial: 1000, Monthly: 100, Allocations: []Allocation{{"a", 1}}}}, Options{Rebalance: "none"})
	if err != nil {
		t.Fatal(err)
	}
	a, err := Analyze(r.Combined.Days, Options{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, *a.XIRR, .1)
	near(t, a.DurationYears, 799/365.25)
	near(t, *a.Metrics.CAGR, .1)
	if !a.Months[0].Partial || a.Months[1].Partial || a.Months[1].Month != 1 {
		t.Fatalf("partial/calendar month handling: %+v", a.Months[:2])
	}
	near(t, a.Months[1].Return, math.Pow(1.1, 31/365.25)-1)
	if a.Years[1].Partial {
		t.Fatal("complete year marked partial")
	}
	near(t, a.Years[1].Return, math.Pow(1.1, 365/365.25)-1)
	near(t, *a.Monthly.PositiveFraction, 1)
	near(t, *a.Monthly.VaR95, 0)
	near(t, a.Rolling[0].Points[0].Return, .1)
	if len(a.Rolling[1].Points) != 0 || a.HoldingPeriods[1].WorstReturn != nil {
		t.Fatal("invented unavailable 3Y history")
	}
	near(t, *a.HoldingPeriods[0].NonnegativeFraction, 1)
	leap := time.Date(2024, 2, 29, 0, 0, 0, 0, time.UTC)
	if got := anniversary(leap, -1).Format(time.DateOnly); got != "2023-02-28" {
		t.Fatal(got)
	}
}

func TestCorrelationAndMonthlyTails(t *testing.T) {
	start := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	x, y := 100.0, 100.0
	a := assetHistory("a", start, 40, func(i int) float64 {
		if i > 0 {
			x *= 1 + float64(i%3-1)*.01
		}
		return x
	})
	b := assetHistory("b", start, 40, func(i int) float64 {
		if i > 0 {
			y *= 1 - float64(i%3-1)*.01
		}
		return y
	})
	flat := assetHistory("flat", start, 40, func(i int) float64 { return 100 })
	h, err := JoinHistory([]Asset{a, b, flat}, time.Time{}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	c := Correlations(h, 0)
	if c.Observations != 39 {
		t.Fatal(c.Observations)
	}
	near(t, *c.Pairs[0].Value, 1)
	near(t, *c.Pairs[1].Value, -1)
	if c.Pairs[len(c.Pairs)-1].Value != nil || Correlations(h, 1).Observations != 0 {
		t.Fatal("constant/short correlation should be undefined")
	}
	months := []MonthReturn{{Return: -1, Partial: true}}
	for i := 0; i < 12; i++ {
		months = append(months, MonthReturn{Return: float64(i-6) / 100})
	}
	m := monthlyStatistics(months)
	if m.Count != 12 {
		t.Fatal(m.Count)
	}
	near(t, *m.VaR95, .0545)
	near(t, *m.VaR99, .0589)
	near(t, *m.PositiveFraction, 5.0/12)
}

func TestSimulationValidation(t *testing.T) {
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	assets := []Asset{assetHistory("a", start, 3, func(i int) float64 { return 100 })}
	for _, plan := range []Plan{
		{ID: "p", Monthly: 0, Allocations: []Allocation{{"a", 1}}},
		{ID: "p", Monthly: math.NaN(), Allocations: []Allocation{{"a", 1}}},
		{ID: "p", Monthly: 100, Allocations: []Allocation{{"a", 1.1}}},
		{ID: "p", Monthly: 100, Allocations: []Allocation{{"a", .5}, {"a", .5}}},
		{ID: "p", Monthly: 100, Allocations: []Allocation{{"missing", 1}}},
	} {
		if _, err := Run(assets, []Plan{plan}, Options{Rebalance: "none"}); err == nil {
			t.Fatalf("invalid plan accepted: %+v", plan)
		}
	}
}
