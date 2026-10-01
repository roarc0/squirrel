package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/roarc0/squirrel/backend/internal/justetf"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	"github.com/roarc0/squirrel/backend/internal/store"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

func TestExpiredPerformanceRefreshesBeforeBacktest(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	const isin = "IE00BK5BQT80"
	inst := portfolio.Instrument{ISIN: isin, Name: "World", InstrumentType: "etf", FundCurrency: "EUR", Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull}
	if err := st.SaveInstrument(ctx, &inst); err != nil {
		t.Fatal(err)
	}
	if err := st.SavePerformance(ctx, isin, []portfolio.PerformancePoint{{Date: "2024-01-01", ChangeBPS: 0}, {Date: "2024-01-02", ChangeBPS: 100}}); err != nil {
		t.Fatal(err)
	}
	expire := func() {
		t.Helper()
		if _, err := st.DB().Exec(`UPDATE instrument_performance_meta SET fetched_at = '2000-01-01T00:00:00Z' WHERE isin = ?`, isin); err != nil {
			t.Fatal(err)
		}
	}
	expire()
	chart := `{"series":[{"date":"2024-01-01","value":{"raw":0}},{"date":"2024-01-02","value":{"raw":1}},{"date":"2024-01-03","value":{"raw":2}}]}`
	requests, status := 0, http.StatusOK
	original := http.DefaultTransport
	http.DefaultTransport = refreshTransport(func(r *http.Request) (*http.Response, error) {
		requests++
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(chart)), Request: r}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = original })
	srv := &Server{store: st, justETF: justetf.New(0)}
	request := connect.NewRequest(&portv1.RunBacktestRequest{Allocations: []*portv1.BacktestAllocation{{Isin: isin, WeightBps: 10000}}, InitialMinor: 10000})
	result, err := srv.RunBacktest(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Msg.EndDate != "2024-01-03" || requests == 0 {
		t.Fatal("backtest retained stale end date")
	}
	before := requests
	if _, err := srv.RunBacktest(ctx, request); err != nil {
		t.Fatal(err)
	}
	if requests != before {
		t.Fatal("fresh cached data should not be fetched again")
	}
	// Refreshing from the instrument page must immediately extend the same data
	// used by backtests, even while its previous cache is still within 24 hours.
	chart = strings.Replace(chart, `}]}`, `},{"date":"2024-01-04","value":{"raw":3}}]}`, 1)
	if _, err := srv.RefreshInstrumentPerformance(ctx, connect.NewRequest(&portv1.RefreshInstrumentPerformanceRequest{Isin: isin})); err != nil {
		t.Fatal(err)
	}
	result, err = srv.RunBacktest(ctx, request)
	if err != nil || result.Msg.EndDate != "2024-01-04" {
		t.Fatalf("explicit refresh not reflected: %v %v", result, err)
	}
	expire()
	status = http.StatusInternalServerError
	if _, err := srv.RunBacktest(ctx, request); err == nil {
		t.Fatal("failed refresh must not silently use stale history")
	}
	saved, err := st.GetPerformance(ctx, isin)
	if err != nil || len(saved) != 4 {
		t.Fatal("failed refresh lost saved history", err)
	}
}
