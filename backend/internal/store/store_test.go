package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"

	"loot/backend/internal/portfolio"
)

func TestStoreRoundTrip(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	if err := s.SaveReferenceRate(ctx, portfolio.ReferenceRate{Code: "ecb_dfr", Label: "ECB deposit facility", RateBPS: 200, ObservedOn: "2026-01-01"}); err != nil {
		t.Fatal(err)
	}
	limit, fixed := int64(5_000_000), int64(300)
	account := portfolio.Account{Name: "Savings", Currency: "eur", BalanceMinor: 7_000_000, Tiers: []portfolio.InterestTier{{UpToMinor: &limit, FixedRateBPS: &fixed}, {ReferenceCode: "ecb_dfr"}}}
	if err := s.SaveAccount(ctx, &account, "testuser"); err != nil {
		t.Fatal(err)
	}
	accounts, err := s.ListAccounts(ctx, "testuser")
	if err != nil {
		t.Fatal(err)
	}
	if len(accounts) != 1 || len(accounts[0].Tiers) != 2 || accounts[0].Currency != "EUR" || accounts[0].Type != portfolio.AccountTypeOther || !accounts[0].Preferred {
		t.Fatalf("unexpected accounts: %+v", accounts)
	}
	second := portfolio.Account{Name: "Broker", Type: portfolio.AccountTypeBroker, Currency: "EUR", Preferred: true}
	if err := s.SaveAccount(ctx, &second, "testuser"); err != nil {
		t.Fatal(err)
	}
	accounts, err = s.ListAccounts(ctx, "testuser")
	if err != nil || len(accounts) != 2 || !accounts[0].Preferred || accounts[1].Preferred {
		t.Fatalf("expected only Broker to be preferred: err=%v accounts=%+v", err, accounts)
	}
	second.Archived = true
	if err := s.SaveAccount(ctx, &second, "testuser"); err != nil {
		t.Fatal(err)
	}
	accounts, err = s.ListAccounts(ctx, "testuser")
	if err != nil || !accounts[0].Preferred || accounts[1].Preferred || !accounts[1].Archived {
		t.Fatalf("expected archived Broker and active preferred Savings: err=%v accounts=%+v", err, accounts)
	}

	instrument := portfolio.Instrument{ISIN: "ie00b4l5y983", Name: "World ETF", Provider: "Provider", InvestmentFocus: "Equity, World", AssetClass: "equity", Strategy: "broad", Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull, FundCurrency: "eur", TERBPS: 20, EnrichedAt: "2026-08-21T12:00:00Z"}
	if err := s.SaveInstrument(ctx, &instrument); err != nil {
		t.Fatal(err)
	}
	instrument.TERBPS = 12
	if err := s.SaveInstrument(ctx, &instrument); err != nil {
		t.Fatal(err)
	}
	instruments, err := s.ListInstruments(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(instruments) != 1 || instruments[0].TERBPS != 12 || instruments[0].InstrumentType != portfolio.InstrumentTypeETF {
		t.Fatalf("unexpected instruments: %+v", instruments)
	}
	if err := s.SetInstrumentStarred(ctx, instrument.ISIN, true); err != nil {
		t.Fatal(err)
	}
	catalog := instrument
	catalog.Provider, catalog.InvestmentFocus, catalog.AssetClass, catalog.Strategy = "", "", "", ""
	catalog.DataStatus, catalog.TERBPS = portfolio.InstrumentStatusCatalog, 10
	catalog.EnrichedAt = ""
	if err := s.SaveInstrument(ctx, &catalog); err != nil {
		t.Fatal(err)
	}
	instruments, err = s.ListInstruments(ctx)
	if err != nil || !instruments[0].Starred || instruments[0].DataStatus != portfolio.InstrumentStatusEnriched || instruments[0].Provider != "Provider" || instruments[0].InvestmentFocus != "Equity, World" || instruments[0].TERBPS != 10 || instruments[0].EnrichedAt != "2026-08-21T12:00:00Z" {
		t.Fatalf("catalog refresh downgraded enriched data: err=%v instruments=%+v", err, instruments)
	}
	holding := portfolio.Holding{AccountID: account.ID, InstrumentID: instrument.ID, InvestedMinor: 1_000_000, ValueMinor: 1_100_000, TaxBPS: 2600, PlannedBPS: 6000}
	if err := s.SaveHolding(ctx, &holding); err != nil {
		t.Fatal(err)
	}
	gold := portfolio.Instrument{ISIN: "IE00B579F325", Name: "Physical Gold ETC", InstrumentType: portfolio.InstrumentTypeETC, Distribution: portfolio.DistributionAccumulating, Replication: portfolio.ReplicationPhysicalFull, FundCurrency: "EUR"}
	if err := s.SaveInstrument(ctx, &gold); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveHolding(ctx, &portfolio.Holding{AccountID: account.ID, InstrumentID: gold.ID, ValueMinor: 900_000, TaxBPS: 2600, PlannedBPS: 4000}); err != nil {
		t.Fatal(err)
	}
	holdings, err := s.ListHoldings(ctx, "testuser")
	if err != nil || len(holdings) != 2 || holdings[0].InstrumentID != instrument.ID || holdings[0].InstrumentType != portfolio.InstrumentTypeETF || holdings[0].AssetClass != "equity" || holdings[0].PlannedBPS != 6000 || holdings[0].ActualBPS != 5500 || holdings[1].ActualBPS != 4500 {
		t.Fatalf("unexpected holdings: err=%v holdings=%+v", err, holdings)
	}
	if err := s.SaveSnapshot(ctx, "2026-08-21", "testuser"); err != nil {
		t.Fatal(err)
	}
	snapshots, err := s.ListSnapshots(ctx, "testuser")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 || snapshots[0].CashMinor != 7_000_000 || snapshots[0].InvestedMinor != 1_000_000 || snapshots[0].PortfolioMinor != 2_000_000 || snapshots[0].TotalMinor != 9_000_000 {
		t.Fatalf("unexpected snapshots: %+v", snapshots)
	}
	corrected := snapshots[0]
	corrected.ObservedOn, corrected.CashMinor, corrected.InvestedMinor, corrected.PortfolioMinor = "2026-08-22", 6_900_000, 1_100_000, 2_100_000
	if err := s.UpdateSnapshot(ctx, &corrected); err != nil {
		t.Fatal(err)
	}
	snapshots, err = s.ListSnapshots(ctx, "testuser")
	if err != nil || len(snapshots) != 1 || snapshots[0].ObservedOn != "2026-08-22" || snapshots[0].CashMinor != 6_900_000 || snapshots[0].InvestedMinor != 1_100_000 || snapshots[0].PortfolioMinor != 2_100_000 || snapshots[0].TotalMinor != 9_000_000 {
		t.Fatalf("unexpected corrected snapshot: err=%v snapshots=%+v", err, snapshots)
	}
	if err := s.DeleteSnapshot(ctx, corrected.ID); err != nil {
		t.Fatal(err)
	}
	if snapshots, err = s.ListSnapshots(ctx, "testuser"); err != nil || len(snapshots) != 0 {
		t.Fatalf("snapshot was not deleted: err=%v snapshots=%+v", err, snapshots)
	}
}

func TestMigratesLegacyDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "loot.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA user_version=9`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var version int64
	var errVersion error
	if version, errVersion = goose.GetDBVersion(s.db); errVersion != nil || version != 1 {
		t.Fatalf("migration version=%d err=%v", version, errVersion)
	}
}

