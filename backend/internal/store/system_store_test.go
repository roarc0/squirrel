package store

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

func TestExportAndRestoreBackup(t *testing.T) {
	ctx := context.Background()

	// 1. Create source database with sample data
	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "squirrel.db")

	s1, err := Open(srcPath)
	if err != nil {
		t.Fatalf("Open src: %v", err)
	}

	accountA := portfolio.Account{Name: "Test Account", Currency: "EUR", BalanceMinor: 10_000}
	accountB := portfolio.Account{Name: "Second Account", Currency: "USD", BalanceMinor: 20_000}
	for _, account := range []*portfolio.Account{&accountA, &accountB} {
		if err := s1.SaveAccount(ctx, account, "testuser"); err != nil {
			t.Fatalf("SaveAccount: %v", err)
		}
	}
	instrument := portfolio.Instrument{ISIN: "IE00B4L5Y983", Name: "World ETF", InstrumentType: portfolio.InstrumentTypeETF, DataStatus: portfolio.InstrumentStatusEnriched, Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull, FundCurrency: "EUR", UCITS: true}
	if err := s1.SaveInstrument(ctx, &instrument); err != nil {
		t.Fatalf("SaveInstrument: %v", err)
	}
	for _, accountID := range []int64{accountA.ID, accountB.ID} {
		if err := s1.SaveHolding(ctx, &portfolio.Holding{AccountID: accountID, InstrumentID: instrument.ID, ValueMinor: 5_000}); err != nil {
			t.Fatalf("SaveHolding: %v", err)
		}
	}
	for _, observedOn := range []string{"2026-08-21", "2026-08-22"} {
		if err := s1.SaveSnapshot(ctx, observedOn, "testuser"); err != nil {
			t.Fatalf("SaveSnapshot: %v", err)
		}
	}
	profile := UserProfile{ReserveMonths: 9, EnableBtpRanks: true, ActiveTab: "btp", AISettingsJSON: `{"provider":"local","apiKey":"secret"}`, DraftPortfoliosJSON: `[{"name":"test"}]`, UserDescription: "long-term investor"}
	if err := s1.SaveProfile(ctx, "testuser", profile); err != nil {
		t.Fatalf("SaveProfile: %v", err)
	}
	if err := s1.SaveChatSession(ctx, &ChatSessionRecord{ID: "chat-source", UserID: "testuser", Title: "Allocation", Messages: []ChatMessageRecord{{Role: "user", Content: "How am I allocated?", Timestamp: "12:00"}, {Role: "assistant", Content: "Mostly equities.", Timestamp: "12:01"}}}); err != nil {
		t.Fatalf("SaveChatSession: %v", err)
	}
	if _, err := s1.DB().ExecContext(ctx, `INSERT INTO btp_starred (user_id, isin, created_at) VALUES (?, ?, ?)`, "testuser", "IT0000000001", "2026-09-04T12:00:00Z"); err != nil {
		t.Fatalf("Star BTP: %v", err)
	}
	if err := s1.SetInstrumentStarredForUser(ctx, "testuser", instrument.ISIN, true); err != nil {
		t.Fatalf("Star instrument: %v", err)
	}

	// Export backup
	tarGzBytes, filename, err := s1.ExportBackup(ctx, "testuser")
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	s1.Close()

	if len(tarGzBytes) == 0 || filename == "" {
		t.Fatalf("ExportBackup returned empty bytes or filename")
	}
	if bytes.Contains(tarGzBytes, []byte("secret")) {
		t.Fatal("backup exported an AI API key")
	}

	// 2. Restore backup into a new target database
	dstDir := t.TempDir()
	dstPath := filepath.Join(dstDir, "squirrel.db")

	s2, err := Open(dstPath)
	if err != nil {
		t.Fatalf("Open dst: %v", err)
	}
	defer s2.Close()

	if err := s2.RestoreBackup(ctx, "testuser", tarGzBytes, true); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}

	// 3. Verify data in restored database
	accounts, err := s2.ListAccounts(ctx, "testuser")
	if err != nil {
		t.Fatalf("ListAccounts in restored db: %v", err)
	}

	if len(accounts) != 2 {
		t.Fatalf("Unexpected accounts in restored db: %+v", accounts)
	}
	holdings, err := s2.ListHoldings(ctx, "testuser")
	if err != nil || len(holdings) != 2 {
		t.Fatalf("Unexpected holdings in restored db: err=%v holdings=%+v", err, holdings)
	}
	snapshots, err := s2.ListSnapshots(ctx, "testuser")
	if err != nil || len(snapshots) != 4 {
		t.Fatalf("Unexpected snapshots in restored db: err=%v snapshots=%+v", err, snapshots)
	}
	restoredProfile, err := s2.GetProfile(ctx, "testuser")
	if err != nil || restoredProfile.ReserveMonths != 9 || !restoredProfile.EnableBtpRanks || restoredProfile.ActiveTab != "btp" || restoredProfile.AISettingsJSON == "" || bytes.Contains([]byte(restoredProfile.AISettingsJSON), []byte("secret")) || restoredProfile.DraftPortfoliosJSON == "" || restoredProfile.UserDescription != "long-term investor" {
		t.Fatalf("Unexpected restored profile: err=%v profile=%+v", err, restoredProfile)
	}
	chats, err := s2.ListChatSessions(ctx, "testuser")
	if err != nil || len(chats) != 1 || chats[0].Title != "Allocation" || chats[0].MessageCount != 2 {
		t.Fatalf("Unexpected restored chats: err=%v chats=%+v", err, chats)
	}
	var starred int
	if err := s2.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM btp_starred WHERE user_id=? AND isin=?`, "testuser", "IT0000000001").Scan(&starred); err != nil || starred != 1 {
		t.Fatalf("Unexpected restored starred BTP: err=%v count=%d", err, starred)
	}
	var instStarred int
	if err := s2.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM instrument_starred WHERE user_id=? AND isin=?`, "testuser", "IE00B4L5Y983").Scan(&instStarred); err != nil || instStarred != 1 {
		t.Fatalf("Unexpected restored starred instrument: err=%v count=%d", err, instStarred)
	}
}

