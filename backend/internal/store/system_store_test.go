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
	srcPath := filepath.Join(srcDir, "squirrel.db")

	s1, err := Open(srcPath)
	if err != nil {
		t.Fatalf("Open src: %v", err)
	}

	// Insert account
	if _, err := s1.db.Exec(`INSERT INTO accounts (user_id, name, currency, balance_minor, created_at, updated_at) VALUES ('testuser', 'Test Account', 'EUR', 10000, '2026-08-22', '2026-08-22')`); err != nil {
		t.Fatalf("Insert account: %v", err)
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

	// 2. Restore backup into a new target database
	dstDir := t.TempDir()
	dstPath := filepath.Join(dstDir, "squirrel.db")

	s2, err := Open(dstPath)
	if err != nil {
		t.Fatalf("Open dst: %v", err)
	}
	defer s2.Close()

	if err := s2.RestoreBackup(ctx, "testuser", tarGzBytes); err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}

	// 3. Verify data in restored database
	accounts, err := s2.ListAccounts(ctx, "testuser")
	if err != nil {
		t.Fatalf("ListAccounts in restored db: %v", err)
	}

	if len(accounts) != 1 || accounts[0].Name != "Test Account" {
		t.Fatalf("Unexpected accounts in restored db: %+v", accounts)
	}
}
