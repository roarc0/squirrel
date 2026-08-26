package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

type AIModelConfig struct {
	ID          string `yaml:"id"`
	Name        string `yaml:"name"`
	Filename    string `yaml:"filename"`
	SourceURL   string `yaml:"source_url"`
	Description string `yaml:"description"`
}

type AuthConfig struct {
	GoogleClientID     string `yaml:"google_client_id"`
	GoogleClientSecret string `yaml:"google_client_secret"`
	SessionSecret      string `yaml:"session_secret"`
	AdminGoogleID      string `yaml:"admin_google_id"`
}

type Config struct {
	Listen                string              `yaml:"listen"`
	Database              string              `yaml:"database"`
	BaseCurrency          string              `yaml:"base_currency"`
	LogLevel              string              `yaml:"log_level"`
	JustETFEnrichInterval time.Duration       `yaml:"justetf_enrich_interval"`
	TaxRates              []portfolio.TaxRate `yaml:"tax_rates"`
	AIProvider            string              `yaml:"ai_provider"`
	AIEndpoint            string              `yaml:"ai_endpoint"`
	AIModel               string              `yaml:"ai_model"`
	AIAPIKey              string              `yaml:"ai_api_key"`
	AIContextSize         int                 `yaml:"ai_context_size"`
	AISystemPrompt        string              `yaml:"ai_system_prompt"`
	AIModels              []AIModelConfig     `yaml:"ai_models"`
	Auth                  AuthConfig          `yaml:"auth"`
}

func DefaultSystemPrompt() string {
	return `You are an expert local-first financial portfolio AI assistant for Squirrel. You have MCP tools available and MUST use them to answer questions and take actions.

CRITICAL RULE: Always call tools using the tool_calls mechanism. NEVER write Python, pseudocode, shell commands, or code blocks to simulate a tool call. NEVER describe what you would do — always do it by invoking the real tool directly.

Read tools: list_holdings, list_accounts, search_instruments, rank_instruments, lookup_instrument, get_summary, get_diagnostics, list_snapshots, list_tax_rates.
Write tools: update_holding, create_holding, delete_holding.

Updating a holding: call update_holding with {"id": <holding_id>, "holding": {"pac_bps": <value>, "planned_bps": <value>, "is_pac": <bool>}}. All monetary/percentage values use basis points (bps): 10000 bps = 100%, 5000 bps = 50%, 0 = zero.

Workflow for portfolio changes:
1. Call list_holdings to get holding IDs and current values.
2. Call update_holding / create_holding / delete_holding to make the change.
3. Confirm what changed in plain language.

Never output raw JSON blobs, HTTP requests, or code. Never give binding legal or tax advice.`
}

