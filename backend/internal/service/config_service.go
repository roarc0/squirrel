package service

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/roarc0/squirrel/backend/internal/auth"
	"go.yaml.in/yaml/v3"
)

type aiConfigResponse struct {
	Provider    string `json:"provider"`
	Endpoint    string `json:"endpoint"`
	Model       string `json:"model"`
	ContextSize int    `json:"context_size"`
	HasAPIKey   bool   `json:"has_api_key"`
}

func (s *Server) authorizeAIConfig(w http.ResponseWriter, r *http.Request) bool {
	s.configMu.RLock()
	secret, admin := s.config.Auth.SessionSecret, s.config.Auth.AdminGoogleID
	s.configMu.RUnlock()
	if secret == "" {
		return true
	}
	ctx, err := auth.NewInterceptor(secret).Authenticate(r.Context(), r.Header)
	if err != nil {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return false
	}
	if r.Method != http.MethodGet {
		if err := auth.RequireAdmin(ctx, admin); err != nil {
			http.Error(w, "admin only", http.StatusForbidden)
			return false
		}
	}
	return true
}

func (s *Server) handleGetAIConfig(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAIConfig(w, r) {
		return
	}
	s.configMu.RLock()
	resp := aiConfigResponse{
		Provider:    s.config.AIProvider,
		Endpoint:    s.config.AIEndpoint,
		Model:       s.config.AIModel,
		ContextSize: s.config.AIContextSize,
		HasAPIKey:   s.config.AIAPIKey != "",
	}
	s.configMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) handlePatchAIConfig(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAIConfig(w, r) {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		http.Error(w, "read body: "+err.Error(), http.StatusBadRequest)
		return
	}

	var patch struct {
		Provider    *string `json:"provider"`
		Endpoint    *string `json:"endpoint"`
		Model       *string `json:"model"`
		APIKey      *string `json:"api_key"`
		ContextSize *int    `json:"context_size"`
	}
	if err := json.Unmarshal(body, &patch); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	if patch.Endpoint != nil {
		endpoint := strings.TrimRight(strings.TrimSpace(*patch.Endpoint), "/")
		parsed, err := validateHTTPSOrLoopbackURL(endpoint)
		if err != nil || len(endpoint) > 2048 || parsed.RawQuery != "" || parsed.Fragment != "" {
			http.Error(w, "invalid AI endpoint", http.StatusBadRequest)
			return
		}
		patch.Endpoint = &endpoint
	}
	if patch.ContextSize != nil && (*patch.ContextSize <= 0 || *patch.ContextSize > int(maxAIContextSize)) {
		http.Error(w, "invalid context size", http.StatusBadRequest)
		return
	}
	s.configMu.Lock()
	defer s.configMu.Unlock()
	next := s.config
	if patch.Provider != nil {
		next.AIProvider = *patch.Provider
	}
	if patch.Endpoint != nil {
		if *patch.Endpoint != strings.TrimRight(strings.TrimSpace(next.AIEndpoint), "/") {
			next.AIAPIKey = ""
		}
		next.AIEndpoint = *patch.Endpoint
	}
	if patch.Model != nil {
		next.AIModel = *patch.Model
	}
	if patch.APIKey != nil && *patch.APIKey != "" {
		next.AIAPIKey = *patch.APIKey
	}
	if patch.ContextSize != nil {
		next.AIContextSize = *patch.ContextSize
	}
	if s.configPath != "" {
		if err := patchAIConfigYAML(s.configPath, next.AIProvider, next.AIEndpoint, next.AIModel, next.AIAPIKey, next.AIContextSize); err != nil {
			http.Error(w, "write config: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}
	s.config.AIProvider, s.config.AIEndpoint, s.config.AIModel = next.AIProvider, next.AIEndpoint, next.AIModel
	s.config.AIAPIKey, s.config.AIContextSize = next.AIAPIKey, next.AIContextSize
	resp := aiConfigResponse{Provider: next.AIProvider, Endpoint: next.AIEndpoint, Model: next.AIModel, ContextSize: next.AIContextSize, HasAPIKey: next.AIAPIKey != ""}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// patchAIConfigYAML surgically updates only the AI keys in the YAML file,
// preserving all other keys and comments. Writes atomically via a temp file.
func patchAIConfigYAML(path, provider, endpoint, model, apiKey string, contextSize int) error {
	// Read existing file (may or may not exist).
	var root yaml.Node
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read config: %w", err)
	}
	if len(data) > 0 {
		if err := yaml.Unmarshal(data, &root); err != nil {
			return fmt.Errorf("parse config: %w", err)
		}
	}

	// Ensure we have a document node with a mapping child.
	if root.Kind == 0 {
		root = yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{
			{Kind: yaml.MappingNode, Tag: "!!map"},
		}}
	}
	mapping := root.Content[0]
	if mapping.Kind != yaml.MappingNode {
		return fmt.Errorf("expected YAML mapping at root, got kind %d", mapping.Kind)
	}

	type kv struct {
		key string
		val interface{}
	}
	updates := []kv{
		{"ai_provider", provider},
		{"ai_endpoint", endpoint},
		{"ai_model", model},
		{"ai_context_size", contextSize},
	}
	updates = append(updates, kv{"ai_api_key", apiKey})

	for _, u := range updates {
		setMappingKey(mapping, u.key, u.val)
	}

	out, err := yaml.Marshal(&root)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	// Write to temp file in same directory then rename atomically.
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".squirrel-config-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		tmp.Close()
		_ = os.Remove(tmpName) // no-op if already renamed
	}()

	if err := tmp.Chmod(0o600); err != nil {
		return fmt.Errorf("chmod temp file: %w", err)
	}
	if _, err := tmp.Write(out); err != nil {
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("rename config: %w", err)
	}
	return nil
}

// setMappingKey finds key in a YAML mapping node and updates its value,
// or appends a new key-value pair if not found.
func setMappingKey(mapping *yaml.Node, key string, val interface{}) {
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			mapping.Content[i+1] = scalarNode(val)
			return
		}
	}
	// Not found — append.
	keyNode := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}
	mapping.Content = append(mapping.Content, keyNode, scalarNode(val))
}

func scalarNode(val interface{}) *yaml.Node {
	switch v := val.(type) {
	case string:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: v}
	case int:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: fmt.Sprintf("%d", v)}
	case bool:
		tag := "false"
		if v {
			tag = "true"
		}
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: tag}
	default:
		return &yaml.Node{Kind: yaml.ScalarNode, Value: fmt.Sprintf("%v", val)}
	}
}
