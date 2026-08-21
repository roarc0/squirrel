package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestExportAndRestoreBackup(t *testing.T) {
	ctx := context.Background()

	// 1. Create source database with sample data
	srcDir := t.TempDir()
	srcPath := filepath.Join(srcDir, "loot.db")

	s1, err := Open(srcPath)
	if err != nil {
		t.Fatalf("Open src: %v", err)
	}

	// Insert reference rate
	if _, err := s1.db.Exec(`INSERT INTO reference_rates (code, label, rate_bps, observed_on, updated_at) VALUES ('EURIBOR', 'Euribor 3M', 350, '2026-08-22', '2026-08-22')`); err != nil {
		t.Fatalf("Insert rate: %v", err)
	}

	// Export backup
	tarGzBytes, filename, err := s1.ExportBackup(ctx, srcPath)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	s1.Close()

	if len(tarGzBytes) == 0 || filename == "" {
		t.Fatalf("ExportBackup returned empty bytes or filename")
	}

	// 2. Restore backup into a new target database
	dstDir := t.TempDir()
	dstPath := filepath.Join(dstDir, "loot.db")

	s2, err := Open(dstPath)
	if err != nil {
		t.Fatalf("Open dst: %v", err)
	}
	defer s2.Close()

	if err := s2.RestoreBackup(ctx, dstPath, tarGzBytes); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}

	// 3. Verify data in restored database
	rates, err := s2.ListReferenceRates(ctx)
	if err != nil {
		t.Fatalf("ListReferenceRates in restored db: %v", err)
	}

	if len(rates) != 1 || rates[0].Code != "EURIBOR" || rates[0].RateBPS != 350 {
		t.Fatalf("Unexpected rates in restored db: %+v", rates)
	}
}
