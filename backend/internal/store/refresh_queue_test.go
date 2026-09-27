package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

func TestRefreshQueuePrioritizesMissingAndSurvivesRestart(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "queue.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	template := portfolio.Instrument{Name: "Test ETF", InstrumentType: "etf", Distribution: "accumulating", Replication: "physical_full", FundCurrency: "EUR"}
	old := template
	old.ISIN, old.RefreshedAt = "IE00B4L5Y983", "2020-01-01T00:00:00Z"
	if err := s.SaveInstrument(ctx, &old); err != nil {
		t.Fatal(err)
	}
	missing := template
	missing.ISIN, missing.DataStatus = "IE00BK5BQT80", "catalog"
	other := missing
	other.ISIN = "IE00B579F325"
	if _, err := s.SaveInstrumentCatalogBatch(ctx, []portfolio.Instrument{missing, other}); err != nil {
		t.Fatal(err)
	}
	next, err := s.NextInstrumentToRefresh(ctx)
	if err != nil || next == nil || next.DataStatus != "catalog" {
		t.Fatalf("missing profile not prioritized: %+v %v", next, err)
	}
	failedISIN := next.ISIN
	if err := s.RecordInstrumentRefreshAttempt(ctx, failedISIN); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	// Catalog re-sync and restart must not move an unattempted profile behind old enriched profiles.
	if _, err := s.SaveInstrumentCatalogBatch(ctx, []portfolio.Instrument{missing, other}); err != nil {
		t.Fatal(err)
	}
	next, err = s.NextInstrumentToRefresh(ctx)
	if err != nil || next == nil || next.ISIN == failedISIN || next.DataStatus != "catalog" {
		t.Fatalf("failed profile blocked the next one: %+v %v", next, err)
	}
	next.DataStatus = "enriched"
	if err := s.SaveInstrument(ctx, next); err != nil {
		t.Fatal(err)
	}
	next, err = s.NextInstrumentToRefresh(ctx)
	if err != nil || next == nil || next.ISIN != old.ISIN {
		t.Fatalf("old profiles not refreshed during retry cooldown: %+v %v", next, err)
	}
	if _, err := s.db.Exec(`UPDATE instruments SET last_refresh_attempt_at=? WHERE isin=?`, time.Now().UTC().Add(-6*time.Minute).Format(time.RFC3339), failedISIN); err != nil {
		t.Fatal(err)
	}
	next, err = s.NextInstrumentToRefresh(ctx)
	if err != nil || next == nil || next.ISIN != failedISIN {
		t.Fatalf("failed profile was never retried: %+v %v", next, err)
	}
}
