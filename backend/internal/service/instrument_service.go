package service

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect"

	"loot/backend/internal/portfolio"
	"loot/backend/internal/store"
	portv1 "loot/proto/gen/go/v1"
)

func (s *Server) ListInstruments(ctx context.Context, req *connect.Request[portv1.ListInstrumentsRequest]) (*connect.Response[portv1.ListInstrumentsResponse], error) {
	instruments, err := s.store.ListInstruments(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	sortField := ""
	if req.Msg.Sort != nil {
		sortField = *req.Msg.Sort
	}

	if sortField == "" {
		slices.SortStableFunc(instruments, func(a, b portfolio.Instrument) int {
			if order := cmp.Compare(boolInt(b.Starred), boolInt(a.Starred)); order != 0 {
				return order
			}
			if order := cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)); order != 0 {
				return order
			}
			return cmp.Compare(a.ISIN, b.ISIN)
		})
	} else {
		columns := map[string]func(portfolio.Instrument, portfolio.Instrument) int{
			"isin":             func(a, b portfolio.Instrument) int { return cmp.Compare(a.ISIN, b.ISIN) },
			"name":             func(a, b portfolio.Instrument) int { return cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)) },
			"type":             func(a, b portfolio.Instrument) int { return cmp.Compare(a.InstrumentType, b.InstrumentType) },
			"asset":            func(a, b portfolio.Instrument) int { return cmp.Compare(a.AssetClass, b.AssetClass) },
			"strategy":         func(a, b portfolio.Instrument) int { return cmp.Compare(a.Strategy, b.Strategy) },
			"hedged":           func(a, b portfolio.Instrument) int { return cmp.Compare(boolInt(a.CurrencyHedged), boolInt(b.CurrencyHedged)) },
			"status":           func(a, b portfolio.Instrument) int { return cmp.Compare(a.DataStatus, b.DataStatus) },
			"distribution":     func(a, b portfolio.Instrument) int { return cmp.Compare(a.Distribution, b.Distribution) },
			"replication":      func(a, b portfolio.Instrument) int { return cmp.Compare(a.Replication, b.Replication) },
			"ter":              func(a, b portfolio.Instrument) int { return cmp.Compare(a.TERBPS, b.TERBPS) },
			"size":             func(a, b portfolio.Instrument) int { return cmp.Compare(a.FundSizeMillion, b.FundSizeMillion) },
			"tracking_diff":    func(a, b portfolio.Instrument) int { return compareOptional(a.TrackingDifferenceBPS, b.TrackingDifferenceBPS) },
			"tracking_error":   func(a, b portfolio.Instrument) int { return compareOptional(a.TrackingErrorBPS, b.TrackingErrorBPS) },
			"ucits":            func(a, b portfolio.Instrument) int { return cmp.Compare(boolInt(a.UCITS), boolInt(b.UCITS)) },
			"starred":          func(a, b portfolio.Instrument) int { return cmp.Compare(boolInt(a.Starred), boolInt(b.Starred)) },
		}
		if err := sortSlice(sortField, instruments, columns); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
	}

	pbInstruments := make([]*portv1.Instrument, len(instruments))
	for i, inst := range instruments {
		pbInstruments[i] = instrumentToProto(inst)
	}
	return connect.NewResponse(&portv1.ListInstrumentsResponse{Instruments: pbInstruments}), nil
}

func (s *Server) SearchInstruments(ctx context.Context, req *connect.Request[portv1.SearchInstrumentsRequest]) (*connect.Response[portv1.SearchInstrumentsResponse], error) {
	query := strings.TrimSpace(req.Msg.Query)
	if query == "" {
		return connect.NewResponse(&portv1.SearchInstrumentsResponse{Instruments: []*portv1.Instrument{}}), nil
	}
	results, err := s.justETF.Search(ctx, query)
	if err != nil {
		return nil, justETFConnectError(ctx, query, err)
	}
	pbInstruments := make([]*portv1.Instrument, len(results))
	for i, inst := range results {
		pbInstruments[i] = instrumentToProto(inst)
	}
	return connect.NewResponse(&portv1.SearchInstrumentsResponse{Instruments: pbInstruments}), nil
}

