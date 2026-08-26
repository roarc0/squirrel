package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"os"
	"path/filepath"

	"github.com/pressly/goose/v3"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var embedMigrations embed.FS

type Store struct {
	db     *sql.DB
	dbPath string
}

func (s *Store) DBPath() string { return s.dbPath }
func (s *Store) DB() *sql.DB    { return s.db }

func Open(path string) (*Store, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("configure database: %w", err)
	}
	if err = migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	if path != ":memory:" {
		if err := os.Chmod(path, 0o600); err != nil {
			db.Close()
			return nil, fmt.Errorf("protect database: %w", err)
		}
	}
	return &Store{db: db, dbPath: path}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func migrate(db *sql.DB) error {
	goose.SetBaseFS(embedMigrations)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("set goose dialect: %w", err)
	}
	if err := goose.Up(db, "migrations"); err != nil {
		return fmt.Errorf("run goose migrations: %w", err)
	}
	return nil
}

// ClaimAdminData assigns all unclaimed per-user data (user_id=”) to the admin.
func (s *Store) ClaimAdminData(ctx context.Context, googleID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE accounts SET preferred=0 WHERE user_id='' AND preferred=1 AND EXISTS (SELECT 1 FROM accounts WHERE user_id=? AND preferred=1)`, googleID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE accounts SET user_id=? WHERE user_id=''`, googleID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE snapshots SET user_id=? WHERE user_id=''`, googleID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_profiles WHERE user_id='' AND EXISTS (SELECT 1 FROM user_profiles WHERE user_id=?)`, googleID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE user_profiles SET user_id=? WHERE user_id=''`, googleID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM btp_starred WHERE user_id='' AND isin IN (SELECT isin FROM btp_starred WHERE user_id=?)`, googleID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE btp_starred SET user_id=? WHERE user_id=''`, googleID); err != nil {
		return err
	}
	return tx.Commit()
}
