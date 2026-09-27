package service

import (
	"context"
	"io"
	"net/http"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/roarc0/squirrel/backend/internal/justetf"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	"github.com/roarc0/squirrel/backend/internal/store"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

type refreshTransport func(*http.Request) (*http.Response, error)

func (f refreshTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRefreshPersistsAcrossRestart(t *testing.T) {
	ctx := context.Background()
	const isin = "IE00BK5BQT80"
	profile := `<h1 data-testid="etf-profile-header_etf-name">Vanguard FTSE All-World UCITS ETF</h1>
	<span data-testid="etf-profile-header_isin-value">IE00BK5BQT80</span>
	<div data-testid="etf-profile-header_fund-size-value-wrapper">48,874</div>
	<div data-testid="tl_etf-basics_value_index-name">FTSE All-World</div>
	<div data-testid="tl_etf-basics_value_ter">0.14%</div>
	<div data-testid="tl_etf-basics_value_replication">Physical</div>
	<div data-testid="tl_etf-basics_value_fund-currency">USD</div>
	<div data-testid="tl_etf-basics_value_launch-date">23 July 2019</div>
	<div data-testid="tl_etf-basics_value_distribution-policy">Accumulating</div>
	<table><tr><td>UCITS compliance</td><td>Yes</td></tr></table>`
	chart := `{"series":[{"date":"2026-09-01","value":{"raw":0}},{"date":"2026-09-02","value":{"raw":1.5}}]}`
	status, requests := http.StatusOK, 0
	original := http.DefaultTransport
	http.DefaultTransport = refreshTransport(func(r *http.Request) (*http.Response, error) {
		requests++
		body := profile
		if strings.Contains(r.URL.Path, "performance-chart") {
			body = chart
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = original })
	path := filepath.Join(t.TempDir(), "squirrel.db")
	st, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { st.Close() }()
	srv := &Server{store: st, justETF: justetf.New(0)}
	lookup, err := srv.LookupInstrument(ctx, connect.NewRequest(&portv1.LookupInstrumentRequest{Query: isin}))
	if err != nil {
		t.Fatal(err)
	}
	saved := instrumentFromProto(lookup.Msg.Instrument)
	if saved.DataStatus != "enriched" || saved.RefreshedAt == "" {
		t.Fatalf("refresh not saved: %+v", saved)
	}
	first, err := srv.GetInstrumentPerformance(ctx, connect.NewRequest(&portv1.GetInstrumentPerformanceRequest{Isin: isin}))
	if err != nil || first.Msg.PointCount != 2 {
		t.Fatalf("first chart: %v %v", first, err)
	}
	// A catalog sync must not replace a saved profile with incomplete fields.
	catalog := saved
	catalog.DataStatus, catalog.IndexName, catalog.TERBPS = "catalog", "", 99
	if _, err := st.SaveInstrumentCatalogBatch(ctx, []portfolio.Instrument{catalog}); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveInstrument(ctx, &catalog); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(saved, catalog) {
		t.Fatalf("catalog overwrote profile: %+v", catalog)
	}
	// An explicit refresh must report provider errors, not silently return old data.
	status = http.StatusInternalServerError
	if _, err := srv.LookupInstrument(ctx, connect.NewRequest(&portv1.LookupInstrumentRequest{Query: isin})); err == nil {
		t.Fatal("failed lookup reported success")
	}
	status = http.StatusOK
	if _, err := st.DB().Exec(`CREATE TRIGGER reject_profile BEFORE UPDATE ON instruments BEGIN SELECT RAISE(ABORT, 'disk write failed'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.LookupInstrument(ctx, connect.NewRequest(&portv1.LookupInstrumentRequest{Query: isin})); err == nil {
		t.Fatal("failed database write reported success")
	}
	if _, err := st.DB().Exec(`DROP TRIGGER reject_profile`); err != nil {
		t.Fatal(err)
	}
	chart = `{"series":[{"date":"2026-09-02","value":{"raw":99}},{"date":"2026-09-03","value":{"raw":2}}]}`
	for range 2 {
		res, err := srv.RefreshInstrumentPerformance(ctx, connect.NewRequest(&portv1.RefreshInstrumentPerformanceRequest{Isin: isin}))
		if err != nil {
			t.Fatal(err)
		}
		if res.Msg.PointCount != 3 || len(res.Msg.Series) != 3 || res.Msg.Series[1].ChangeBps != 150 {
			t.Fatalf("history replaced or duplicated: %v", res.Msg)
		}
	}
	before, err := st.GetPerformanceMeta(ctx, isin)
	if err != nil {
		t.Fatal(err)
	}
	// Even if a point was inserted first, a metadata failure must roll it back.
	if _, err := st.DB().Exec(`CREATE TRIGGER reject_chart BEFORE UPDATE ON instrument_performance_meta BEGIN SELECT RAISE(ABORT, 'disk write failed'); END`); err != nil {
		t.Fatal(err)
	}
	chart = `{"series":[{"date":"2026-09-04","value":{"raw":3}}]}`
	if _, err := srv.RefreshInstrumentPerformance(ctx, connect.NewRequest(&portv1.RefreshInstrumentPerformanceRequest{Isin: isin})); err == nil {
		t.Fatal("failed chart write reported success")
	}
	if _, err := st.DB().Exec(`DROP TRIGGER reject_chart`); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{`{"series":[]}`, `{"series":[{"date":"2026-09-04","value":{}}]}`, `{"series":[{"date":"bad-date","value":{"raw":3}}]}`} {
		chart = invalid
		if _, err := srv.RefreshInstrumentPerformance(ctx, connect.NewRequest(&portv1.RefreshInstrumentPerformanceRequest{Isin: isin})); err == nil {
			t.Fatal("invalid chart accepted")
		}
	}
	after, err := st.GetPerformanceMeta(ctx, isin)
	if err != nil || before != after {
		t.Fatalf("failed refresh changed metadata: %v %v", after, err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	st, err = store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	srv = &Server{store: st, justETF: justetf.New(0)}
	loaded, err := st.GetInstrumentByISIN(ctx, isin)
	if err != nil || !reflect.DeepEqual(loaded, saved) {
		t.Fatalf("profile lost on restart: %+v %v", loaded, err)
	}
	requestCount := requests
	res, err := srv.GetInstrumentPerformance(ctx, connect.NewRequest(&portv1.GetInstrumentPerformanceRequest{Isin: isin}))
	if err != nil || res.Msg.PointCount != 3 || len(res.Msg.Series) != 3 || res.Msg.Series[1].ChangeBps != 150 || requests != requestCount {
		t.Fatalf("chart lost or fetched again after restart: %v %v", res, err)
	}
}
