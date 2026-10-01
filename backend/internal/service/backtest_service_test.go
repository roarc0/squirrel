package service

import (
	"context"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	"github.com/roarc0/squirrel/backend/internal/store"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
	"github.com/roarc0/squirrel/proto/gen/go/v1/portv1connect"
)

func TestBacktestAPI(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	const isin = "IE00BK5BQT80"
	inst := portfolio.Instrument{ISIN: isin, Name: "World", InstrumentType: "etf", Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull, FundCurrency: "USD"}
	if err := st.SaveInstrument(ctx, &inst); err != nil {
		t.Fatal(err)
	}
	start := time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)
	points := make([]portfolio.PerformancePoint, 800)
	for i := range points {
		points[i] = portfolio.PerformancePoint{Date: start.AddDate(0, 0, i).Format(time.DateOnly), ChangeBPS: int64(i*5 - i%7*20)}
	}
	if err := st.SavePerformance(ctx, isin, points); err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for i, owner := range []string{"", "", "other"} {
		account := portfolio.Account{Name: "PAC", Type: "broker", Currency: "EUR", PACAmountMinor: int64((i + 1) * 10000)}
		if err := st.SaveAccount(ctx, &account, owner); err != nil {
			t.Fatal(err)
		}
		if err := st.SaveHolding(ctx, &portfolio.Holding{AccountID: account.ID, InstrumentID: inst.ID, PACBPS: 8000, PACFrequency: "monthly"}); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, account.ID)
	}
	// Generated routing exercises JSON/protobuf optional fields; a nil provider
	// ensures this test cannot accidentally fetch remotely when cached data exists.
	_, handler := portv1connect.NewBacktestServiceHandler(&Server{store: st})
	srv := httptest.NewServer(handler)
	defer srv.Close()
	client := portv1connect.NewBacktestServiceClient(http.DefaultClient, srv.URL)
	request := &portv1.RunBacktestRequest{AccountIds: ids[:2], InitialMinor: 60000, Rebalance: "annually", RiskFreeRate: .02, TargetReturn: .01}
	res, err := client.RunBacktest(ctx, connect.NewRequest(request))
	if err != nil {
		t.Fatal(err)
	}
	r := res.Msg
	if math.Abs(r.Combined.DurationYears-799/365.25) > 1e-12 {
		t.Fatalf("incorrect elapsed years: %v", r.Combined.DurationYears)
	}
	if r.StartDate != points[0].Date || r.EndDate != points[len(points)-1].Date {
		t.Fatalf("empty date bounds must select maximum saved history: %s to %s", r.StartDate, r.EndDate)
	}
	if r.Currency != "EUR" || r.Rebalance != "annually" || len(r.Portfolios) != 2 || len(r.Coverage) != 1 || len(r.Combined.Series) != 800 || len(r.Combined.Months) == 0 || r.Combined.Metrics == nil || r.Combined.Xirr == nil {
		t.Fatalf("incomplete result: %v", r)
	}
	if r.Plans[0].Initial != 200 || r.Plans[1].Initial != 400 {
		t.Fatalf("initial lump sum not split by budgets: %v", r.Plans)
	}
	for i, day := range r.Combined.Series {
		want := r.Portfolios[0].Series[i].Value + r.Portfolios[1].Series[i].Value
		if math.Abs(day.Value-want) > 1e-8 {
			t.Fatal("combined values do not add up")
		}
	}
	if r.Combined.MonthlyVar95 == nil || r.Correlations[0].Observations != 799 {
		t.Fatal("missing monthly/correlation analysis")
	}
	// A custom portfolio can use the same saved instrument with a partial cash allocation.
	custom, err := client.RunBacktest(ctx, connect.NewRequest(&portv1.RunBacktestRequest{Allocations: []*portv1.BacktestAllocation{{Isin: isin, WeightBps: 6000}}, InitialMinor: 10000, StartDate: "2022-01-01", EndDate: "2023-02-01"}))
	if err != nil {
		t.Fatal(err)
	}
	if custom.Msg.StartDate != "2023-01-01" || custom.Msg.EndDate != "2023-02-01" || len(custom.Msg.Notes) == 0 || custom.Msg.Combined.Xirr != nil || custom.Msg.Combined.Metrics.Cagr != nil {
		t.Fatal("custom range/coverage handling failed")
	}
	for _, tc := range []struct {
		request *portv1.RunBacktestRequest
		code    connect.Code
	}{
		{&portv1.RunBacktestRequest{AccountIds: ids[2:]}, connect.CodeNotFound},
		{&portv1.RunBacktestRequest{AccountIds: []int64{999999}}, connect.CodeNotFound},
		{&portv1.RunBacktestRequest{AccountIds: []int64{ids[0], ids[0]}}, connect.CodeInvalidArgument},
		{&portv1.RunBacktestRequest{}, connect.CodeInvalidArgument},
		{&portv1.RunBacktestRequest{AccountIds: ids[:1], MonthlyMinor: 1}, connect.CodeInvalidArgument},
		{&portv1.RunBacktestRequest{AccountIds: ids[:1], RiskFreeRate: math.NaN()}, connect.CodeInvalidArgument},
		{&portv1.RunBacktestRequest{AccountIds: ids[:1], Rebalance: "sometimes"}, connect.CodeInvalidArgument},
		{&portv1.RunBacktestRequest{AccountIds: ids[:1], InitialMinor: -1}, connect.CodeInvalidArgument},
		{&portv1.RunBacktestRequest{AccountIds: ids[:1], StartDate: "2023-02-30"}, connect.CodeInvalidArgument},
		{&portv1.RunBacktestRequest{AccountIds: ids[:1], StartDate: "2024-01-01", EndDate: "2023-01-01"}, connect.CodeInvalidArgument},
		{&portv1.RunBacktestRequest{Allocations: []*portv1.BacktestAllocation{{Isin: isin, WeightBps: 10001}}, MonthlyMinor: 100}, connect.CodeInvalidArgument},
		{&portv1.RunBacktestRequest{Allocations: []*portv1.BacktestAllocation{{Isin: isin, WeightBps: 10000}}}, connect.CodeInvalidArgument},
	} {
		_, err := client.RunBacktest(ctx, connect.NewRequest(tc.request))
		if connect.CodeOf(err) != tc.code {
			t.Errorf("%v: got %v, want %v", tc.request, err, tc.code)
		}
	}
	if _, err := st.DB().Exec(`UPDATE accounts SET currency = 'USD' WHERE id = ?`, ids[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := client.RunBacktest(ctx, connect.NewRequest(&portv1.RunBacktestRequest{AccountIds: ids[:1]})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatal("silently converted non-EUR budget", err)
	}
	if _, err := st.DB().Exec(`DELETE FROM instrument_performance WHERE isin = ? AND date = '2023-02-10'`, isin); err != nil {
		t.Fatal(err)
	}
	if _, err := client.RunBacktest(ctx, connect.NewRequest(&portv1.RunBacktestRequest{AccountIds: ids[1:2]})); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatal("missing history should block the run", err)
	}
}
