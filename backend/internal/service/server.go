package service

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"loot/backend/internal/justetf"
	"loot/backend/internal/mcp"
	"loot/backend/internal/portfolio"
	"loot/backend/internal/store"
	"loot/proto/gen/go/v1/portv1connect"
	"loot/ui"
)

type Server struct {
	store        *store.Store
	baseCurrency string
	justETF      *justetf.Client
	taxRates     []portfolio.TaxRate
}

func New(data *store.Store, baseCurrency string, taxRates []portfolio.TaxRate, profileInterval ...time.Duration) http.Handler {
	s := &Server{
		store:        data,
		baseCurrency: baseCurrency,
		justETF:      justetf.New(profileInterval...),
		taxRates:     taxRates,
	}

	mux := http.NewServeMux()

	// Register Connect RPC Handlers
	mux.Handle(portv1connect.NewRateServiceHandler(s))
	mux.Handle(portv1connect.NewAccountServiceHandler(s))
	mux.Handle(portv1connect.NewSummaryServiceHandler(s))
	mux.Handle(portv1connect.NewInstrumentServiceHandler(s))
	mux.Handle(portv1connect.NewHoldingServiceHandler(s))
	mux.Handle(portv1connect.NewSnapshotServiceHandler(s))
	mux.Handle(portv1connect.NewSystemServiceHandler(s))

	// Register Model Context Protocol (MCP) route
	mcpHandler := mcp.NewHandler(mux)
	mux.Handle("/mcp", mcpHandler)
	mux.Handle("/mcp/", mcpHandler)

	// UI fallback handler
	mux.Handle("/", ui.Handler())

	// CORS & Security headers middleware
	corsHandler := withCORS(securityHeaders(mux))
	return h2c.NewHandler(corsHandler, &http2.Server{})
}

func withCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", strings.Join(cors.AllowedMethods(), ", "))
		w.Header().Set("Access-Control-Allow-Headers", strings.Join(cors.AllowedHeaders(), ", "))
		w.Header().Set("Access-Control-Expose-Headers", strings.Join(cors.ExposedHeaders(), ", "))
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

func justETFConnectError(ctx context.Context, query string, err error) error {
	switch {
	case errors.Is(err, justetf.ErrInvalidQuery):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, justetf.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	default:
		slog.WarnContext(ctx, "justETF request failed", "query", query, "error", err)
		return connect.NewError(connect.CodeUnavailable, err)
	}
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func compareOptional(a, b *int64) int {
	if a == nil && b == nil {
		return 0
	}
	if a == nil {
		return 1
	}
	if b == nil {
		return -1
	}
	return cmp.Compare(*a, *b)
}

func sortSlice[T any](sortParam string, rows []T, columns map[string]func(T, T) int) error {
	column, desc, ok := strings.Cut(sortParam, ":")
	comparator := columns[column]
	if !ok || comparator == nil || (desc != "asc" && desc != "desc") {
		return fmt.Errorf("unsupported sort parameter %q", sortParam)
	}
	slices.SortStableFunc(rows, func(a, b T) int {
		if desc == "desc" {
			return comparator(b, a)
		}
		return comparator(a, b)
	})
	return nil
}
