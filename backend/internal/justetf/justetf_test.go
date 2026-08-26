package justetf

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"squirrel/backend/internal/portfolio"
)

func TestProfileRequestsAreRateLimited(t *testing.T) {
	client := &Client{profileInterval: 30 * time.Millisecond}
	if err := client.waitForProfile(context.Background()); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if err := client.waitForProfile(context.Background()); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed < 25*time.Millisecond {
		t.Fatalf("second profile request waited only %s", elapsed)
	}
}

func TestProfileBlockIsRecognized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()
	client := &Client{baseURL: server.URL, timeout: time.Second}
	_, err := client.Lookup(context.Background(), "IE00BK5BQT80")
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("expected rate limit error, got %v", err)
	}
}

func TestLookupByTicker(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /en/search.html", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<script>{"fetchCallbackUrl":"/search-results","etfsParams":"query=VWCE&ls=any"}</script>`)
	})
	mux.HandleFunc("POST /search-results", func(w http.ResponseWriter, r *http.Request) {
		if r.FormValue("etfsParams") != "query=VWCE&ls=any" || r.Header.Get("Wicket-Ajax") != "true" {
			t.Fatalf("unexpected search request: form=%v headers=%v", r.Form, r.Header)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[
			{"ticker":"VWCE","isin":"IE00BK5BQT80","name":"Vanguard FTSE All-World UCITS ETF (USD) Accumulating","distributionPolicy":"Accumulating","replicationMethod":"Optimized sampling","domicileCountry":"Ireland","fundCurrency":"USD","ter":"0.14%","fundSize":"48,874","inceptionDate":"23.07.19"},
			{"ticker":"GOLD","isin":"IE00B4ND3602","name":"Physical Gold ETC","distributionPolicy":"Accumulating","replicationMethod":"Physical","domicileCountry":"Ireland","fundCurrency":"USD","ter":"0.12%","fundSize":"1,000","inceptionDate":"23.07.19"}
		]}`)
	})
	mux.HandleFunc("GET /en/etf-profile.html", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, profileFixture("IE00BK5BQT80", "Vanguard FTSE All-World UCITS ETF (USD) Accumulating", "VWCE", "Equity, World", "Yes"))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := &Client{baseURL: server.URL, timeout: time.Second}
	etf, err := client.Lookup(context.Background(), "vwce")
	if err != nil {
		t.Fatal(err)
	}
	if etf.ISIN != "IE00BK5BQT80" || etf.Ticker != "VWCE" || etf.Provider != "Vanguard" || etf.IndexName != "FTSE All-World" || etf.InvestmentFocus != "Equity, World" || etf.AssetClass != "equity" || etf.Strategy != "broad" || etf.DataStatus != portfolio.InstrumentStatusEnriched || etf.EnrichedAt == "" || etf.CurrencyHedged || etf.Distribution != portfolio.DistributionAccumulating || etf.Replication != portfolio.ReplicationSampling || etf.Domicile != "IE" || etf.FundCurrency != "USD" || etf.TERBPS != 14 || etf.FundSizeMillion != 48_874 || etf.InceptionDate != "2019-07-23" || !etf.UCITS {
		t.Fatalf("unexpected ETF: %+v", etf)
	}
	results, err := client.Search(context.Background(), "world")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 || results[0].ISIN != "IE00BK5BQT80" || !results[0].UCITS || results[1].UCITS {
		t.Fatalf("unexpected search results: %+v", results)
	}
}

func TestLookupAllowsNonUCITSETC(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, profileFixture("IE00B579F325", "Invesco Physical Gold ETC", "SGLD", "Commodities, Gold", "No"))
	}))
	defer server.Close()
	client := &Client{baseURL: server.URL, timeout: time.Second}
	etf, err := client.Lookup(context.Background(), "IE00B579F325")
	if err != nil {
		t.Fatal(err)
	}
	if etf.UCITS || etf.InstrumentType != portfolio.InstrumentTypeETC || etf.AssetClass != "commodity" || etf.Name != "Invesco Physical Gold ETC" {
		t.Fatalf("unexpected non-UCITS product: %+v", etf)
	}
}

func TestSearchRejectsCrossOriginCallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `<script>{"fetchCallbackUrl":"https://evil.example/collect","etfsParams":"query=test"}</script>`)
	}))
	defer server.Close()
	client := &Client{baseURL: server.URL, timeout: time.Second}
	if _, err := client.Search(context.Background(), "test"); err == nil {
		t.Fatal("cross-origin callback accepted")
	}
}

func profileFixture(isin, name, ticker, focus, ucits string) string {
	provider, index := "Invesco", "LBMA Gold Price"
	if ticker == "VWCE" {
		provider, index = "Vanguard", "FTSE All-World"
	}
	return fmt.Sprintf(`<html><body>
		<h1 data-testid="etf-profile-header_etf-name">%s</h1>
		<span data-testid="etf-profile-header_isin-value">%s</span>
		<span data-testid="etf-profile-header_identifier-value-ticker">%s</span>
		<div data-testid="etf-profile-header_fund-size-value-wrapper"><span>EUR 48,874 m</span></div>
		<div data-testid="tl_etf-basics_value_index-name">%s</div>
		<div data-testid="tl_etf-basics_value_investment-focus">%s</div>
		<div data-testid="tl_etf-basics_value_currency-hedge">Currency unhedged</div>
		<div data-testid="tl_etf-basics_value_ter">0.14%% p.a.</div>
		<span data-testid="tl_etf-basics_value_replication">Physical</span>
		<span data-testid="tl_etf-basics_value_replication-method">Optimized sampling</span>
		<div data-testid="tl_etf-basics_value_fund-currency">USD</div>
		<div data-testid="tl_etf-basics_value_launch-date">23 July 2019</div>
		<div data-testid="tl_etf-basics_value_distribution-policy">Accumulating</div>
		<div data-testid="tl_etf-basics_value_domicile-country">Ireland</div>
		<div data-testid="tl_etf-basics_value_fund-provider">%s</div>
		<table><tr><td>UCITS compliance</td><td>%s</td></tr></table>
	</body></html>`, name, isin, ticker, index, focus, provider, ucits)
}

func TestCatalogUsesETFScreenAndKeepsOnlyUCITS(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /en/search.html", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<script>var etfsParams = 'search=ETFS&query='; var fetchCallbackUrl = '/catalog-results';</script>`)
	})
	mux.HandleFunc("POST /catalog-results", func(w http.ResponseWriter, r *http.Request) {
		if r.FormValue("start") != "0" || r.FormValue("length") != "2" || r.Header.Get("Wicket-Ajax-BaseURL") != "en/search.html?search=ETFS" {
			t.Fatalf("unexpected catalog request: form=%v headers=%v", r.Form, r.Header)
		}
		fmt.Fprint(w, `{"recordsFiltered":2,"data":[
			{"ticker":"VWCE","isin":"IE00BK5BQT80","name":"Vanguard FTSE All-World UCITS ETF (USD) Accumulating","distributionPolicy":"Accumulating","replicationMethod":"Optimized sampling","domicileCountry":"Ireland","fundCurrency":"USD<br />Hedged","ter":"0.22%","fundSize":"12,000","inceptionDate":"23.07.19"},
			{"ticker":"GOLD","isin":"IE00B4ND3602","name":"Physical Gold ETC","distributionPolicy":"Accumulating","replicationMethod":"Physical","domicileCountry":"Ireland","fundCurrency":"USD","ter":"0.12%","fundSize":"1,000","inceptionDate":"23.07.19"}
		]}`)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := &Client{baseURL: server.URL, timeout: time.Second}
	etfs, total, err := client.Catalog(context.Background(), 2)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(etfs) != 1 || etfs[0].DataStatus != portfolio.InstrumentStatusCatalog || !etfs[0].UCITS || etfs[0].FundCurrency != "USD" || !etfs[0].CurrencyHedged {
		t.Fatalf("unexpected catalog: total=%d etfs=%+v", total, etfs)
	}
	candidates, _, err := client.CatalogCandidates(context.Background(), 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 2 || candidates[1].UCITS {
		t.Fatalf("unexpected discovery candidates: %+v", candidates)
	}
}
