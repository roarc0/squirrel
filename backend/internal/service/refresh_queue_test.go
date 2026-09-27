package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/roarc0/squirrel/backend/internal/justetf"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	"github.com/roarc0/squirrel/backend/internal/store"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
	"github.com/roarc0/squirrel/proto/gen/go/v1/portv1connect"
)

func TestRefreshBatchContinuesAfterFailureAndIncludesNonUCITS(t *testing.T) {
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	for _, isin := range []string{"IE00B4L5Y983", "IE00B579F325", "IE00BK5BQT80"} {
		inst := portfolio.Instrument{ISIN: isin, Name: "ETF", InstrumentType: "etf", DataStatus: "catalog", FundCurrency: "EUR", Distribution: "accumulating", Replication: "physical_full"}
		if err := st.SaveInstrument(ctx, &inst); err != nil {
			t.Fatal(err)
		}
	}
	original := http.DefaultTransport
	http.DefaultTransport = refreshTransport(func(r *http.Request) (*http.Response, error) {
		status := http.StatusOK
		isin := r.URL.Query().Get("isin")
		if isin == "IE00B4L5Y983" {
			status = http.StatusInternalServerError
		}
		body := fmt.Sprintf(`<h1 data-testid="etf-profile-header_etf-name">ETF</h1>
  <div data-testid="etf-profile-header_isin-value">%s</div>
  <div data-testid="etf-profile-header_fund-size-value-wrapper">100</div>
  <div data-testid="tl_etf-basics_value_ter">0.14%%</div>
  <div data-testid="tl_etf-basics_value_replication">Physical</div>
  <div data-testid="tl_etf-basics_value_fund-currency">USD</div>
  <div data-testid="tl_etf-basics_value_launch-date">23 July 2019</div>
  <div data-testid="tl_etf-basics_value_distribution-policy">Accumulating</div>`, isin)
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = original })
	srv := &Server{store: st, justETF: justetf.New(0)}
	_, handler := portv1connect.NewInstrumentServiceHandler(srv)
	server := httptest.NewServer(handler)
	defer server.Close()
	client := portv1connect.NewInstrumentServiceClient(&http.Client{Transport: original}, server.URL)
	stream, err := client.StreamInstrumentCatalog(ctx, connect.NewRequest(&portv1.StreamInstrumentCatalogRequest{Mode: "missing"}))
	if err != nil {
		t.Fatal(err)
	}
	var last *portv1.EnrichmentProgress
	var failures int
	for stream.Receive() {
		last = stream.Msg()
		if last.GetError() != "" {
			failures++
		}
	}
	if err := stream.Err(); err != nil {
		t.Fatal(err)
	}
	if last == nil || !last.Done || last.Enriched != 2 || last.Failed != 1 || last.Skipped != 0 || failures != 1 {
		t.Fatalf("batch stopped or skipped products: %v", last)
	}
	pending, err := st.GetInstrumentByISIN(ctx, "IE00B4L5Y983")
	if err != nil || pending.DataStatus != "catalog" {
		t.Fatalf("failed profile falsely marked refreshed: %+v %v", pending, err)
	}
	saved, err := st.GetInstrumentByISIN(ctx, "IE00BK5BQT80")
	if err != nil || saved.DataStatus != "enriched" || saved.UCITS {
		t.Fatalf("non-UCITS profile not saved: %+v %v", saved, err)
	}
}
