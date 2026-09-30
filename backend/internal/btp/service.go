package btp

import (
	"context"
	"database/sql"
	"log/slog"
	"strings"
	"time"

	"connectrpc.com/connect"

	"github.com/roarc0/squirrel/backend/internal/auth"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
	"github.com/roarc0/squirrel/proto/gen/go/v1/portv1connect"
)

type Service struct {
	portv1connect.UnimplementedBtpServiceHandler
	store         *Store
	scraper       *Scraper
	authEnabled   bool
	adminGoogleID string
}

func NewService(db *sql.DB, authEnabled bool, adminGoogleID string) *Service {
	return &Service{
		store:         NewStore(db),
		scraper:       NewScraper(""),
		authEnabled:   authEnabled,
		adminGoogleID: adminGoogleID,
	}
}

func (s *Service) ListBtps(ctx context.Context, req *connect.Request[portv1.ListBtpsRequest]) (*connect.Response[portv1.ListBtpsResponse], error) {
	btps, lastUpdated, err := s.store.GetBtps(ctx, auth.UserIDOrEmpty(ctx))
	if err != nil {
		slog.ErrorContext(ctx, "GetBtps error", "error", err)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Recompute old cached analytics under the current rules, using the quote date.
	for i := range btps {
		observed, err := time.ParseInLocation(time.DateTime, btps[i].ScrapedAt, time.Local)
		if err != nil {
			observed, err = time.Parse(time.RFC3339, btps[i].ScrapedAt)
		}
		if err != nil {
			btps[i].CalculateMetrics(0.125, time.Now())
			btps[i].AnalyticsAvailable = false
			btps[i].AnalyticsNote = "Analytics unavailable: quote date is missing or invalid."
		} else {
			btps[i].CalculateMetrics(0.125, observed)
		}
		if expiry, err := time.Parse("02/01/2006", btps[i].ExpiryDate); err != nil || !expiry.After(time.Now()) {
			btps[i].CalculateMetrics(0.125, time.Now())
		}
	}
	btps = ComputeAdvancedScores(btps, ScoringConfig{TargetMaturityYear: int(req.Msg.GetTargetMaturityYear())})

	query := strings.ToLower(strings.TrimSpace(req.Msg.GetQuery()))
	bondTypeFilter := strings.TrimSpace(req.Msg.GetBondType())
	starredOnly := req.Msg.GetStarredOnly()

	var filtered []*portv1.BtpBond
	for _, b := range btps {
		if starredOnly && !b.IsStarred {
			continue
		}
		if bondTypeFilter != "" && !strings.EqualFold(string(b.BondType), bondTypeFilter) {
			continue
		}
		if query != "" {
			matchIsin := strings.Contains(strings.ToLower(b.ISIN), query)
			matchName := strings.Contains(strings.ToLower(b.Name), query)
			if !matchIsin && !matchName {
				continue
			}
		}

		filtered = append(filtered, &portv1.BtpBond{
			Isin:               b.ISIN,
			Name:               b.Name,
			BondType:           string(b.BondType),
			Price:              b.Price,
			Coupon:             b.Coupon,
			ExpiryDate:         b.ExpiryDate,
			MaturityYears:      b.MaturityYears,
			DurationMac:        b.DurationMac,
			DurationMod:        b.DurationMod,
			RateHikeImpact:     b.RateHikeImpact,
			SimpleYieldNet:     b.SimpleYieldNet,
			SimpleYieldGross:   b.SimpleYieldGross,
			YtmGross:           b.YTMGross,
			YtmNet:             b.YTMNet,
			TotalReturnNet:     b.TotalReturnNet,
			TotalReturnGross:   b.TotalReturnGross,
			Score:              b.Score,
			TierRank:           b.TierRank,
			IsTraded:           b.IsTraded,
			ScrapedAt:          b.ScrapedAt,
			IsStarred:          b.IsStarred,
			AnalyticsAvailable: b.AnalyticsAvailable,
			AnalyticsNote:      b.AnalyticsNote,
		})
	}

	slog.DebugContext(ctx, "ListBtps returning filtered BTPs", "filtered", len(filtered), "cached", len(btps))
	return connect.NewResponse(&portv1.ListBtpsResponse{
		Btps:        filtered,
		LastUpdated: lastUpdated,
		TotalCount:  int32(len(filtered)),
	}), nil
}

func (s *Service) RefreshBtps(ctx context.Context, req *connect.Request[portv1.RefreshBtpsRequest]) (*connect.Response[portv1.RefreshBtpsResponse], error) {
	if s.authEnabled {
		if err := auth.RequireAdmin(ctx, s.adminGoogleID); err != nil {
			return nil, err
		}
	}
	slog.InfoContext(ctx, "RefreshBtps triggered", "targetMaturityYear", req.Msg.GetTargetMaturityYear())
	cfg := ScoringConfig{
		TaxRate:            0.125,
		TargetMaturityYear: int(req.Msg.GetTargetMaturityYear()),
	}

	btps, err := s.scraper.ScrapeAll(ctx, cfg)
	if err != nil {
		slog.ErrorContext(ctx, "ScrapeAll failed", "error", err)
		return nil, connect.NewError(connect.CodeUnavailable, err)
	}

	slog.InfoContext(ctx, "ScrapeAll returned BTPs; saving to cache", "count", len(btps))
	if err := s.store.SaveBtpsCache(ctx, btps); err != nil {
		slog.ErrorContext(ctx, "SaveBtpsCache failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	_, lastUpdated, _ := s.store.GetBtps(ctx, "")
	slog.InfoContext(ctx, "RefreshBtps completed successfully", "count", len(btps), "lastUpdated", lastUpdated)

	return connect.NewResponse(&portv1.RefreshBtpsResponse{
		Count:       int32(len(btps)),
		LastUpdated: lastUpdated,
	}), nil
}

func (s *Service) ToggleStarBtp(ctx context.Context, req *connect.Request[portv1.ToggleStarBtpRequest]) (*connect.Response[portv1.ToggleStarBtpResponse], error) {
	isin := strings.TrimSpace(req.Msg.GetIsin())
	if isin == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	starred, err := s.store.ToggleStar(ctx, auth.UserIDOrEmpty(ctx), isin, req.Msg.GetStarred())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&portv1.ToggleStarBtpResponse{
		Starred: starred,
	}), nil
}