func DefaultAIModels() []AIModelConfig {
	return []AIModelConfig{
		// --- Recommended for M5 / tool-calling ---
		{
			ID:          "qwen3-8b",
			Name:        "Qwen3 8B ★ Best tool calling ~5GB",
			Filename:    "Qwen_Qwen3-8B-Q4_K_M.gguf",
			SourceURL:   "https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF/resolve/main/Qwen_Qwen3-8B-Q4_K_M.gguf",
			Description: "#1 tool-calling model at the 8B size class (2025-2026 benchmarks). Native Jinja function-call template. Recommended default for M5.",
		},
		{
			ID:          "qwen3-14b",
			Name:        "Qwen3 14B ★ Best quality/speed ~10GB",
			Filename:    "Qwen_Qwen3-14B-Q4_K_M.gguf",
			SourceURL:   "https://huggingface.co/bartowski/Qwen_Qwen3-14B-GGUF/resolve/main/Qwen_Qwen3-14B-Q4_K_M.gguf",
			Description: "Top-ranked sub-20B model for structured tool calling. Sweet spot for M5 Pro/Max. Excellent reasoning.",
		},
		{
			ID:          "qwen3-27b-moe",
			Name:        "Qwen3.6 27B MoE ★ Fast reasoning ~17GB",
			Filename:    "Qwen_Qwen3.6-27B-Q4_K_M.gguf",
			SourceURL:   "https://huggingface.co/bartowski/Qwen_Qwen3.6-27B-GGUF/resolve/main/Qwen_Qwen3.6-27B-Q4_K_M.gguf",
			Description: "Mixture-of-Experts: only ~6B params active per token so fast inference despite size. #1 in 2026 function-calling benchmarks. For M5 Max 64GB+.",
		},
		{
			ID:          "deepseek-r1-0528-qwen3-8b",
			Name:        "DeepSeek R1 0528 Qwen3 8B ~5GB",
			Filename:    "deepseek-ai_DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf",
			SourceURL:   "https://huggingface.co/bartowski/deepseek-ai_DeepSeek-R1-0528-Qwen3-8B-GGUF/resolve/main/deepseek-ai_DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf",
			Description: "Qwen3-8B distilled with DeepSeek R1 reasoning traces. Strong chain-of-thought before tool dispatch.",
		},
		{
			ID:          "deepseek-r1-distill-qwen-14b",
			Name:        "DeepSeek R1 Distill Qwen 14B ~9GB",
			Filename:    "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
			SourceURL:   "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
			Description: "R1 reasoning distilled onto Qwen2.5-14B. Excellent for multi-step agentic workflows.",
		},
		{
			ID:          "deepseek-r1-distill-qwen-32b",
			Name:        "DeepSeek R1 Distill Qwen 32B ~20GB",
			Filename:    "DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf",
			SourceURL:   "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf",
			Description: "R1 reasoning on Qwen2.5-32B. Best reasoning quality before 70B. For M5 Max 48GB+.",
		},
		{
			ID:          "llama-3.3-70b-instruct",
			Name:        "Llama 3.3 70B Instruct ~40GB",
			Filename:    "Llama-3.3-70B-Instruct-Q4_K_M.gguf",
			SourceURL:   "https://huggingface.co/bartowski/Llama-3.3-70B-Instruct-GGUF/resolve/main/Llama-3.3-70B-Instruct-Q4_K_M.gguf",
			Description: "Meta's 70B flagship. Native tool-call JSON format. Best overall instruction following. For M5 Max 64GB+.",
		},
		// --- Legacy / kept for compatibility ---
		{
			ID:          "deepseek-r1-distill-qwen-7b",
			Name:        "DeepSeek R1 Distill Qwen 7B ~4.5GB",
			Filename:    "deepseek-r1-distill-qwen-7b-q4_k_m.gguf",
			SourceURL:   "https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
			Description: "Reasoning model distilled from DeepSeek R1 onto Qwen2.5-7B.",
		},
		{
			ID:          "qwen2.5-3b-instruct",
			Name:        "Qwen 2.5 3B Instruct ~2GB (too small for tools)",
			Filename:    "qwen2.5-3b-instruct-q4_k_m.gguf",
			SourceURL:   "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
			Description: "Lightweight 3B model. Not recommended for tool calling — hallucination-prone at this size.",
		},
		{
			ID:          "llama-3.2-3b-instruct",
			Name:        "Llama 3.2 3B Instruct",
			Filename:    "llama-3.2-3b-instruct-q4_k_m.gguf",
			SourceURL:   "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
			Description: "Meta Llama 3.2 3B reasoning model.",
		},
		{
			ID:          "phi-3.5-mini-instruct",
			Name:        "Phi 3.5 Mini Instruct",
			Filename:    "phi-3.5-mini-instruct-q4_k_m.gguf",
			SourceURL:   "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
			Description: "Microsoft Phi 3.5 Mini 3.8B instruct model.",
		},
	}
}

