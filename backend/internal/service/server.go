package service

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"github.com/roarc0/squirrel/backend/internal/auth"
	"github.com/roarc0/squirrel/backend/internal/btp"
	"github.com/roarc0/squirrel/backend/internal/config"
	"github.com/roarc0/squirrel/backend/internal/ecb"
	"github.com/roarc0/squirrel/backend/internal/justetf"
	"github.com/roarc0/squirrel/backend/internal/mcp"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	"github.com/roarc0/squirrel/backend/internal/store"
	"github.com/roarc0/squirrel/proto/gen/go/v1/portv1connect"
	"github.com/roarc0/squirrel/ui"
)

type Server struct {
	store        *store.Store
	config       config.Config
	baseCurrency string
	justETF      *justetf.Client
	ecb          *ecb.Client
	taxRates     []portfolio.TaxRate
	mcpHandler   *mcp.Handler
}

func New(data *store.Store, baseCurrency string, taxRates []portfolio.TaxRate, profileInterval ...time.Duration) http.Handler {
	cfg := config.Config{
		BaseCurrency: baseCurrency,
		TaxRates:     taxRates,
		AIModels:     config.DefaultAIModels(),
	}
	return NewWithConfig(data, cfg, profileInterval...)
}

func NewWithConfig(data *store.Store, cfg config.Config, profileInterval ...time.Duration) http.Handler {
	s := &Server{
		store:        data,
		config:       cfg,
		baseCurrency: cfg.BaseCurrency,
		justETF:      justetf.New(profileInterval...),
		ecb:          ecb.New(),
		taxRates:     cfg.TaxRates,
	}

	mux := http.NewServeMux()

	// Auth is optional: only active when session_secret is configured.
	connectOpts := []connect.HandlerOption{connect.WithReadMaxBytes(16 << 20)}
	if cfg.Auth.SessionSecret != "" {
		connectOpts = append(connectOpts, connect.WithInterceptors(auth.NewInterceptor(cfg.Auth.SessionSecret)))

		_, port, _ := net.SplitHostPort(cfg.Listen)
		redirectURL := "http://localhost:" + port + "/auth/callback/google"
		authHandler := auth.NewHandler(
			cfg.Auth.GoogleClientID,
			cfg.Auth.GoogleClientSecret,
			redirectURL,
			cfg.Auth.SessionSecret,
			cfg.Auth.AdminGoogleID,
			data,
		)
		mux.HandleFunc("GET /auth/login/google", authHandler.Login)
		mux.HandleFunc("GET /auth/callback/google", authHandler.Callback)
		mux.HandleFunc("GET /auth/me", authHandler.Me)

		if cfg.Auth.AdminGoogleID != "" {
			if err := data.ClaimAdminData(context.Background(), cfg.Auth.AdminGoogleID); err != nil {
				slog.Warn("startup claim admin data failed", "error", err)
			}
		}
	}

	// Register Connect RPC Handlers
	btpService := btp.NewService(data.DB(), cfg.Auth.SessionSecret != "", cfg.Auth.AdminGoogleID)
	mux.Handle(portv1connect.NewBtpServiceHandler(btpService, connectOpts...))
	mux.Handle(portv1connect.NewRateServiceHandler(s, connectOpts...))
	mux.Handle(portv1connect.NewAccountServiceHandler(s, connectOpts...))
	mux.Handle(portv1connect.NewSummaryServiceHandler(s, connectOpts...))
	mux.Handle(portv1connect.NewInstrumentServiceHandler(s, connectOpts...))
	mux.Handle(portv1connect.NewHoldingServiceHandler(s, connectOpts...))
	mux.Handle(portv1connect.NewSnapshotServiceHandler(s, connectOpts...))
	mux.Handle(portv1connect.NewSystemServiceHandler(s, connectOpts...))
	mux.Handle(portv1connect.NewProfileServiceHandler(s, connectOpts...))

	// Register Model Context Protocol (MCP) route
	mcpHandler := mcp.NewHandler(mux)
	s.mcpHandler = mcpHandler
	mux.Handle("/mcp", mcpHandler)
	mux.Handle("/mcp/", mcpHandler)

	// UI fallback handler
	mux.Handle("/", ui.Handler())

	// CORS & Security headers & request logging middleware
	reqLog := newRequestLogger()
	handler := requestLoggingMiddleware(reqLog)(withCORS(securityHeaders(mux)))
	return h2c.NewHandler(handler, &http2.Server{})
}

func (s *Server) requireAdmin(ctx context.Context) error {
	if s.config.Auth.SessionSecret == "" {
		return nil
	}
	return auth.RequireAdmin(ctx, s.config.Auth.AdminGoogleID)
}

func withCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && !isAllowedOrigin(origin) {
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", strings.Join(cors.AllowedMethods(), ", "))
			w.Header().Set("Access-Control-Allow-Headers", strings.Join(cors.AllowedHeaders(), ", "))
			w.Header().Set("Access-Control-Expose-Headers", strings.Join(cors.ExposedHeaders(), ", "))
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "::1" || u.Scheme == "app" || u.Scheme == "tauri" || u.Scheme == "vscode-webview"
}

func validateHTTPSOrLoopbackURL(raw string) (*url.URL, error) {
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return nil, errors.New("invalid URL")
	}
	if parsed.Scheme == "https" {
		return parsed, nil
	}
	ip := net.ParseIP(parsed.Hostname())
	if parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || ip != nil && ip.IsLoopback()) {
		return parsed, nil
	}
	return nil, errors.New("URL must use HTTPS (HTTP is allowed only on loopback)")
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
