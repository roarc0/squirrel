package store

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type BackupManifest struct {
	App        string `json:"app"`
	Version    int    `json:"version"`
	ExportedAt string `json:"exported_at"`
}

func (s *Store) ExportBackup(ctx context.Context, dbPath string) ([]byte, string, error) {
	if dbPath == ":memory:" || dbPath == "" {
		return nil, "", errors.New("cannot export backup from in-memory database")
	}

	tempDir, err := os.MkdirTemp("", "loot-export-*")
	if err != nil {
		return nil, "", fmt.Errorf("create temp export dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	tempDBPath := filepath.Join(tempDir, "loot.db")

	// Create consistent SQLite snapshot using VACUUM INTO
	if _, err := s.db.ExecContext(ctx, fmt.Sprintf("VACUUM INTO '%s'", tempDBPath)); err != nil {
		// Fallback to direct file copy if VACUUM INTO fails
		if errCopy := copyFile(dbPath, tempDBPath); errCopy != nil {
			return nil, "", fmt.Errorf("vacuum database: %w (copy fallback: %v)", err, errCopy)
		}
	}

	dbData, err := os.ReadFile(tempDBPath)
	if err != nil {
		return nil, "", fmt.Errorf("read vacuumed database: %w", err)
	}

	now := time.Now().UTC()
	manifest := BackupManifest{
		App:        "loot",
		Version:    1,
		ExportedAt: now.Format(time.RFC3339),
	}
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, "", fmt.Errorf("marshal manifest: %w", err)
	}

	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)

	// Add manifest.json to tar
	manifestHeader := &tar.Header{
		Name:    "manifest.json",
		Mode:    0644,
		Size:    int64(len(manifestBytes)),
		ModTime: now,
	}
	if err := tw.WriteHeader(manifestHeader); err != nil {
		return nil, "", fmt.Errorf("write manifest header: %w", err)
	}
	if _, err := tw.Write(manifestBytes); err != nil {
		return nil, "", fmt.Errorf("write manifest content: %w", err)
	}

	// Add loot.db to tar
	dbHeader := &tar.Header{
		Name:    "loot.db",
		Mode:    0600,
		Size:    int64(len(dbData)),
		ModTime: now,
	}
	if err := tw.WriteHeader(dbHeader); err != nil {
		return nil, "", fmt.Errorf("write db header: %w", err)
	}
	if _, err := tw.Write(dbData); err != nil {
		return nil, "", fmt.Errorf("write db content: %w", err)
	}

	if err := tw.Close(); err != nil {
		return nil, "", err
	}
	if err := gw.Close(); err != nil {
		return nil, "", err
	}

	filename := fmt.Sprintf("loot-backup-%s.tar.gz", now.Format("2006-01-02-150405"))
	return buf.Bytes(), filename, nil
}

func (s *Store) RestoreBackup(ctx context.Context, dbPath string, tarGzBytes []byte) error {
	if dbPath == ":memory:" || dbPath == "" {
		return errors.New("cannot restore backup into in-memory database")
	}
	if len(tarGzBytes) == 0 {
		return errors.New("backup file is empty")
	}

	tempDir, err := os.MkdirTemp("", "loot-restore-*")
	if err != nil {
		return fmt.Errorf("create temp restore dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	gr, err := gzip.NewReader(bytes.NewReader(tarGzBytes))
	if err != nil {
		return errors.New("invalid backup archive (not a valid gzipped tar file)")
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	var extractedDB []byte
	var manifestData []byte

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read tar entry: %w", err)
		}
		name := filepath.Base(header.Name)
		content, err := io.ReadAll(tr)
		if err != nil {
			return fmt.Errorf("read tar file %s: %w", name, err)
		}
		switch name {
		case "loot.db":
			extractedDB = content
		case "manifest.json":
			manifestData = content
		}
	}

	if len(extractedDB) == 0 {
		return errors.New("backup archive is missing loot.db")
	}

	if len(manifestData) > 0 {
		var manifest BackupManifest
		if err := json.Unmarshal(manifestData, &manifest); err == nil {
			if manifest.App != "" && manifest.App != "loot" {
				return fmt.Errorf("backup archive belongs to unknown application %q", manifest.App)
			}
		}
	}

	// Write extracted database to temp file and validate with SQLite PRAGMA quick_check
	tempDBPath := filepath.Join(tempDir, "restored.db")
	if err := os.WriteFile(tempDBPath, extractedDB, 0600); err != nil {
		return fmt.Errorf("write temp db: %w", err)
	}

	checkDB, err := sql.Open("sqlite", tempDBPath)
	if err != nil {
		return fmt.Errorf("open restored db for check: %w", err)
	}
	var checkResult string
	errCheck := checkDB.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&checkResult)
	checkDB.Close()
	if errCheck != nil || checkResult != "ok" {
		return errors.New("restored database validation failed (corrupted SQLite data)")
	}

	// Create automatic rollback backup
	nowStr := time.Now().UTC().Format("2006-01-02-150405")
	rollbackPath := fmt.Sprintf("%s.rollback-%s", dbPath, nowStr)

	if err := copyFile(dbPath, rollbackPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("create rollback backup: %w", err)
	}

	// Close current database connection
	_ = s.db.Close()

	// Atomically replace database file
	if err := copyFile(tempDBPath, dbPath); err != nil {
		// Attempt rollback
		_ = copyFile(rollbackPath, dbPath)
		newDB, _ := sql.Open("sqlite", dbPath)
		s.db = newDB
		return fmt.Errorf("restore database file: %w (rollback performed)", err)
	}

	// Open new database connection and apply any pending migrations
	newDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		_ = copyFile(rollbackPath, dbPath)
		rbDB, _ := sql.Open("sqlite", dbPath)
		s.db = rbDB
		return fmt.Errorf("open restored database: %w (rollback performed)", err)
	}
	newDB.SetMaxOpenConns(1)

	if err := migrate(newDB); err != nil {
		newDB.Close()
		_ = copyFile(rollbackPath, dbPath)
		rbDB, _ := sql.Open("sqlite", dbPath)
		s.db = rbDB
		return fmt.Errorf("migrate restored database: %w (rollback performed)", err)
	}

	s.db = newDB
	_ = os.Remove(rollbackPath)
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0700); err != nil {
		return err
	}

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}
