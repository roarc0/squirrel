package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	"squirrel/backend/internal/auth"
	"squirrel/backend/internal/portfolio"
	"squirrel/backend/internal/store"
	portv1 "squirrel/proto/gen/go/v1"
	"squirrel/proto/gen/go/v1/portv1connect"
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

func TestUpdateHoldingAccountIDAuthorization(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	ctx := context.Background()

	accA := portfolio.Account{Name: "AccountA", Currency: "EUR"}
	accB := portfolio.Account{Name: "AccountB", Currency: "EUR"}
	if err := data.SaveAccount(ctx, &accA, "userA"); err != nil {
		t.Fatal(err)
	}
	if err := data.SaveAccount(ctx, &accB, "userB"); err != nil {
		t.Fatal(err)
	}

	inst := portfolio.Instrument{ISIN: "IE00B4L5Y983", Name: "World ETF", Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull, FundCurrency: "EUR", UCITS: true}
	if err := data.SaveInstrument(ctx, &inst); err != nil {
		t.Fatal(err)
	}

	holdingA := portfolio.Holding{AccountID: accA.ID, InstrumentID: inst.ID, ValueMinor: 10_000}
	if err := data.SaveHolding(ctx, &holdingA); err != nil {
		t.Fatal(err)
	}

	srv := &Server{store: data}

	// Attempting to move holdingA to accB (owned by userB) from userA context must fail
	ctxUserA := auth.WithUser(ctx, auth.User{GoogleID: "userA"})
	req := connect.NewRequest(&portv1.UpdateHoldingRequest{
		Id: holdingA.ID,
		Holding: &portv1.Holding{
			Id:        holdingA.ID,
			AccountId: accB.ID,
		},
	})

	_, err = srv.UpdateHolding(ctxUserA, req)
	if err == nil {
		t.Fatal("expected permission denied when moving holding to another user's account")
	}
}

func TestPathTraversalInAIModelFilename(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	srv := &Server{store: data}
	ctx := context.Background()

	// DownloadAIModel with path traversal in URL/name
	_, err = srv.DownloadAIModel(ctx, connect.NewRequest(&portv1.DownloadAIModelRequest{
		ModelName: "http://example.com/../../etc/passwd",
	}))
	if err == nil {
		t.Fatal("expected error for path traversal in DownloadAIModel")
	}

	// RestartLocalServer with path traversal in filename
	_, err = srv.RestartLocalServer(ctx, connect.NewRequest(&portv1.RestartLocalServerRequest{
		ModelFilename: "../../bin/malicious.gguf",
	}))
	// Should fail because file does not exist or path clean fails, but filename must be sanitized to Base
	if err == nil {
		t.Fatal("expected error for path traversal in RestartLocalServer")
	}
}

func TestCORSOriginRestriction(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()

	handler := New(data, "EUR", nil)

	// Untrusted origin should NOT get Access-Control-Allow-Origin: * or reflected origin
	reqEvil := httptest.NewRequest("GET", "/api/accounts", nil)
	reqEvil.Header.Set("Origin", "http://evil-attacker.com")
	recEvil := httptest.NewRecorder()
	handler.ServeHTTP(recEvil, reqEvil)

	if recEvil.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("untrusted origin got allowed CORS header: %s", recEvil.Header().Get("Access-Control-Allow-Origin"))
	}

	// Localhost origin SHOULD get allowed CORS header
	reqLocal := httptest.NewRequest("GET", "/api/accounts", nil)
	reqLocal.Header.Set("Origin", "http://localhost:7340")
	recLocal := httptest.NewRecorder()
	handler.ServeHTTP(recLocal, reqLocal)

	if recLocal.Header().Get("Access-Control-Allow-Origin") != "http://localhost:7340" {
		t.Fatalf("localhost origin failed CORS header check: %s", recLocal.Header().Get("Access-Control-Allow-Origin"))
	}
}
