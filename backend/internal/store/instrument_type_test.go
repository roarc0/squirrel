package store

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

func TestETPMigrationPreservesSavedData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "types.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	// Prepare the old schema, with the ETP incorrectly saved as an ETF.
	if err := goose.DownTo(s.db, "migrations", 11); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := s.db.Exec(`INSERT INTO instruments (id,isin,name,instrument_type,data_status,distribution,replication,fund_currency,ter_bps,refreshed_at,created_at,updated_at,starred,last_refresh_attempt_at) VALUES (42,'CH1135202120','21shares Aave ETP','etf','enriched','accumulating','physical_full','USD',250,'2026-09-27T12:00:00Z','','',1,'2026-09-27T12:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	account := portfolio.Account{Name: "Broker", Currency: "EUR"}
	if err := s.SaveAccount(ctx, &account, "user"); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveHolding(ctx, &portfolio.Holding{AccountID: account.ID, InstrumentID: 42, ValueMinor: 10000}); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePerformance(ctx, "CH1135202120", []portfolio.PerformancePoint{{Date: "2026-09-27", ChangeBPS: 123}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	var kind, refreshed, attempted string
	var id, starred int
	if err := s.db.QueryRow(`SELECT id,instrument_type,refreshed_at,starred,last_refresh_attempt_at FROM instruments WHERE isin='CH1135202120'`).Scan(&id, &kind, &refreshed, &starred, &attempted); err != nil {
		t.Fatal(err)
	}
	if id != 42 || kind != "etp" || starred != 1 || refreshed != "2026-09-27T12:00:00Z" || attempted != refreshed {
		t.Fatalf("migration changed profile: %d %s %s %d %s", id, kind, refreshed, starred, attempted)
	}
	holdings, err := s.ListHoldings(ctx, "user")
	if err != nil || len(holdings) != 1 || holdings[0].InstrumentType != "etp" || holdings[0].ValueMinor != 10000 {
		t.Fatalf("holding changed: %+v %v", holdings, err)
	}
	points, err := s.GetPerformance(ctx, "CH1135202120")
	if err != nil || len(points) != 1 || points[0].ChangeBPS != 123 {
		t.Fatalf("chart changed: %+v %v", points, err)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_check`).Scan(&id); err != nil || id != 0 {
		t.Fatalf("broken references: %d %v", id, err)
	}
	for _, tc := range []struct{ name, kind string }{{"Generic ETP", "etp"}, {"Gold ETC", "etc"}, {"Bitcoin ETN", "etn"}} {
		inst := portfolio.Instrument{ISIN: "IE00B579F325", Name: tc.name, InstrumentType: "etf", Distribution: "accumulating", Replication: "physical_full", FundCurrency: "USD"}
		if err := s.SaveInstrument(ctx, &inst); err != nil {
			t.Fatal(err)
		}
		if err := s.db.QueryRow(`SELECT instrument_type FROM instruments WHERE isin=?`, inst.ISIN).Scan(&kind); err != nil || kind != tc.kind {
			t.Fatalf("save persisted wrong type: %s %v", kind, err)
		}
		inst.ISIN = "IE00BK5BQT80"
		inst.InstrumentType = "etf"
		if _, err := s.SaveInstrumentCatalogBatch(ctx, []portfolio.Instrument{inst}); err != nil {
			t.Fatal(err)
		}
		if err := s.db.QueryRow(`SELECT instrument_type FROM instruments WHERE isin=?`, inst.ISIN).Scan(&kind); err != nil || kind != tc.kind {
			t.Fatalf("catalog persisted wrong type: %s %v", kind, err)
		}
	}
}
