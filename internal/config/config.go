package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"

	"loot/internal/portfolio"
)

type Config struct {
	Listen                string              `yaml:"listen"`
	Database              string              `yaml:"database"`
	BaseCurrency          string              `yaml:"base_currency"`
	LogLevel              string              `yaml:"log_level"`
	JustETFEnrichInterval time.Duration       `yaml:"justetf_enrich_interval"`
	TaxRates              []portfolio.TaxRate `yaml:"tax_rates"`
}

func Load(path string) (Config, error) {
	cfg := Config{
		Listen:                "127.0.0.1:7340",
		BaseCurrency:          "EUR",
		LogLevel:              "info",
		JustETFEnrichInterval: 10 * time.Second,
		TaxRates: []portfolio.TaxRate{
			{Code: "IT_ORDINARY", Label: "Italy · ordinary financial income", RateBPS: 2600},
			{Code: "IT_GOVERNMENT_BOND", Label: "Italy · government/white-list bonds", RateBPS: 1250},
		},
	}
	if dir, err := os.UserConfigDir(); err == nil {
		cfg.Database = defaultDatabasePath(dir)
	} else {
		cfg.Database = "loot.db"
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

func defaultDatabasePath(configDir string) string {
	current := filepath.Join(configDir, "loot", "loot.db")
	legacy := filepath.Join(configDir, "port", "port.db")
	if _, err := os.Stat(current); errors.Is(err, os.ErrNotExist) {
		if _, err := os.Stat(legacy); err == nil {
			return legacy
		}
	}
	return current
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