func TestPACAllocationPercentageConstraint(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()

	acc := portfolio.Account{Name: "Trade Republic", Currency: "EUR", PACAmountMinor: 30000}
	if err := s.SaveAccount(ctx, &acc, "testuser"); err != nil {
		t.Fatal(err)
	}

	inst1 := portfolio.Instrument{ISIN: "US0378331005", Name: "MSCI World", FundCurrency: "EUR", Distribution: "accumulating", Replication: "physical_full"}
	if err := s.SaveInstrument(ctx, &inst1); err != nil {
		t.Fatal(err)
	}
	inst2 := portfolio.Instrument{ISIN: "DE0005933931", Name: "MSCI EM", FundCurrency: "EUR", Distribution: "accumulating", Replication: "physical_full"}
	if err := s.SaveInstrument(ctx, &inst2); err != nil {
		t.Fatal(err)
	}

	// Save 60% PAC share on World
	h1 := portfolio.Holding{AccountID: acc.ID, InstrumentID: inst1.ID, IsPAC: true, PACBPS: 6000}
	if err := s.SaveHolding(ctx, &h1); err != nil {
		t.Fatalf("expected 60%% PAC to succeed, got: %v", err)
	}

	// Try saving 50% PAC share on EM (Total would be 110% > 100%)
	h2 := portfolio.Holding{AccountID: acc.ID, InstrumentID: inst2.ID, IsPAC: true, PACBPS: 5000}
	if err := s.SaveHolding(ctx, &h2); err == nil {
		t.Fatal("expected error when total PAC allocation exceeds 100%, but got nil")
	}

	// Save 40% PAC share on EM (Total is exactly 100%)
	h2.PACBPS = 4000
	if err := s.SaveHolding(ctx, &h2); err != nil {
		t.Fatalf("expected 40%% PAC (total 100%%) to succeed, got: %v", err)
	}
}

func TestZeroValuePACHolding(t *testing.T) {
	s, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()

	acc := portfolio.Account{Name: "Fineco", Currency: "EUR", PACAmountMinor: 50000}
	if err := s.SaveAccount(ctx, &acc, "testuser"); err != nil {
		t.Fatal(err)
	}

	inst := portfolio.Instrument{ISIN: "IE00B4L5Y983", Name: "World ETF", FundCurrency: "EUR", Distribution: "accumulating", Replication: "physical_full"}
	if err := s.SaveInstrument(ctx, &inst); err != nil {
		t.Fatal(err)
	}

	// Save €0 holding with 5% (500 bps) PAC
	h := portfolio.Holding{
		AccountID:    acc.ID,
		InstrumentID: inst.ID,
		ValueMinor:   0,
		InvestedMinor: 0,
		IsPAC:        true,
		PACBPS:       500,
		PACFrequency: "monthly",
	}
	if err := s.SaveHolding(ctx, &h); err != nil {
		t.Fatalf("SaveHolding failed for €0 PAC holding: %v", err)
	}

	holdings, err := s.ListHoldings(ctx, "testuser")
	if err != nil {
		t.Fatalf("ListHoldings failed: %v", err)
	}
	if len(holdings) != 1 {
		t.Fatalf("expected 1 holding, got %d", len(holdings))
	}
	if holdings[0].ValueMinor != 0 || !holdings[0].IsPAC || holdings[0].PACBPS != 500 {
		t.Fatalf("unexpected zero-value holding state: %+v", holdings[0])
	}
}
