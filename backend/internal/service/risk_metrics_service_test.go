package service

import (
	"context"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	"github.com/roarc0/squirrel/backend/internal/store"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
	"github.com/roarc0/squirrel/proto/gen/go/v1/portv1connect"
)

func TestInstrumentRiskMetricsAPI(t *testing.T) {
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	const isin = "IE00BK5BQT80"
	inst := portfolio.Instrument{ISIN: isin, Name: "Test", InstrumentType: "etf", FundCurrency: "USD",
		Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull}
	if err := st.SaveInstrument(ctx, &inst); err != nil {
		t.Fatal(err)
	}
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	points := make([]portfolio.PerformancePoint, 401)
	for i := range points {
		bps := int64(0)
		switch {
		case i >= 300:
			bps = 3200 // level 132, new high
		case i >= 200:
			bps = -400 // level 96, 20% below the preceding 120 peak
		case i >= 100:
			bps = 2000 // level 120
		}
		points[i] = portfolio.PerformancePoint{Date: start.AddDate(0, 0, i).Format(time.DateOnly), ChangeBPS: bps}
	}
	if err := st.SavePerformance(ctx, isin, points); err != nil {
		t.Fatal(err)
	}
	// Exercise generated Connect routing and serialization. No provider client
	// is configured: saved history must be enough, including after a refresh.
	_, handler := portv1connect.NewInstrumentServiceHandler(&Server{store: st})
	server := httptest.NewServer(handler)
	defer server.Close()
	client := portv1connect.NewInstrumentServiceClient(http.DefaultClient, server.URL)
	get := func(req *portv1.GetInstrumentRiskMetricsRequest) *portv1.GetInstrumentRiskMetricsResponse {
		t.Helper()
		res, err := client.GetInstrumentRiskMetrics(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg
	}
	res := get(&portv1.GetInstrumentRiskMetricsRequest{Isin: " ie00bk5bqt80 "})
	m := res.Metrics
	if m == nil || m.Sharpe == nil || m.Sortino == nil || m.Calmar == nil || m.Cagr == nil {
		t.Fatalf("expected complete metrics: %v", res)
	}
	if math.Abs(m.MaxDrawdown-.2) > 1e-12 || math.Abs(m.TotalReturn-.32) > 1e-12 || math.Abs(m.UlcerIndex-math.Sqrt(100*.04/401)) > 1e-12 {
		t.Fatalf("incorrect cumulative-to-daily conversion: %v", m)
	}
	if math.Abs(*m.Cagr-(math.Pow(1.32, 365.25/400)-1)) > 1e-12 {
		t.Fatalf("CAGR must use elapsed calendar time: %v", m)
	}
	if res.PointCount != 401 || res.PeriodsPerYear != 365.25 || res.Currency != "EUR" || res.FetchedAt == "" || res.Note != "" {
		t.Fatalf("incorrect metadata: %v", res)
	}
	res = get(&portv1.GetInstrumentRiskMetricsRequest{Isin: isin, StartDate: points[200].Date, EndDate: points[300].Date})
	if res.PointCount != 101 || res.StartDate != points[200].Date || res.EndDate != points[300].Date || res.Metrics.MaxDrawdown != 0 || res.Metrics.Sortino != nil || res.Metrics.Calmar != nil || res.Metrics.Cagr != nil || res.Note == "" {
		t.Fatalf("window must reset peaks and omit unavailable ratios: %v", res)
	}
	for _, bounds := range [][2]string{{points[0].Date, points[29].Date}, {"2030-01-01", "2030-02-01"}} {
		res = get(&portv1.GetInstrumentRiskMetricsRequest{Isin: isin, StartDate: bounds[0], EndDate: bounds[1]})
		if res.Metrics != nil || res.Note == "" {
			t.Fatalf("short/empty history must explain missing metrics: %v", res)
		}
	}
	res = get(&portv1.GetInstrumentRiskMetricsRequest{Isin: isin, StartDate: points[0].Date, EndDate: points[30].Date})
	if res.Metrics == nil || res.Metrics.Sharpe != nil || res.Metrics.Volatility != 0 {
		t.Fatalf("flat history must serialize zero risk and absent ratios: %v", res)
	}
	res = get(&portv1.GetInstrumentRiskMetricsRequest{Isin: isin, RiskFreeRate: .03, TargetReturn: .02})
	if res.RiskFreeRate != .03 || res.TargetReturn != .02 || *res.Metrics.Sharpe >= *m.Sharpe || *res.Metrics.Sortino >= *m.Sortino {
		t.Fatalf("annual rate assumptions not applied: %v", res)
	}
	for _, req := range []*portv1.GetInstrumentRiskMetricsRequest{
		{Isin: "bad"},
		{Isin: isin, StartDate: "2024-02-30"},
		{Isin: isin, EndDate: "yesterday"},
		{Isin: isin, StartDate: "2025-01-01", EndDate: "2024-01-01"},
		{Isin: isin, RiskFreeRate: -1},
		{Isin: isin, TargetReturn: math.NaN()},
		{Isin: isin, RiskFreeRate: math.Inf(1)},
	} {
		_, err := client.GetInstrumentRiskMetrics(ctx, connect.NewRequest(req))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("request %v: expected invalid argument, got %v", req, err)
		}
	}
	// Freshly saved observations are used on the next call; no derived cache.
	if err := st.SavePerformance(ctx, isin, []portfolio.PerformancePoint{{Date: start.AddDate(0, 0, 401).Format(time.DateOnly), ChangeBPS: 4000}}); err != nil {
		t.Fatal(err)
	}
	if res := get(&portv1.GetInstrumentRiskMetricsRequest{Isin: isin}); res.PointCount != 402 || math.Abs(res.Metrics.TotalReturn-.4) > 1e-12 {
		t.Fatalf("metrics did not use refreshed history: %v", res)
	}
	if _, err := st.DB().Exec(`UPDATE instrument_performance SET change_bps = -10000 WHERE isin = ? AND date = ?`, isin, points[200].Date); err != nil {
		t.Fatal(err)
	}
	if res := get(&portv1.GetInstrumentRiskMetricsRequest{Isin: isin}); res.Metrics != nil || !strings.Contains(res.Note, "invalid observation") {
		t.Fatalf("nonpositive index level must not produce metrics: %v", res)
	}
	if _, err := st.DB().Exec(`DELETE FROM instrument_performance WHERE isin = ? AND date = ?`, isin, points[200].Date); err != nil {
		t.Fatal(err)
	}
	if res := get(&portv1.GetInstrumentRiskMetricsRequest{Isin: isin}); res.Metrics != nil || !strings.Contains(res.Note, "missing calendar days") {
		t.Fatalf("missing dates must not be counted as daily returns: %v", res)
	}
}