func (s *Server) SyncInstrumentCatalog(ctx context.Context, req *connect.Request[portv1.SyncInstrumentCatalogRequest]) (*connect.Response[portv1.SyncInstrumentCatalogResponse], error) {
	limit := int(req.Msg.Limit)
	if limit <= 0 {
		limit = 4000
	}
	items, available, err := s.justETF.Catalog(ctx, limit)
	if err != nil {
		return nil, justETFConnectError(ctx, "catalog sync", err)
	}
	saved, err := s.store.SaveInstrumentCatalogBatch(ctx, items)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.SyncInstrumentCatalogResponse{Saved: int32(saved), Available: int32(available)}), nil
}

func (s *Server) StreamInstrumentCatalog(ctx context.Context, req *connect.Request[portv1.StreamInstrumentCatalogRequest], stream *connect.ServerStream[portv1.EnrichmentProgress]) error {
	mode := req.Msg.Mode
	if mode == "" {
		mode = "missing"
	}
	instruments, err := s.store.ListInstrumentsForEnrichment(ctx, mode)
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	avail := int32(len(instruments))
	progress := &portv1.EnrichmentProgress{
		Mode:      mode,
		Phase:     "enriching",
		Total:     int32(len(instruments)),
		Available: &avail,
	}
	if err := stream.Send(progress); err != nil {
		return err
	}

	for _, target := range instruments {
		isin := target.ISIN
		progress.Current = &isin
		progress.Processed++

		if target.DataStatus == portfolio.InstrumentStatusCatalog && !target.UCITS {
			progress.Skipped++
			continue
		}

		if err := s.enrichInstrument(ctx, target.ISIN); err != nil {
			progress.Failed++
			errMsg := fmt.Sprintf("Failed to refresh %s: %v", target.ISIN, err)
			progress.Error = &errMsg
			_ = stream.Send(progress)
			return connect.NewError(connect.CodeInternal, err)
		}

		progress.Enriched++
		progress.Error = nil
		if err := stream.Send(progress); err != nil {
			return err
		}
	}

	progress.Current = nil
	progress.Phase = "done"
	progress.Done = true
	return stream.Send(progress)
}

func (s *Server) EnrichInstrumentCatalog(ctx context.Context, req *connect.Request[portv1.EnrichInstrumentCatalogRequest]) (*connect.Response[portv1.EnrichInstrumentCatalogResponse], error) {
	limit := int(req.Msg.Limit)
	if limit <= 0 {
		limit = 20
	}
	candidates, err := s.store.ListInstrumentsToEnrich(ctx, limit)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	var enriched, failed int32
	for _, target := range candidates {
		if err := s.enrichInstrument(ctx, target.ISIN); err != nil {
			slog.WarnContext(ctx, "failed to enrich instrument", "isin", target.ISIN, "error", err)
			failed++
			continue
		}
		enriched++
	}
	return connect.NewResponse(&portv1.EnrichInstrumentCatalogResponse{Enriched: enriched, Failed: failed}), nil
}

func (s *Server) CreateInstrument(ctx context.Context, req *connect.Request[portv1.CreateInstrumentRequest]) (*connect.Response[portv1.CreateInstrumentResponse], error) {
	if req.Msg.Instrument == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("instrument is required"))
	}
	inst := instrumentFromProto(req.Msg.Instrument)
	inst.ID = 0
	if err := s.store.SaveInstrument(ctx, &inst); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.CreateInstrumentResponse{Instrument: instrumentToProto(inst)}), nil
}

func (s *Server) LookupInstrument(ctx context.Context, req *connect.Request[portv1.LookupInstrumentRequest]) (*connect.Response[portv1.LookupInstrumentResponse], error) {
	query := strings.TrimSpace(req.Msg.Query)
	if query == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("lookup query is required"))
	}
	if portfolio.ValidISIN(query) {
		inst, err := s.store.GetInstrumentByISIN(ctx, query)
		if err == nil {
			return connect.NewResponse(&portv1.LookupInstrumentResponse{Instrument: instrumentToProto(inst)}), nil
		}
	}
	results, err := s.justETF.Search(ctx, query)
	if err != nil {
		return nil, justETFConnectError(ctx, query, err)
	}
	if len(results) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("no matching instrument found"))
	}
	target := results[0]
	existing, err := s.store.GetInstrumentByISIN(ctx, target.ISIN)
	if err == nil {
		target = existing
	}
	if err := s.enrichInstrument(ctx, target.ISIN); err != nil {
		if target.ID > 0 {
			return connect.NewResponse(&portv1.LookupInstrumentResponse{Instrument: instrumentToProto(target)}), nil
		}
		return nil, justETFConnectError(ctx, target.ISIN, err)
	}
	saved, err := s.store.GetInstrumentByISIN(ctx, target.ISIN)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.LookupInstrumentResponse{Instrument: instrumentToProto(saved)}), nil
}

