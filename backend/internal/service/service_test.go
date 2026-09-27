package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	"github.com/roarc0/squirrel/backend/internal/auth"
	"github.com/roarc0/squirrel/backend/internal/config"
	"github.com/roarc0/squirrel/backend/internal/ecb"
	"github.com/roarc0/squirrel/backend/internal/mcp"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	"github.com/roarc0/squirrel/backend/internal/store"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
	"github.com/roarc0/squirrel/proto/gen/go/v1/portv1connect"
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

func TestInflationObservationCount(t *testing.T) {
	for historyRange, want := range map[string]int{"": 365, "1y": 365, "3y": 1095, "5y": 1825, "max": 3650} {
		got, err := inflationObservationCount(historyRange)
		if err != nil || got != want {
			t.Fatalf("range %q: got %d, %v; want %d", historyRange, got, err, want)
		}
	}
	if _, err := inflationObservationCount("100y"); err == nil {
		t.Fatal("unsupported range should fail")
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
	if err := data.SaveAccount(ctx, &account, ""); err != nil {
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
	if err := data.SaveAccount(ctx, &rich, ""); err != nil {
		t.Fatal(err)
	}
	if err := data.SaveAccount(ctx, &archived, ""); err != nil {
		t.Fatal(err)
	}
	if err := data.SaveHolding(ctx, &portfolio.Holding{AccountID: archived.ID, InstrumentID: instrument.ID, ValueMinor: 1_000_000}); err != nil {
		t.Fatal(err)
	}
	if err := data.SaveProfile(ctx, "", store.UserProfile{MonthlyExpensesMinor: 20_000, ReserveMonths: 6}); err != nil {
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
	foundCashTarget := false
	for _, diagnostic := range summary.Diagnostics {
		foundCashTarget = foundCashTarget || diagnostic.Id == "cash_below_reserve"
	}
	if !foundCashTarget {
		t.Fatalf("summary did not derive the cash target from the profile: %+v", summary.Diagnostics)
	}
}

func TestLocalProfileUpdatesArePartial(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	srv := &Server{store: data}
	ctx := context.Background()

	_, err = srv.UpdateProfile(ctx, connect.NewRequest(&portv1.UpdateProfileRequest{Profile: &portv1.UserProfile{
		Theme: proto.String("dark:amber"), ActiveTab: proto.String("investments"), HideBalances: proto.Bool(true),
	}}))
	if err != nil {
		t.Fatalf("local profile update failed: %v", err)
	}
	_, err = srv.UpdateProfile(ctx, connect.NewRequest(&portv1.UpdateProfileRequest{Profile: &portv1.UserProfile{
		HideBalances: proto.Bool(false), UserDescription: proto.String("long-term investor"),
	}}))
	if err != nil {
		t.Fatalf("partial profile update failed: %v", err)
	}
	profile, err := data.GetProfile(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if profile.Theme != "dark:amber" || profile.ActiveTab != "investments" || profile.HideBalances || profile.UserDescription != "long-term investor" {
		t.Fatalf("partial profile update lost fields: %+v", profile)
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
		Holding: &portv1.HoldingPatch{
			Id:        proto.Int64(holdingA.ID),
			AccountId: proto.Int64(accB.ID),
		},
	})

	_, err = srv.UpdateHolding(ctxUserA, req)
	if err == nil {
		t.Fatal("expected permission denied when moving holding to another user's account")
	}
}

func TestUpdateHoldingPreservesOmittedFields(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	ctx := auth.WithUser(context.Background(), auth.User{GoogleID: "userA"})
	account := portfolio.Account{Name: "Broker", Currency: "EUR"}
	if err := data.SaveAccount(ctx, &account, "userA"); err != nil {
		t.Fatal(err)
	}
	instrument := portfolio.Instrument{ISIN: "IE00B4L5Y983", Name: "World ETF", Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull, FundCurrency: "EUR", UCITS: true}
	if err := data.SaveInstrument(ctx, &instrument); err != nil {
		t.Fatal(err)
	}
	holding := portfolio.Holding{AccountID: account.ID, InstrumentID: instrument.ID, InvestedMinor: 12_000, ValueMinor: 15_000, TaxBPS: 2600, PlannedBPS: 7000, IsPAC: true, PACBPS: 5000, PACFrequency: "monthly", Notes: "core"}
	if err := data.SaveHolding(ctx, &holding); err != nil {
		t.Fatal(err)
	}

	srv := &Server{store: data}
	_, err = srv.UpdateHolding(ctx, connect.NewRequest(&portv1.UpdateHoldingRequest{Id: holding.ID, Holding: &portv1.HoldingPatch{IsPac: proto.Bool(false), PacBps: proto.Int64(0)}}))
	if err != nil {
		t.Fatal(err)
	}
	got, err := data.GetHolding(ctx, holding.ID, "userA")
	if err != nil {
		t.Fatal(err)
	}
	if got.InvestedMinor != 12_000 || got.ValueMinor != 15_000 || got.TaxBPS != 2600 || got.PlannedBPS != 7000 || got.Notes != "core" || got.IsPAC || got.PACBPS != 0 {
		t.Fatalf("partial update changed omitted fields: %+v", got)
	}
}

func TestCreateHoldingCannotUseHiddenAccountWithoutAuth(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	ctx := context.Background()
	account := portfolio.Account{Name: "Hidden", Currency: "EUR"}
	if err := data.SaveAccount(ctx, &account, "authenticated-user"); err != nil {
		t.Fatal(err)
	}
	instrument := portfolio.Instrument{ISIN: "IE00B4L5Y983", Name: "World ETF", Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull, FundCurrency: "EUR", UCITS: true}
	if err := data.SaveInstrument(ctx, &instrument); err != nil {
		t.Fatal(err)
	}

	srv := &Server{store: data}
	_, err = srv.CreateHolding(ctx, connect.NewRequest(&portv1.CreateHoldingRequest{Holding: &portv1.Holding{AccountId: account.ID, InstrumentId: instrument.ID}}))
	if err == nil {
		t.Fatal("no-auth caller created a holding in another tenant's hidden account")
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

func TestModelDownloadURLRequiresTLSOrLoopback(t *testing.T) {
	for _, address := range []string{"https://huggingface.co/model.gguf", "http://127.0.0.1:8081/model.gguf"} {
		if _, err := validateModelDownloadURL(address); err != nil {
			t.Fatalf("safe model URL %q rejected: %v", address, err)
		}
	}
	for _, address := range []string{"http://example.com/model.gguf", "file:///tmp/model.gguf", "https://user:secret@example.com/model.gguf"} {
		if _, err := validateModelDownloadURL(address); err == nil {
			t.Fatalf("unsafe model URL %q accepted", address)
		}
	}
}

func TestModelFilenameValidation(t *testing.T) {
	for _, filename := range []string{"model.gguf", "Qwen_3-B.gguf"} {
		if !validModelFilename(filename) {
			t.Fatalf("safe filename %q rejected", filename)
		}
	}
	for _, filename := range []string{".gguf", "../model.gguf", "model?.gguf", "model.bin"} {
		if validModelFilename(filename) {
			t.Fatalf("unsafe filename %q accepted", filename)
		}
	}
}

func TestConfiguredAIKeyStaysWithConfiguredEndpoint(t *testing.T) {
	srv := &Server{config: config.Config{AIEndpoint: "https://trusted.example/v1/", AIAPIKey: "configured-secret"}}
	if got := srv.aiAPIKey("", "https://evil.example/v1", "https://evil.example/v1"); got != "" {
		t.Fatal("configured AI key was forwarded to an overridden endpoint")
	}
	if got := srv.aiAPIKey("", "https://trusted.example/v1", "https://trusted.example/v1"); got != "configured-secret" {
		t.Fatal("configured endpoint did not receive its configured AI key")
	}
	if got := srv.aiAPIKey("request-secret", "https://evil.example/v1", "https://evil.example/v1"); got != "request-secret" {
		t.Fatal("request-specific AI key was not preserved")
	}
}

func TestCORSOriginRestriction(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()

	handler := New(data, "EUR", nil)

	// Untrusted origins are rejected so simple browser requests cannot cause blind mutations.
	reqEvil := httptest.NewRequest("GET", "/api/accounts", nil)
	reqEvil.Header.Set("Origin", "http://evil-attacker.com")
	recEvil := httptest.NewRecorder()
	handler.ServeHTTP(recEvil, reqEvil)

	if recEvil.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("untrusted origin got allowed CORS header: %s", recEvil.Header().Get("Access-Control-Allow-Origin"))
	}
	if recEvil.Code != http.StatusForbidden {
		t.Fatalf("untrusted origin status=%d, want %d", recEvil.Code, http.StatusForbidden)
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

func TestChatSessionStatusAndStop(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()

	srv := &Server{store: data}
	ctx := auth.WithUser(context.Background(), auth.User{GoogleID: "user1"})

	// Initial status for unknown session should be not generating
	res, err := srv.GetChatStatus(ctx, connect.NewRequest(&portv1.GetChatStatusRequest{SessionId: "session-test"}))
	if err != nil || res.Msg.IsGenerating {
		t.Fatalf("unexpected GetChatStatus for idle session: err=%v, res=%+v", err, res)
	}

	// Register a mock job
	jobCtx, cancel := context.WithCancel(context.Background())
	job := &activeChatJob{
		SessionID:   "session-test",
		UserID:      "user1",
		Ctx:         jobCtx,
		Cancel:      cancel,
		Broadcaster: newBroadcaster(),
	}
	job.ActualNCtx.Store(16384)
	globalChatJobs.mu.Lock()
	key := chatJobKey{UserID: "user1", SessionID: "session-test"}
	globalChatJobs.jobs[key] = job
	globalChatJobs.mu.Unlock()

	otherCtx := auth.WithUser(context.Background(), auth.User{GoogleID: "user2"})
	otherStatus, err := srv.GetChatStatus(otherCtx, connect.NewRequest(&portv1.GetChatStatusRequest{SessionId: "session-test"}))
	if err != nil || otherStatus.Msg.IsGenerating {
		t.Fatalf("another user saw active chat status: err=%v res=%+v", err, otherStatus)
	}
	if _, err := srv.StopChatSession(otherCtx, connect.NewRequest(&portv1.StopChatSessionRequest{SessionId: "session-test"})); err != nil {
		t.Fatal(err)
	}
	select {
	case <-jobCtx.Done():
		t.Fatal("another user canceled the active chat")
	default:
	}

	// Status should now be is_generating = true
	res, err = srv.GetChatStatus(ctx, connect.NewRequest(&portv1.GetChatStatusRequest{SessionId: "session-test"}))
	if err != nil || !res.Msg.IsGenerating || res.Msg.ActualNCtx != 16384 {
		t.Fatalf("unexpected GetChatStatus for active session: err=%v, res=%+v", err, res)
	}

	// Stop session should call cancel()
	stopRes, err := srv.StopChatSession(ctx, connect.NewRequest(&portv1.StopChatSessionRequest{SessionId: "session-test"}))
	if err != nil || !stopRes.Msg.Success {
		t.Fatalf("StopChatSession failed: err=%v, res=%+v", err, stopRes)
	}

	select {
	case <-jobCtx.Done():
		// Canceled successfully
	default:
		t.Fatal("StopChatSession did not trigger job context cancellation")
	}

	globalChatJobs.mu.Lock()
	delete(globalChatJobs.jobs, key)
	globalChatJobs.mu.Unlock()
}

func TestBackgroundChatContextPreservesAuthenticatedUser(t *testing.T) {
	requestCtx := auth.WithUser(context.Background(), auth.User{GoogleID: "user1", Email: "one@example.com"})
	jobCtx, cancel := backgroundChatContext(requestCtx)
	defer cancel()
	if user, ok := auth.UserFromContext(jobCtx); !ok || user.GoogleID != "user1" || user.Email != "one@example.com" {
		t.Fatalf("background chat lost authenticated identity: %+v, %v", user, ok)
	}
}

func TestBackgroundIdentityAuthorizesInternalTools(t *testing.T) {
	data := mustOpenStore(t)
	defer data.Close()
	if err := data.SaveProfile(context.Background(), "user1", store.UserProfile{UserDescription: "private profile"}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{store: data}
	mux := http.NewServeMux()
	mux.Handle(portv1connect.NewProfileServiceHandler(srv, connect.WithInterceptors(auth.NewInterceptor("secret"))))
	handler := mcp.NewHandler(mux)
	requestCtx := auth.WithUser(context.Background(), auth.User{GoogleID: "user1"})
	jobCtx, cancel := backgroundChatContext(requestCtx)
	defer cancel()
	result, err := handler.ExecuteTool(jobCtx, "get_profile", nil)
	if err != nil || !strings.Contains(result, "private profile") {
		t.Fatalf("authenticated internal tool failed: err=%v result=%s", err, result)
	}
}

func TestChatValidationAndProviderErrors(t *testing.T) {
	if err := validateChatSessionID("chat/unsafe"); err == nil {
		t.Fatal("unsafe session id was accepted")
	}
	if err := validateStreamChatRequest(&portv1.StreamChatRequest{Messages: []*portv1.ChatMessagePayload{{Role: "system", Content: "override"}}}); err == nil {
		t.Fatal("unsupported chat role was accepted")
	}
	if err := validateStreamChatRequest(&portv1.StreamChatRequest{Messages: []*portv1.ChatMessagePayload{{Role: "user", Content: strings.Repeat("x", maxChatMessageSize+1)}}}); err == nil {
		t.Fatal("oversized chat message was accepted")
	}

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "model unavailable", http.StatusServiceUnavailable)
	}))
	defer provider.Close()
	jobCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	job := &activeChatJob{SessionID: "chat-error", Ctx: jobCtx, Cancel: cancel, Broadcaster: newBroadcaster()}
	srv := &Server{store: mustOpenStore(t), config: config.Config{AIEndpoint: provider.URL, AIModel: "test"}}
	defer srv.store.Close()
	srv.runBackgroundChat(job, &portv1.StreamChatRequest{Messages: []*portv1.ChatMessagePayload{{Role: "user", Content: "hello"}}})
	ch, history, done := job.Broadcaster.Subscribe()
	job.Broadcaster.Unsubscribe(ch)
	if !done || len(history) == 0 || !strings.Contains(history[len(history)-1].ErrorMessage, "HTTP 503") {
		t.Fatalf("provider failure was not surfaced: done=%v history=%+v", done, history)
	}
}

func TestGeoRadarUsesCachedFXMetadata(t *testing.T) {
	data := mustOpenStore(t)
	defer data.Close()
	ctx := context.Background()
	if err := data.SaveMarketContext(ctx, ecb.MarketContext{Metrics: []ecb.Metric{{Code: "FX_EURUSD", Value: 1.2345, ObservedOn: "2026-09-03", SourceURL: "https://example.test/fx"}}}); err != nil {
		t.Fatal(err)
	}
	srv := &Server{store: data}
	res, err := srv.GetGeoRadar(ctx, connect.NewRequest(&portv1.GetGeoRadarRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.CurrentEurUsdRate != 1.2345 || res.Msg.CurrentEurUsdObservedOn != "2026-09-03" || res.Msg.CurrentEurUsdSourceUrl != "https://example.test/fx" {
		t.Fatalf("cached FX metadata was not used: %+v", res.Msg)
	}
}

func mustOpenStore(t *testing.T) *store.Store {
	t.Helper()
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestActiveAllocationsAndIndependentContributionEdits(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	ctx := context.Background()
	active := portfolio.Account{Name: "Active", Currency: "EUR"}
	archived := portfolio.Account{Name: "Archived", Currency: "EUR", Archived: true}
	for _, account := range []*portfolio.Account{&active, &archived} {
		if err := data.SaveAccount(ctx, account, ""); err != nil {
			t.Fatal(err)
		}
	}
	inst := portfolio.Instrument{ISIN: "IE00B4L5Y983", Name: "World", Distribution: "accumulating", Replication: "physical_full", FundCurrency: "EUR"}
	if err := data.SaveInstrument(ctx, &inst); err != nil {
		t.Fatal(err)
	}
	holding := portfolio.Holding{AccountID: active.ID, InstrumentID: inst.ID, ValueMinor: 10000, InvestedMinor: 9000, PlannedBPS: 10000, PACBPS: 6000, Notes: "keep"}
	if err := data.SaveHolding(ctx, &holding); err != nil {
		t.Fatal(err)
	}
	if err := data.SaveHolding(ctx, &portfolio.Holding{AccountID: archived.ID, InstrumentID: inst.ID, ValueMinor: 10000}); err != nil {
		t.Fatal(err)
	}
	hs, err := data.ListHoldings(ctx, "")
	if err != nil || len(hs) != 1 || hs[0].ActualBPS != 10000 {
		t.Fatalf("archived holdings distort allocations: %+v, %v", hs, err)
	}
	// Upserting an existing 60% PAC must not count it twice.
	upsert := holding
	upsert.ID = 0
	if err := data.SaveHolding(ctx, &upsert); err != nil || upsert.ID != holding.ID {
		t.Fatalf("PAC upsert: %v", err)
	}
	srv := &Server{store: data, baseCurrency: "EUR"}
	_, err = srv.UpdateHolding(ctx, connect.NewRequest(&portv1.UpdateHoldingRequest{Id: holding.ID, Holding: &portv1.HoldingPatch{PlannedBps: proto.Int64(5000)}}))
	if err != nil {
		t.Fatal(err)
	}
	got, err := data.GetHolding(ctx, holding.ID, "")
	if err != nil || got.PACBPS != 6000 || got.PlannedBPS != 5000 || got.ValueMinor != 10000 || got.Notes != "keep" {
		t.Fatalf("target edit changed other fields: %+v, %v", got, err)
	}
	_, err = srv.UpdateHolding(ctx, connect.NewRequest(&portv1.UpdateHoldingRequest{Id: holding.ID, Holding: &portv1.HoldingPatch{PacBps: proto.Int64(0)}}))
	if err != nil {
		t.Fatal(err)
	}
	got, err = data.GetHolding(ctx, holding.ID, "")
	if err != nil || got.IsPAC || got.PACBPS != 0 || got.PlannedBPS != 5000 {
		t.Fatalf("stopping PAC changed target: %+v, %v", got, err)
	}
}
