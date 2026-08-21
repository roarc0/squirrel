package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"loot/internal/portfolio"
	"loot/internal/store"
)

func TestSortRows(t *testing.T) {
	type row struct{ value int }
	rows := []row{{2}, {1}}
	r := httptest.NewRequest("GET", "/?sort=value&direction=desc", nil)
	if err := sortRows(r, rows, map[string]func(row, row) int{"value": func(a, b row) int { return a.value - b.value }}); err != nil {
		t.Fatal(err)
	}
	if rows[0].value != 2 || rows[1].value != 1 {
		t.Fatalf("unexpected order: %+v", rows)
	}
	if err := sortRows(httptest.NewRequest("GET", "/?sort=unsafe", nil), rows, map[string]func(row, row) int{}); err == nil {
		t.Fatal("unknown sort column should fail")
	}
}

func TestAccountsIncludeHoldings(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	ctx := context.Background()
	account := portfolio.Account{Name: "Broker", Type: portfolio.AccountTypeBroker, Currency: "EUR", BalanceMinor: 10_000}
	instrument := portfolio.Instrument{ISIN: "IE00B4L5Y983", Name: "World ETF", Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull, FundCurrency: "EUR", UCITS: true}
	if err := data.SaveAccount(ctx, &account); err != nil {
		t.Fatal(err)
	}
	if err := data.SaveInstrument(ctx, &instrument); err != nil {
		t.Fatal(err)
	}
	if err := data.SaveHolding(ctx, &portfolio.Holding{AccountID: account.ID, InstrumentID: instrument.ID, ValueMinor: 25_000, TaxBPS: 2600}); err != nil {
		t.Fatal(err)
	}
	rich := portfolio.Account{Name: "Rich", Currency: "EUR", BalanceMinor: 50_000}
	archived := portfolio.Account{Name: "Archived", Currency: "EUR", BalanceMinor: 1_000_000, Archived: true}
	if err := data.SaveAccount(ctx, &rich); err != nil {
		t.Fatal(err)
	}
	if err := data.SaveAccount(ctx, &archived); err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	New(data, "EUR", nil).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/accounts", nil))
	var accounts []portfolio.Account
	if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &accounts) != nil || len(accounts) != 3 {
		t.Fatalf("unexpected response: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if accounts[0].Name != "Rich" || accounts[1].Name != "Broker" || accounts[1].HoldingCount != 1 || accounts[1].HoldingsValueMinor != 25_000 || accounts[1].TotalAssetsMinor != 35_000 || accounts[2].Name != "Archived" {
		t.Fatalf("unexpected richest-first account order: %+v", accounts)
	}
	rr = httptest.NewRecorder()
	New(data, "EUR", nil).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/summary", nil))
	var current summary
	if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &current) != nil || len(current.Currencies) != 1 || current.Currencies[0].TotalMinor != 85_000 {
		t.Fatalf("archived account leaked into summary: status=%d body=%s", rr.Code, rr.Body.String())
	}
}
