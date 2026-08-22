package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"

	"loot/backend/internal/portfolio"
)

type AIModelConfig struct {
	ID          string `yaml:"id"`
	Name        string `yaml:"name"`
	Filename    string `yaml:"filename"`
	SourceURL   string `yaml:"source_url"`
	Description string `yaml:"description"`
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
	AIModels              []AIModelConfig     `yaml:"ai_models"`
}

func DefaultAIModels() []AIModelConfig {
	return []AIModelConfig{
		{
			ID:          "deepseek-r1-distill-qwen-7b",
			Name:        "DeepSeek R1 Distill Qwen 7B (Premier Math & Reasoning)",
			Filename:    "deepseek-r1-distill-qwen-7b-q4_k_m.gguf",
			SourceURL:   "https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
			Description: "High-precision reasoning model with chain-of-thought verification for portfolio math & fee calculations.",
		},
		{
			ID:          "qwen2.5-math-7b-instruct",
			Name:        "Qwen 2.5 Math 7B Instruct (High Math Accuracy)",
			Filename:    "qwen2.5-math-7b-instruct-q4_k_m.gguf",
			SourceURL:   "https://huggingface.co/Qwen/Qwen2.5-Math-7B-Instruct-GGUF/resolve/main/qwen2.5-math-7b-instruct-q4_k_m.gguf",
			Description: "Specialized mathematical reasoning model tuned for zero-hallucination arithmetic and asset math.",
		},
		{
			ID:          "deepseek-r1-distill-qwen-1.5b",
			Name:        "DeepSeek R1 Distill Qwen 1.5B (Fast Local Reasoning)",
			Filename:    "deepseek-r1-distill-qwen-1.5b-q4_k_m.gguf",
			SourceURL:   "https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
			Description: "Fast 1.5B reasoning model for local Metal GPU execution.",
		},
		{
			ID:          "qwen2.5-3b-instruct",
			Name:        "Qwen 2.5 3B Instruct (Default)",
			Filename:    "qwen2.5-3b-instruct-q4_k_m.gguf",
			SourceURL:   "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
			Description: "3B parameters, high accuracy for financial analysis & portfolio rebalancing.",
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
		Database:              "data/loot.db",
		BaseCurrency:          "EUR",
		LogLevel:              "info",
		JustETFEnrichInterval: 2 * time.Second,
		TaxRates: []portfolio.TaxRate{
			{Code: "IT_ORDINARY", Label: "Italy · ordinary financial income", RateBPS: 2600},
			{Code: "IT_GOVERNMENT_BOND", Label: "Italy · government/white-list bonds", RateBPS: 1250},
		},
		AIProvider: "local",
		AIEndpoint: "http://127.0.0.1:8080/v1",
		AIModel:       "deepseek-r1-distill-qwen-7b",
		AIAPIKey:      "",
		AIContextSize: 16384,
		AIModels:      DefaultAIModels(),
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
	}

	if cfg.AIContextSize <= 0 {
		cfg.AIContextSize = 16384
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
	return nil
}
