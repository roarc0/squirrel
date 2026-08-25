package btp

import (
	"context"
	"database/sql"
	"log"
	"strings"

	"connectrpc.com/connect"

	portv1 "loot/proto/gen/go/v1"
	"loot/proto/gen/go/v1/portv1connect"
)

type Service struct {
	portv1connect.UnimplementedBtpServiceHandler
	store   *Store
	scraper *Scraper
}

func NewService(db *sql.DB) *Service {
	return &Service{
		store:   NewStore(db),
		scraper: NewScraper(""),
	}
}

func (s *Service) ListBtps(ctx context.Context, req *connect.Request[portv1.ListBtpsRequest]) (*connect.Response[portv1.ListBtpsResponse], error) {
	btps, lastUpdated, err := s.store.GetBtps(ctx, "")
	if err != nil {
		log.Printf("[btp.service] GetBtps error: %v", err)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	targetYear := int(req.Msg.GetTargetMaturityYear())
	if targetYear > 0 {
		cfg := ScoringConfig{TargetMaturityYear: targetYear}
		btps = ComputeAdvancedScores(btps, cfg)
	}

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
			Isin:             b.ISIN,
			Name:             b.Name,
			BondType:         string(b.BondType),
			Price:            b.Price,
			Coupon:           b.Coupon,
			ExpiryDate:       b.ExpiryDate,
			MaturityYears:    b.MaturityYears,
			DurationMac:      b.DurationMac,
			DurationMod:      b.DurationMod,
			RateHikeImpact:   b.RateHikeImpact,
			SimpleYieldNet:   b.SimpleYieldNet,
			SimpleYieldGross: b.SimpleYieldGross,
			YtmGross:         b.YTMGross,
			YtmNet:           b.YTMNet,
			TotalReturnNet:   b.TotalReturnNet,
			TotalReturnGross: b.TotalReturnGross,
			Score:            b.Score,
			TierRank:         b.TierRank,
			IsTraded:         b.IsTraded,
			ScrapedAt:        b.ScrapedAt,
			IsStarred:        b.IsStarred,
		})
	}

	log.Printf("[btp.service] ListBtps returning %d filtered of %d cached BTPs", len(filtered), len(btps))
	return connect.NewResponse(&portv1.ListBtpsResponse{
		Btps:        filtered,
		LastUpdated: lastUpdated,
		TotalCount:  int32(len(filtered)),
	}), nil
}

func (s *Service) RefreshBtps(ctx context.Context, req *connect.Request[portv1.RefreshBtpsRequest]) (*connect.Response[portv1.RefreshBtpsResponse], error) {
	log.Printf("[btp.service] RefreshBtps triggered (targetMaturityYear=%d)", req.Msg.GetTargetMaturityYear())
	cfg := ScoringConfig{
		TaxRate:            0.125,
		TargetMaturityYear: int(req.Msg.GetTargetMaturityYear()),
	}

	btps, err := s.scraper.ScrapeAll(cfg)
	if err != nil {
		log.Printf("[btp.service] ScrapeAll failed: %v", err)
		return nil, connect.NewError(connect.CodeUnavailable, err)
	}

	log.Printf("[btp.service] ScrapeAll returned %d BTPs; saving to cache...", len(btps))
	if err := s.store.SaveBtpsCache(ctx, btps); err != nil {
		log.Printf("[btp.service] SaveBtpsCache failed: %v", err)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	_, lastUpdated, _ := s.store.GetBtps(ctx, "")
	log.Printf("[btp.service] RefreshBtps completed successfully with %d BTPs (lastUpdated=%s)", len(btps), lastUpdated)

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

	starred, err := s.store.ToggleStar(ctx, "", isin, req.Msg.GetStarred())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&portv1.ToggleStarBtpResponse{
		Starred: starred,
	}), nil
}
