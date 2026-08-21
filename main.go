package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"loot/internal/config"
	"loot/internal/httpapi"
	"loot/internal/store"
)

var version = "dev"

func main() {
	configPath := flag.String("config", "", "path to YAML configuration")
	showVersion := flag.Bool("version", false, "print version")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
	level := new(slog.LevelVar)
	if err := level.UnmarshalText([]byte(cfg.LogLevel)); err != nil {
		fmt.Fprintln(os.Stderr, "log level:", err)
		os.Exit(1)
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})))

	data, err := store.Open(cfg.Database)
	if err != nil {
		slog.Error("open database", "error", err)
		os.Exit(1)
	}
	defer data.Close()

	server := &http.Server{
		Addr:              cfg.Listen,
		Handler:           httpapi.New(data, cfg.BaseCurrency, cfg.TaxRates, cfg.JustETFEnrichInterval),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		slog.Info("LOOT is ready", "url", "http://"+cfg.Listen, "database", cfg.Database)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("serve", "error", err)
			os.Exit(1)
		}
	}()

	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	<-stop.Done()
	ctx, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelShutdown()
	if err := server.Shutdown(ctx); err != nil {
		slog.Error("shutdown", "error", err)
	}
}
