package store

import (
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
	// Handle backward compatibility for databases migrated with legacy PRAGMA user_version
	var userVersion int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&userVersion); err == nil && userVersion > 0 {
		var hasGooseTable int
		err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='goose_db_version'`).Scan(&hasGooseTable)
		if err == nil && hasGooseTable == 0 {
			// Pre-initialize goose version tracking for legacy DBs already at schema version 1..9
			if _, err := db.Exec(`
				CREATE TABLE goose_db_version (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					version_id INTEGER NOT NULL,
					is_applied INTEGER NOT NULL,
					tstamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				);
				INSERT INTO goose_db_version (version_id, is_applied) VALUES (1, 1);
			`); err != nil {
				return fmt.Errorf("initialize goose version table for legacy database: %w", err)
			}
		}
	}

	goose.SetBaseFS(embedMigrations)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("set goose dialect: %w", err)
	}

	if err := goose.Up(db, "migrations"); err != nil {
		return fmt.Errorf("run goose migrations: %w", err)
	}

	if err := ensurePACHoldingsColumns(db); err != nil {
		return fmt.Errorf("ensure pac columns: %w", err)
	}

	if err := ensureNotesColumns(db); err != nil {
		return fmt.Errorf("ensure notes columns: %w", err)
	}

	return backfillInstrumentTypes(db)
}

func ensureNotesColumns(db *sql.DB) error {
	var hasAccountNotes int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('accounts') WHERE name='notes'`).Scan(&hasAccountNotes); err == nil && hasAccountNotes == 0 {
		_, _ = db.Exec(`ALTER TABLE accounts ADD COLUMN notes TEXT NOT NULL DEFAULT '';`)
	}

	var hasHoldings int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='holdings'`).Scan(&hasHoldings); err != nil || hasHoldings == 0 {
		return nil
	}
	var hasHoldingNotes int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('holdings') WHERE name='notes'`).Scan(&hasHoldingNotes); err == nil && hasHoldingNotes == 0 {
		_, _ = db.Exec(`ALTER TABLE holdings ADD COLUMN notes TEXT NOT NULL DEFAULT '';`)
	}
	return nil
}

func ensurePACHoldingsColumns(db *sql.DB) error {
	var hasAccountPac int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('accounts') WHERE name='pac_amount_minor'`).Scan(&hasAccountPac); err == nil && hasAccountPac == 0 {
		_, _ = db.Exec(`ALTER TABLE accounts ADD COLUMN pac_amount_minor INTEGER NOT NULL DEFAULT 0;`)
	}

	var hasHoldings int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='holdings'`).Scan(&hasHoldings); err != nil || hasHoldings == 0 {
		return nil
	}
	var hasPacBps int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('holdings') WHERE name='pac_bps'`).Scan(&hasPacBps); err == nil && hasPacBps == 0 {
		_, _ = db.Exec(`ALTER TABLE holdings ADD COLUMN pac_bps INTEGER NOT NULL DEFAULT 0;`)
	}
	var hasIsPac int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('holdings') WHERE name='is_pac'`).Scan(&hasIsPac); err == nil && hasIsPac == 0 {
		_, _ = db.Exec(`
			ALTER TABLE holdings ADD COLUMN is_pac INTEGER NOT NULL DEFAULT 0;
			ALTER TABLE holdings ADD COLUMN pac_frequency TEXT NOT NULL DEFAULT 'monthly';
		`)
	}
	return nil
}

func backfillInstrumentTypes(db *sql.DB) error {
	var hasName int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('instruments') WHERE name='name'`).Scan(&hasName); err != nil || hasName == 0 {
		return err
	}
	_, err := db.Exec(`
		UPDATE instruments SET instrument_type='etc' WHERE instrument_type='etf' AND upper(name) LIKE '% ETC%';
		UPDATE instruments SET instrument_type='etn' WHERE instrument_type='etf' AND upper(name) LIKE '% ETN%';
		UPDATE instruments SET asset_class='bond' WHERE asset_class IN ('', 'other') AND
			(lower(investment_focus) LIKE 'bond%' OR lower(name) LIKE '% bond%' OR lower(index_name) LIKE '% treasury%');
		UPDATE instruments SET asset_class='commodity' WHERE asset_class IN ('', 'other') AND
			(lower(investment_focus) LIKE 'commodit%' OR lower(investment_focus) LIKE 'precious metal%' OR lower(name) LIKE '% gold%' OR lower(name) LIKE '% silver%');`)
	return err
}
