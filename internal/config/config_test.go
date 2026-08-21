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

func TestDefaultDatabaseUsesProjectDataDirectory(t *testing.T) {
	cfg, err := Load("")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Database != "data/loot.db" {
		t.Fatalf("database=%q", cfg.Database)
	}
}
