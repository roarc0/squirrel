package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	"loot/backend/internal/portfolio"
	"loot/backend/internal/store"
	portv1 "loot/proto/gen/go/v1"
	"loot/proto/gen/go/v1/portv1connect"
)

func TestSortSlice(t *testing.T) {
	type row struct{ value int }
	rows := []row{{2}, {1}}
	if err := sortSlice("value:desc", rows, map[string]func(row, row) int{"value": func(a, b row) int { return a.value - b.value }}); err != nil {
		t.Fatal(err)
	}
	if rows[0].value != 2 || rows[1].value != 1 {
		t.Fatalf("unexpected order: %+v", rows)
	}
	if err := sortSlice("unsafe:asc", rows, map[string]func(row, row) int{}); err == nil {
		t.Fatal("unknown sort column should fail")
	}
}

func TestAccountsIncludeHoldingsAndSummary(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	ctx := context.Background()

	account := portfolio.Account{Name: "Broker", Type: portfolio.AccountTypeBroker, Currency: "EUR", BalanceMinor: 10_000}
	instrument := portfolio.Instrument{ISIN: "IE00B4L5Y983", Name: "World ETF", Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull, FundCurrency: "EUR", UCITS: true}
	if err := data.SaveAccount(ctx, &account, "testuser"); err != nil {
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
	if err := data.SaveAccount(ctx, &rich, "testuser"); err != nil {
		t.Fatal(err)
	}
	if err := data.SaveAccount(ctx, &archived, "testuser"); err != nil {
		t.Fatal(err)
	}

	handler := New(data, "EUR", nil)
	server := httptest.NewServer(handler)
	defer server.Close()

	accountClient := portv1connect.NewAccountServiceClient(http.DefaultClient, server.URL)
	summaryClient := portv1connect.NewSummaryServiceClient(http.DefaultClient, server.URL)

	accountsRes, err := accountClient.ListAccounts(ctx, connect.NewRequest(&portv1.ListAccountsRequest{}))
	if err != nil {
		t.Fatalf("ListAccounts failed: %v", err)
	}
	accounts := accountsRes.Msg.Accounts
	if len(accounts) != 3 {
		t.Fatalf("expected 3 accounts, got %d", len(accounts))
	}
	if accounts[0].Name != "Rich" || accounts[1].Name != "Broker" || accounts[1].HoldingCount != 1 || accounts[1].HoldingsValueMinor != 25_000 || accounts[1].TotalAssetsMinor != 35_000 || accounts[2].Name != "Archived" {
		t.Fatalf("unexpected account list order: %+v", accounts)
	}

	summaryRes, err := summaryClient.GetSummary(ctx, connect.NewRequest(&portv1.GetSummaryRequest{}))
	if err != nil {
		t.Fatalf("GetSummary failed: %v", err)
	}
	summary := summaryRes.Msg.Summary
	if len(summary.Currencies) != 1 || summary.Currencies[0].TotalMinor != 85_000 {
		t.Fatalf("unexpected summary totals: %+v", summary)
	}
}