func TestRestoreBackupWithoutAuth(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	data := []byte(`{"version":1,"app":"squirrel","accounts":[{"name":"Local","account_type":"other","currency":"EUR"}],"snapshots":[],"profile":{"theme":"dark","reserve_months":7}}`)
	if err := s.RestoreBackup(context.Background(), "", data, true); err != nil {
		t.Fatal(err)
	}
	accounts, err := s.ListAccounts(context.Background(), "")
	if err != nil || len(accounts) != 1 {
		t.Fatalf("anonymous restore failed: err=%v accounts=%+v", err, accounts)
	}
	profile, err := s.GetProfile(context.Background(), "")
	if err != nil || profile.Theme != "dark" || profile.ReserveMonths != 7 {
		t.Fatalf("anonymous profile restore failed: err=%v profile=%+v", err, profile)
	}
}

func TestRestoreCannotCreateSharedInstrumentWithoutPermission(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	original := portfolio.Account{Name: "Original", Currency: "EUR"}
	if err := s.SaveAccount(ctx, &original, "user"); err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreBackup(ctx, "user", []byte(`{}`), true); err == nil {
		t.Fatal("versionless backup erased user data")
	}
	data := []byte(`{"version":1,"app":"squirrel","accounts":[{"name":"Injected","account_type":"other","currency":"EUR","holdings":[{"instrument_isin":"IE00B4L5Y983","instrument_name":"Injected","instrument_type":"etf","fund_currency":"EUR","distribution":"accumulating","replication":"physical_full","pac_frequency":"monthly"}]}]}`)
	if err := s.RestoreBackup(ctx, "user", data, false); err == nil {
		t.Fatal("non-admin restore created a shared catalog instrument")
	}
	accounts, err := s.ListAccounts(ctx, "user")
	if err != nil || len(accounts) != 1 || accounts[0].Name != "Original" {
		t.Fatalf("failed restore did not roll back: err=%v accounts=%+v", err, accounts)
	}
	instruments, err := s.ListInstruments(ctx)
	if err != nil || len(instruments) != 0 {
		t.Fatalf("failed restore changed shared instruments: err=%v instruments=%+v", err, instruments)
	}
}
