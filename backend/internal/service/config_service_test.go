package service

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/roarc0/squirrel/backend/internal/auth"
	"github.com/roarc0/squirrel/backend/internal/config"
	"github.com/roarc0/squirrel/backend/internal/store"
)

func TestAIConfigAuthorizationAndCredentialDestination(t *testing.T) {
	data, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	secret := strings.Repeat("x", 32)
	path := filepath.Join(t.TempDir(), "squirrel.yaml")
	cfg := config.Config{Listen: "127.0.0.1:7340", BaseCurrency: "EUR", AIEndpoint: "https://original.invalid/v1", AIAPIKey: "test-key", Auth: config.AuthConfig{SessionSecret: secret, AdminGoogleID: "admin"}}
	handler := NewWithConfig(data, cfg, path)
	for _, tc := range []struct {
		method, user string
		want         int
	}{{"GET", "", 401}, {"PATCH", "", 401}, {"PATCH", "user", 403}, {"GET", "user", 200}, {"PATCH", "admin", 200}} {
		req := httptest.NewRequest(tc.method, "/api/config/ai", strings.NewReader(`{"model":"test"}`))
		if tc.user != "" {
			token, err := auth.SignSession(secret, tc.user, "", "")
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Fatalf("%s as %q: %d, want %d", tc.method, tc.user, rec.Code, tc.want)
		}
	}
	// Inspect state directly without any outbound AI request.
	s := &Server{config: cfg, configPath: path}
	token, _ := auth.SignSession(secret, "admin", "", "")
	patch := func(body string) int {
		req := httptest.NewRequest("PATCH", "/api/config/ai", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		s.handlePatchAIConfig(rec, req)
		return rec.Code
	}
	if patch(`{"endpoint":"http://remote.invalid/v1"}`) != http.StatusBadRequest || s.config.AIEndpoint != cfg.AIEndpoint {
		t.Fatal("invalid destination accepted")
	}
	if patch(`{"endpoint":"https://new.invalid/v1"}`) != 200 || s.config.AIAPIKey != "" {
		t.Fatal("key retained across destination change")
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(saved), "test-key") {
		t.Fatal("old key remains on disk")
	}
	if patch(`{"endpoint":"https://third.invalid/v1","api_key":"replacement"}`) != 200 || s.config.AIAPIKey != "replacement" {
		t.Fatal("explicit replacement failed")
	}
	if s.aiAPIKey("", "", cfg.AIEndpoint) != "" {
		t.Fatal("concurrent endpoint change can send key to old destination")
	}
	s.configPath = filepath.Join(t.TempDir(), "missing", "config.yaml")
	if patch(`{"model":"unsaved"}`) != 500 || s.config.AIModel == "unsaved" {
		t.Fatal("failed persistence changed live config")
	}
	local := &Server{config: config.Config{}}
	rec := httptest.NewRecorder()
	local.handlePatchAIConfig(rec, httptest.NewRequest("PATCH", "/api/config/ai", strings.NewReader(`{"model":"local"}`)))
	if rec.Code != 200 {
		t.Fatal("local no-auth mode broken")
	}
}
