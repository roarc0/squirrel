package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadJustETFInterval(t *testing.T) {
	path := filepath.Join(t.TempDir(), "loot.yaml")
	if err := os.WriteFile(path, []byte("justetf_enrich_interval: 15s\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.JustETFEnrichInterval != 15*time.Second {
		t.Fatalf("interval=%s", cfg.JustETFEnrichInterval)
	}
}

func TestDefaultDatabaseKeepsLegacyData(t *testing.T) {
	dir := t.TempDir()
	legacy := filepath.Join(dir, "port", "port.db")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if got := defaultDatabasePath(dir); got != legacy {
		t.Fatalf("database=%q want %q", got, legacy)
	}
}