func Load(path string) (Config, error) {
	cfg := Config{
		Listen:                "127.0.0.1:7340",
		Database:              "data/squirrel.db",
		BaseCurrency:          "EUR",
		LogLevel:              "info",
		JustETFEnrichInterval: 2 * time.Second,
		TaxRates: []portfolio.TaxRate{
			{Code: "IT_ORDINARY", Label: "Italy · ordinary financial income", RateBPS: 2600},
			{Code: "IT_GOVERNMENT_BOND", Label: "Italy · government/white-list bonds", RateBPS: 1250},
		},
		AIProvider:     "local",
		AIEndpoint:     "http://127.0.0.1:8080/v1",
		AIModel:        "qwen3-8b",
		AIAPIKey:       "",
		AIContextSize:  16384,
		AISystemPrompt: DefaultSystemPrompt(),
		AIModels:       DefaultAIModels(),
	}
	if path != "" {
		f, err := os.Open(path)
		if err != nil {
			return Config{}, err
		}
		defer f.Close()
		dec := yaml.NewDecoder(f)
		dec.KnownFields(true)
		if err := dec.Decode(&cfg); err != nil {
			return Config{}, fmt.Errorf("decode config: %w", err)
		}
		if cfg.AIAPIKey != "" || cfg.Auth.GoogleClientSecret != "" || cfg.Auth.SessionSecret != "" {
			info, err := f.Stat()
			if err != nil {
				return Config{}, fmt.Errorf("inspect config permissions: %w", err)
			}
			if info.Mode().Perm()&0o077 != 0 {
				return Config{}, errors.New("config containing secrets must have permissions 0600")
			}
		}
	}

	if cfg.AIContextSize <= 0 {
		cfg.AIContextSize = 16384
	}
	if cfg.AISystemPrompt == "" {
		cfg.AISystemPrompt = DefaultSystemPrompt()
	}

	cfg.BaseCurrency = strings.ToUpper(strings.TrimSpace(cfg.BaseCurrency))
	cfg.LogLevel = strings.ToLower(strings.TrimSpace(cfg.LogLevel))
	for i := range cfg.TaxRates {
		cfg.TaxRates[i].Code = strings.ToUpper(strings.TrimSpace(cfg.TaxRates[i].Code))
		cfg.TaxRates[i].Label = strings.TrimSpace(cfg.TaxRates[i].Label)
	}
	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) validate() error {
	host, _, err := net.SplitHostPort(c.Listen)
	if err != nil {
		return fmt.Errorf("invalid listen address: %w", err)
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return errors.New("listen address must use a loopback IP such as 127.0.0.1")
	}
	if c.Database == "" {
		return errors.New("database path is required")
	}
	if len(c.BaseCurrency) != 3 {
		return errors.New("base_currency must be a three-letter currency code")
	}
	if c.JustETFEnrichInterval < time.Second || c.JustETFEnrichInterval > 5*time.Minute {
		return errors.New("justetf_enrich_interval must be between 1s and 5m")
	}
	seenTaxRates := make(map[string]bool, len(c.TaxRates))
	for _, rate := range c.TaxRates {
		if rate.Code == "" || rate.Label == "" || rate.RateBPS < 0 || rate.RateBPS > 10_000 {
			return errors.New("tax rates require a code, label, and rate between 0% and 100%")
		}
		if seenTaxRates[rate.Code] {
			return fmt.Errorf("duplicate tax rate %q", rate.Code)
		}
		seenTaxRates[rate.Code] = true
	}
	switch c.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return errors.New("log_level must be debug, info, warn, or error")
	}
	if c.Auth.GoogleClientID != "" || c.Auth.GoogleClientSecret != "" || c.Auth.SessionSecret != "" || c.Auth.AdminGoogleID != "" {
		if c.Auth.GoogleClientID == "" || c.Auth.GoogleClientSecret == "" || c.Auth.SessionSecret == "" {
			return errors.New("auth requires google_client_id, google_client_secret, and session_secret")
		}
		if len(c.Auth.SessionSecret) < 32 {
			return errors.New("auth session_secret must be at least 32 characters")
		}
	}
	return nil
}
