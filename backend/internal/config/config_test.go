package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadJustETFInterval(t *testing.T) {
	path := filepath.Join(t.TempDir(), "squirrel.yaml")
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
	if cfg.Database != "data/squirrel.db" {
		t.Fatalf("database=%q", cfg.Database)
	}
}

func TestAuthRequiresCompleteStrongSecrets(t *testing.T) {
	for name, contents := range map[string]string{
		"session secret only": "auth:\n  session_secret: 12345678901234567890123456789012\n",
		"weak secret":         "auth:\n  google_client_id: id\n  google_client_secret: secret\n  session_secret: short\n",
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "squirrel.yaml")
			if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := Load(path); err == nil {
				t.Fatal("invalid auth configuration should fail")
			}
		})
	}
}

func TestSecretConfigRequiresPrivatePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "squirrel.yaml")
	contents := "auth:\n  google_client_id: id\n  google_client_secret: secret\n  session_secret: 12345678901234567890123456789012\n"
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("world-readable secret config should fail")
	}
}