func (s *Server) ImportInstruments(ctx context.Context, req *connect.Request[portv1.ImportInstrumentsRequest]) (*connect.Response[portv1.ImportInstrumentsResponse], error) {
	isins := req.Msg.Isins
	var result []portfolio.Instrument
	for _, raw := range isins {
		isin := strings.ToUpper(strings.TrimSpace(raw))
		if !portfolio.ValidISIN(isin) {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid ISIN %q", raw))
		}
		res, err := s.LookupInstrument(ctx, connect.NewRequest(&portv1.LookupInstrumentRequest{Query: isin}))
		if err != nil {
			return nil, err
		}
		result = append(result, instrumentFromProto(res.Msg.Instrument))
	}
	pbInstruments := make([]*portv1.Instrument, len(result))
	for i, inst := range result {
		pbInstruments[i] = instrumentToProto(inst)
	}
	return connect.NewResponse(&portv1.ImportInstrumentsResponse{Instruments: pbInstruments}), nil
}

func (s *Server) DeleteInstrument(ctx context.Context, req *connect.Request[portv1.DeleteInstrumentRequest]) (*connect.Response[portv1.DeleteInstrumentResponse], error) {
	if err := s.store.DeleteInstrument(ctx, req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.DeleteInstrumentResponse{}), nil
}

func (s *Server) StarInstrument(ctx context.Context, req *connect.Request[portv1.StarInstrumentRequest]) (*connect.Response[portv1.StarInstrumentResponse], error) {
	if err := s.store.SetInstrumentStarred(ctx, req.Msg.Isin, req.Msg.Starred); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.StarInstrumentResponse{}), nil
}

func (s *Server) GetInstrumentAlternatives(ctx context.Context, req *connect.Request[portv1.GetInstrumentAlternativesRequest]) (*connect.Response[portv1.GetInstrumentAlternativesResponse], error) {
	inst, err := s.store.GetInstrumentByID(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	instruments, err := s.store.ListInstruments(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	alts := portfolio.FindInstrumentAlternatives(inst, instruments, time.Now())
	pbAlts := make([]*portv1.InstrumentAlternative, len(alts))
	for i, alt := range alts {
		pbAlts[i] = instrumentAlternativeToProto(alt)
	}
	return connect.NewResponse(&portv1.GetInstrumentAlternativesResponse{Alternatives: pbAlts}), nil
}

func (s *Server) RankInstruments(ctx context.Context, req *connect.Request[portv1.RankInstrumentsRequest]) (*connect.Response[portv1.RankInstrumentsResponse], error) {
	if req.Msg.Criteria == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("criteria is required"))
	}
	criteria := rankCriteriaFromProto(req.Msg.Criteria)
	instruments, err := s.store.ListInstruments(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	ranked, err := portfolio.RankInstruments(instruments, criteria, time.Now())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	pbRanked := make([]*portv1.RankedInstrument, len(ranked))
	for i, score := range ranked {
		pbRanked[i] = rankedInstrumentToProto(score)
	}
	return connect.NewResponse(&portv1.RankInstrumentsResponse{RankedInstruments: pbRanked}), nil
}

func (s *Server) enrichInstrument(ctx context.Context, isin string) error {
	existing, err := s.store.GetInstrumentByISIN(ctx, isin)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	profile, err := s.justETF.Lookup(ctx, isin)
	if err != nil {
		return err
	}
	if !profile.UCITS {
		if saveErr := s.store.SaveInstrumentExclusion(ctx, isin, "non_ucits"); saveErr != nil {
			slog.WarnContext(ctx, "failed to record non-UCITS exclusion", "isin", isin, "error", saveErr)
		}
	}
	if existing.ID > 0 {
		profile.ID = existing.ID
		if profile.Name == "" {
			profile.Name = existing.Name
		}
		if profile.InstrumentType == "" {
			profile.InstrumentType = existing.InstrumentType
		}
		if profile.FundCurrency == "" {
			profile.FundCurrency = existing.FundCurrency
		}
		profile.Starred = existing.Starred
	}
	return s.store.SaveInstrument(ctx, &profile)
}
