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
	"loot/backend/internal/portfolio"
	"loot/backend/internal/store"
	portv1 "loot/proto/gen/go/v1"
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

// --- RateService ---

func (s *Server) ListReferenceRates(ctx context.Context, req *connect.Request[portv1.ListReferenceRatesRequest]) (*connect.Response[portv1.ListReferenceRatesResponse], error) {
	rates, err := s.store.ListReferenceRates(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	pbRates := make([]*portv1.ReferenceRate, len(rates))
	for i, r := range rates {
		pbRates[i] = referenceRateToProto(r)
	}
	return connect.NewResponse(&portv1.ListReferenceRatesResponse{Rates: pbRates}), nil
}

func (s *Server) UpdateReferenceRate(ctx context.Context, req *connect.Request[portv1.UpdateReferenceRateRequest]) (*connect.Response[portv1.UpdateReferenceRateResponse], error) {
	if req.Msg.Rate == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("rate is required"))
	}
	rate := referenceRateFromProto(req.Msg.Rate)
	if err := s.store.SaveReferenceRate(ctx, rate); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.UpdateReferenceRateResponse{}), nil
}

func (s *Server) ListTaxRates(ctx context.Context, req *connect.Request[portv1.ListTaxRatesRequest]) (*connect.Response[portv1.ListTaxRatesResponse], error) {
	pbRates := make([]*portv1.TaxRate, len(s.taxRates))
	for i, r := range s.taxRates {
		pbRates[i] = taxRateToProto(r)
	}
	return connect.NewResponse(&portv1.ListTaxRatesResponse{Rates: pbRates}), nil
}

// --- AccountService ---

func (s *Server) accountsWithRevenue(ctx context.Context) ([]portfolio.Account, error) {
	rates, err := s.store.ListReferenceRates(ctx)
	if err != nil {
		return nil, err
	}
	references := make(map[string]int64, len(rates))
	for _, rate := range rates {
		references[rate.Code] = rate.RateBPS
	}
	accounts, err := s.store.ListAccounts(ctx)
	if err != nil {
		return nil, err
	}
	holdings, err := s.store.ListHoldings(ctx)
	if err != nil {
		return nil, err
	}
	byAccount := make(map[int64]*portfolio.Account, len(accounts))
	for i := range accounts {
		byAccount[accounts[i].ID] = &accounts[i]
	}
	for _, holding := range holdings {
		if account := byAccount[holding.AccountID]; account != nil {
			account.HoldingCount++
			account.HoldingsValueMinor += holding.ValueMinor
		}
	}
	for i := range accounts {
		accounts[i].TotalAssetsMinor = accounts[i].BalanceMinor + accounts[i].HoldingsValueMinor
		if accounts[i].Archived {
			continue
		}
		revenue, resolvedTiers, err := portfolio.CalculateRevenue(accounts[i], references)
		if err != nil {
			return nil, fmt.Errorf("calculate revenue for %s: %w", accounts[i].Name, err)
		}
		accounts[i].Tiers = resolvedTiers
		accounts[i].GrossRevenueMinor = revenue.GrossMinor
		accounts[i].TaxMinor = revenue.TaxMinor
		accounts[i].NetRevenueMinor = revenue.NetMinor
	}
	return accounts, nil
}

func (s *Server) ListAccounts(ctx context.Context, req *connect.Request[portv1.ListAccountsRequest]) (*connect.Response[portv1.ListAccountsResponse], error) {
	accounts, err := s.accountsWithRevenue(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	sortField := ""
	if req.Msg.Sort != nil {
		sortField = *req.Msg.Sort
	}

	if sortField == "" {
		slices.SortStableFunc(accounts, func(a, b portfolio.Account) int {
			if order := cmp.Compare(boolInt(a.Archived), boolInt(b.Archived)); order != 0 {
				return order
			}
			if order := cmp.Compare(b.TotalAssetsMinor, a.TotalAssetsMinor); order != 0 {
				return order
			}
			return cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
		})
	} else {
		columns := map[string]func(portfolio.Account, portfolio.Account) int{
			"name":      func(a, b portfolio.Account) int { return cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)) },
			"type":      func(a, b portfolio.Account) int { return cmp.Compare(a.Type, b.Type) },
			"cash":      func(a, b portfolio.Account) int { return cmp.Compare(a.BalanceMinor, b.BalanceMinor) },
			"holdings":  func(a, b portfolio.Account) int { return cmp.Compare(a.HoldingsValueMinor, b.HoldingsValueMinor) },
			"total":     func(a, b portfolio.Account) int { return cmp.Compare(a.TotalAssetsMinor, b.TotalAssetsMinor) },
			"gross":     func(a, b portfolio.Account) int { return cmp.Compare(a.GrossRevenueMinor, b.GrossRevenueMinor) },
			"per_day":   func(a, b portfolio.Account) int { return cmp.Compare(a.GrossRevenueMinor, b.GrossRevenueMinor) },
			"per_month": func(a, b portfolio.Account) int { return cmp.Compare(a.GrossRevenueMinor, b.GrossRevenueMinor) },
			"per_year":  func(a, b portfolio.Account) int { return cmp.Compare(a.GrossRevenueMinor, b.GrossRevenueMinor) },
			"net":       func(a, b portfolio.Account) int { return cmp.Compare(a.NetRevenueMinor, b.NetRevenueMinor) },
		}
		if err := sortSlice(sortField, accounts, columns); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
	}

	pbAccounts := make([]*portv1.Account, len(accounts))
	for i, a := range accounts {
		pbAccounts[i] = accountToProto(a)
	}
	return connect.NewResponse(&portv1.ListAccountsResponse{Accounts: pbAccounts}), nil
}

func (s *Server) CreateAccount(ctx context.Context, req *connect.Request[portv1.CreateAccountRequest]) (*connect.Response[portv1.CreateAccountResponse], error) {
	if req.Msg.Account == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("account is required"))
	}
	account := accountFromProto(req.Msg.Account)
	account.ID = 0
	if err := s.store.SaveAccount(ctx, &account); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.CreateAccountResponse{Account: accountToProto(account)}), nil
}

func (s *Server) UpdateAccount(ctx context.Context, req *connect.Request[portv1.UpdateAccountRequest]) (*connect.Response[portv1.UpdateAccountResponse], error) {
	if req.Msg.Account == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("account is required"))
	}
	account := accountFromProto(req.Msg.Account)
	account.ID = req.Msg.Id
	if err := s.store.SaveAccount(ctx, &account); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.UpdateAccountResponse{Account: accountToProto(account)}), nil
}

func (s *Server) DeleteAccount(ctx context.Context, req *connect.Request[portv1.DeleteAccountRequest]) (*connect.Response[portv1.DeleteAccountResponse], error) {
	if err := s.store.DeleteAccount(ctx, req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.DeleteAccountResponse{}), nil
}

// --- SummaryService ---

func (s *Server) GetSummary(ctx context.Context, req *connect.Request[portv1.GetSummaryRequest]) (*connect.Response[portv1.GetSummaryResponse], error) {
	accounts, err := s.accountsWithRevenue(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	holdings, err := s.store.ListHoldings(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	byCurrency := make(map[string]*portv1.CurrencySummary)
	allocations := make(map[string]map[string]int64)
	archivedAccounts := make(map[int64]bool)

	for _, account := range accounts {
		if account.Archived {
			archivedAccounts[account.ID] = true
			continue
		}
		item := byCurrency[account.Currency]
		if item == nil {
			item = &portv1.CurrencySummary{Currency: account.Currency}
			byCurrency[account.Currency] = item
		}
		item.BalanceMinor += account.BalanceMinor
		item.GrossRevenueMinor += account.GrossRevenueMinor
		item.TaxMinor += account.TaxMinor
		item.FeesMinor += account.AnnualFeeMinor
		item.NetRevenueMinor += account.NetRevenueMinor
	}

	for _, holding := range holdings {
		if archivedAccounts[holding.AccountID] {
			continue
		}
		item := byCurrency[holding.Currency]
		if item == nil {
			item = &portv1.CurrencySummary{Currency: holding.Currency}
			byCurrency[holding.Currency] = item
		}
		item.InvestedMinor += holding.InvestedMinor
		item.PortfolioMinor += holding.ValueMinor
		if allocations[holding.Currency] == nil {
			allocations[holding.Currency] = make(map[string]int64)
		}
		assetClass := holding.AssetClass
		if assetClass == "" {
			assetClass = "other"
		}
		allocations[holding.Currency][assetClass] += holding.ValueMinor
	}

	for _, item := range byCurrency {
		item.TotalMinor = item.BalanceMinor + item.PortfolioMinor
		types := make([]string, 0, len(allocations[item.Currency]))
		for instrumentType := range allocations[item.Currency] {
			types = append(types, instrumentType)
		}
		slices.Sort(types)
		for _, assetClass := range types {
			item.Allocations = append(item.Allocations, &portv1.InstrumentAllocation{
				AssetClass: assetClass,
				ValueMinor: allocations[item.Currency][assetClass],
			})
		}
	}

	result := &portv1.Summary{BaseCurrency: s.baseCurrency}
	for _, currency := range []string{s.baseCurrency} {
		if item := byCurrency[currency]; item != nil {
			result.Currencies = append(result.Currencies, item)
			delete(byCurrency, currency)
		}
	}
	keys := make([]string, 0, len(byCurrency))
	for currency := range byCurrency {
		keys = append(keys, currency)
	}
	slices.Sort(keys)
	for _, currency := range keys {
		result.Currencies = append(result.Currencies, byCurrency[currency])
	}

	return connect.NewResponse(&portv1.GetSummaryResponse{Summary: result}), nil
}

// --- InstrumentService ---

func (s *Server) ListInstruments(ctx context.Context, req *connect.Request[portv1.ListInstrumentsRequest]) (*connect.Response[portv1.ListInstrumentsResponse], error) {
	instruments, err := s.store.ListInstruments(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	sortField := ""
	if req.Msg.Sort != nil {
		sortField = *req.Msg.Sort
	}

	if sortField != "" {
		columns := map[string]func(portfolio.Instrument, portfolio.Instrument) int{
			"name": func(a, b portfolio.Instrument) int {
				return cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
			},
			"ticker": func(a, b portfolio.Instrument) int { return cmp.Compare(a.Ticker, b.Ticker) },
			"isin":   func(a, b portfolio.Instrument) int { return cmp.Compare(a.ISIN, b.ISIN) },
			"type":   func(a, b portfolio.Instrument) int { return cmp.Compare(a.InstrumentType, b.InstrumentType) },
			"issuer": func(a, b portfolio.Instrument) int {
				return cmp.Compare(strings.ToLower(a.Provider), strings.ToLower(b.Provider))
			},
			"asset_class": func(a, b portfolio.Instrument) int { return cmp.Compare(a.AssetClass, b.AssetClass) },
			"domicile":    func(a, b portfolio.Instrument) int { return cmp.Compare(a.Domicile, b.Domicile) },
			"currency":    func(a, b portfolio.Instrument) int { return cmp.Compare(a.FundCurrency, b.FundCurrency) },
			"inception":   func(a, b portfolio.Instrument) int { return cmp.Compare(a.InceptionDate, b.InceptionDate) },
			"exposure": func(a, b portfolio.Instrument) int {
				return cmp.Compare(strings.ToLower(a.IndexName), strings.ToLower(b.IndexName))
			},
			"policy":      func(a, b portfolio.Instrument) int { return cmp.Compare(a.Distribution, b.Distribution) },
			"replication": func(a, b portfolio.Instrument) int { return cmp.Compare(a.Replication, b.Replication) },
			"ter":         func(a, b portfolio.Instrument) int { return cmp.Compare(a.TERBPS, b.TERBPS) },
			"size":        func(a, b portfolio.Instrument) int { return cmp.Compare(a.FundSizeMillion, b.FundSizeMillion) },
			"tracking": func(a, b portfolio.Instrument) int {
				return compareOptional(a.TrackingDifferenceBPS, b.TrackingDifferenceBPS)
			},
			"enriched": func(a, b portfolio.Instrument) int { return cmp.Compare(a.EnrichedAt, b.EnrichedAt) },
			"starred":  func(a, b portfolio.Instrument) int { return cmp.Compare(boolInt(a.Starred), boolInt(b.Starred)) },
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
	instruments, err := s.justETF.Search(ctx, req.Msg.Query)
	if err != nil {
		return nil, justETFConnectError(ctx, req.Msg.Query, err)
	}
	pbInstruments := make([]*portv1.Instrument, len(instruments))
	for i, inst := range instruments {
		pbInstruments[i] = instrumentToProto(inst)
	}
	return connect.NewResponse(&portv1.SearchInstrumentsResponse{Instruments: pbInstruments}), nil
}

func (s *Server) SyncInstrumentCatalog(ctx context.Context, req *connect.Request[portv1.SyncInstrumentCatalogRequest]) (*connect.Response[portv1.SyncInstrumentCatalogResponse], error) {
	limit := int(req.Msg.Limit)
	if limit == 0 {
		limit = 4_000
	}
	if limit < 1 || limit > 4_000 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("catalog limit must be between 1 and 4000"))
	}
	instruments, available, err := s.justETF.Catalog(ctx, limit)
	if err != nil {
		return nil, justETFConnectError(ctx, "catalog", err)
	}
	for i := range instruments {
		if err := s.store.SaveInstrument(ctx, &instruments[i]); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	return connect.NewResponse(&portv1.SyncInstrumentCatalogResponse{
		Saved:     int32(len(instruments)),
		Available: int32(available),
	}), nil
}

func (s *Server) EnrichInstrumentCatalog(ctx context.Context, req *connect.Request[portv1.EnrichInstrumentCatalogRequest]) (*connect.Response[portv1.EnrichInstrumentCatalogResponse], error) {
	limit := int(req.Msg.Limit)
	if limit == 0 {
		limit = 20
	}
	items, err := s.store.ListInstrumentsToEnrich(ctx, limit)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	enriched, failed := 0, 0
	for _, item := range items {
		_, err := s.enrichInstrument(ctx, item, false)
		if err != nil {
			failed++
			slog.WarnContext(ctx, "justETF enrichment failed", "isin", item.ISIN, "error", err)
			if errors.Is(err, justetf.ErrRateLimited) {
				break
			}
			continue
		}
		enriched++
	}
	return connect.NewResponse(&portv1.EnrichInstrumentCatalogResponse{
		Enriched: int32(enriched),
		Failed:   int32(failed),
	}), nil
}

func (s *Server) StreamInstrumentCatalog(ctx context.Context, req *connect.Request[portv1.StreamInstrumentCatalogRequest], stream *connect.ServerStream[portv1.EnrichmentProgress]) error {
	mode := req.Msg.Mode
	if mode != "missing" && mode != "oldest" && mode != "discover" {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("mode must be missing, oldest, or discover"))
	}

	progress := &portv1.EnrichmentProgress{Mode: mode, Phase: "loading"}
	if err := stream.Send(progress); err != nil {
		return err
	}

	var items []portfolio.Instrument
	if mode == "discover" {
		candidates, available, err := s.justETF.CatalogCandidates(ctx, 4_000)
		if err != nil {
			progress.Done = true
			errStr := err.Error()
			progress.Error = &errStr
			_ = stream.Send(progress)
			return nil
		}
		known, err := s.store.ListInstruments(ctx)
		if err != nil {
			progress.Done = true
			errStr := err.Error()
			progress.Error = &errStr
			_ = stream.Send(progress)
			return nil
		}
		seen := make(map[string]bool, len(known))
		for _, instrument := range known {
			seen[instrument.ISIN] = true
		}
		excluded, err := s.store.ListInstrumentExclusions(ctx)
		if err != nil {
			progress.Done = true
			errStr := err.Error()
			progress.Error = &errStr
			_ = stream.Send(progress)
			return nil
		}
		for _, candidate := range candidates {
			if !seen[candidate.ISIN] && !excluded[candidate.ISIN] {
				items = append(items, candidate)
			}
		}
		availInt32 := int32(available)
		progress.Available = &availInt32
	} else {
		var err error
		items, err = s.store.ListInstrumentsForEnrichment(ctx, mode)
		if err != nil {
			progress.Done = true
			errStr := err.Error()
			progress.Error = &errStr
			_ = stream.Send(progress)
			return nil
		}
	}

	progress.Phase = "enriching"
	progress.Total = int32(len(items))
	if err := stream.Send(progress); err != nil {
		return err
	}

	for _, item := range items {
		currentIsin := item.ISIN
		progress.Current = &currentIsin
		skipped, err := s.enrichInstrument(ctx, item, mode == "discover")
		progress.Processed++
		if err != nil {
			progress.Failed++
			slog.WarnContext(ctx, "streamed justETF enrichment failed", "isin", item.ISIN, "error", err)
			if errors.Is(err, justetf.ErrRateLimited) {
				errStr := "justETF blocked requests; enrichment stopped and will back off before the next run"
				progress.Error = &errStr
				_ = stream.Send(progress)
				return nil
			}
		} else if skipped {
			progress.Skipped++
		} else {
			progress.Enriched++
		}
		if err := stream.Send(progress); err != nil {
			return err
		}
	}

	progress.Current = nil
	progress.Done = true
	return stream.Send(progress)
}

func (s *Server) enrichInstrument(ctx context.Context, item portfolio.Instrument, requireUCITS bool) (bool, error) {
	instrument, err := s.justETF.Lookup(ctx, item.ISIN)
	if err != nil {
		return false, err
	}
	if requireUCITS && !instrument.UCITS {
		return true, s.store.SaveInstrumentExclusion(ctx, instrument.ISIN, "not_ucits")
	}
	if err := s.store.SaveInstrument(ctx, &instrument); err != nil {
		return false, err
	}
	return false, nil
}

func (s *Server) CreateInstrument(ctx context.Context, req *connect.Request[portv1.CreateInstrumentRequest]) (*connect.Response[portv1.CreateInstrumentResponse], error) {
	if req.Msg.Instrument == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("instrument is required"))
	}
	instrument := instrumentFromProto(req.Msg.Instrument)
	instrument.ID = 0
	if err := s.store.SaveInstrument(ctx, &instrument); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.CreateInstrumentResponse{Instrument: instrumentToProto(instrument)}), nil
}

func (s *Server) LookupInstrument(ctx context.Context, req *connect.Request[portv1.LookupInstrumentRequest]) (*connect.Response[portv1.LookupInstrumentResponse], error) {
	instrument, err := s.justETF.Lookup(ctx, req.Msg.Query)
	if err != nil {
		return nil, justETFConnectError(ctx, req.Msg.Query, err)
	}
	if err := s.store.SaveInstrument(ctx, &instrument); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&portv1.LookupInstrumentResponse{Instrument: instrumentToProto(instrument)}), nil
}

func (s *Server) ImportInstruments(ctx context.Context, req *connect.Request[portv1.ImportInstrumentsRequest]) (*connect.Response[portv1.ImportInstrumentsResponse], error) {
	isins := req.Msg.Isins
	if len(isins) == 0 || len(isins) > 20 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("select between 1 and 20 instruments"))
	}
	seen := make(map[string]bool, len(isins))
	imported := make([]portfolio.Instrument, 0, len(isins))
	for _, isin := range isins {
		isin = strings.ToUpper(strings.TrimSpace(isin))
		if seen[isin] {
			continue
		}
		seen[isin] = true
		instrument, err := s.justETF.Lookup(ctx, isin)
		if err != nil {
			return nil, justETFConnectError(ctx, isin, err)
		}
		imported = append(imported, instrument)
	}
	for i := range imported {
		if err := s.store.SaveInstrument(ctx, &imported[i]); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	pbImported := make([]*portv1.Instrument, len(imported))
	for i, inst := range imported {
		pbImported[i] = instrumentToProto(inst)
	}
	return connect.NewResponse(&portv1.ImportInstrumentsResponse{Instruments: pbImported}), nil
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
	instruments, err := s.store.ListInstruments(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	for _, instrument := range instruments {
		if instrument.ID == req.Msg.Id {
			alternatives := portfolio.FindInstrumentAlternatives(instrument, instruments, time.Now())
			pbAlternatives := make([]*portv1.InstrumentAlternative, len(alternatives))
			for i, alt := range alternatives {
				pbAlternatives[i] = instrumentAlternativeToProto(alt)
			}
			return connect.NewResponse(&portv1.GetInstrumentAlternativesResponse{Alternatives: pbAlternatives}), nil
		}
	}
	return nil, connect.NewError(connect.CodeNotFound, errors.New("instrument not found"))
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
	for i, r := range ranked {
		pbRanked[i] = rankedInstrumentToProto(r)
	}
	return connect.NewResponse(&portv1.RankInstrumentsResponse{RankedInstruments: pbRanked}), nil
}

// --- HoldingService ---

func (s *Server) ListHoldings(ctx context.Context, req *connect.Request[portv1.ListHoldingsRequest]) (*connect.Response[portv1.ListHoldingsResponse], error) {
	holdings, err := s.store.ListHoldings(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	sortField := ""
	if req.Msg.Sort != nil {
		sortField = *req.Msg.Sort
	}

	if sortField != "" {
		columns := map[string]func(portfolio.Holding, portfolio.Holding) int{
			"account": func(a, b portfolio.Holding) int {
				return cmp.Compare(strings.ToLower(a.AccountName), strings.ToLower(b.AccountName))
			},
			"instrument": func(a, b portfolio.Holding) int {
				return cmp.Compare(strings.ToLower(a.InstrumentName), strings.ToLower(b.InstrumentName))
			},
			"ticker":      func(a, b portfolio.Holding) int { return cmp.Compare(a.InstrumentTicker, b.InstrumentTicker) },
			"isin":        func(a, b portfolio.Holding) int { return cmp.Compare(a.InstrumentISIN, b.InstrumentISIN) },
			"type":        func(a, b portfolio.Holding) int { return cmp.Compare(a.InstrumentType, b.InstrumentType) },
			"asset_class": func(a, b portfolio.Holding) int { return cmp.Compare(a.AssetClass, b.AssetClass) },
			"invested":    func(a, b portfolio.Holding) int { return cmp.Compare(a.InvestedMinor, b.InvestedMinor) },
			"value":       func(a, b portfolio.Holding) int { return cmp.Compare(a.ValueMinor, b.ValueMinor) },
			"planned":     func(a, b portfolio.Holding) int { return cmp.Compare(a.PlannedBPS, b.PlannedBPS) },
			"actual":      func(a, b portfolio.Holding) int { return cmp.Compare(a.ActualBPS, b.ActualBPS) },
			"change": func(a, b portfolio.Holding) int {
				return cmp.Compare(a.ValueMinor-a.InvestedMinor, b.ValueMinor-b.InvestedMinor)
			},
			"tax": func(a, b portfolio.Holding) int { return cmp.Compare(a.TaxBPS, b.TaxBPS) },
		}
		if err := sortSlice(sortField, holdings, columns); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
	}

	pbHoldings := make([]*portv1.Holding, len(holdings))
	for i, h := range holdings {
		pbHoldings[i] = holdingToProto(h)
	}
	return connect.NewResponse(&portv1.ListHoldingsResponse{Holdings: pbHoldings}), nil
}

func (s *Server) CreateHolding(ctx context.Context, req *connect.Request[portv1.CreateHoldingRequest]) (*connect.Response[portv1.CreateHoldingResponse], error) {
	if req.Msg.Holding == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("holding is required"))
	}
	holding := holdingFromProto(req.Msg.Holding)
	holding.ID = 0
	if err := s.store.SaveHolding(ctx, &holding); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.CreateHoldingResponse{Holding: holdingToProto(holding)}), nil
}

func (s *Server) UpdateHolding(ctx context.Context, req *connect.Request[portv1.UpdateHoldingRequest]) (*connect.Response[portv1.UpdateHoldingResponse], error) {
	if req.Msg.Holding == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("holding is required"))
	}
	holding := holdingFromProto(req.Msg.Holding)
	holding.ID = req.Msg.Id
	if err := s.store.SaveHolding(ctx, &holding); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.UpdateHoldingResponse{Holding: holdingToProto(holding)}), nil
}

func (s *Server) DeleteHolding(ctx context.Context, req *connect.Request[portv1.DeleteHoldingRequest]) (*connect.Response[portv1.DeleteHoldingResponse], error) {
	if err := s.store.DeleteHolding(ctx, req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.DeleteHoldingResponse{}), nil
}

// --- SnapshotService ---

func (s *Server) ListSnapshots(ctx context.Context, req *connect.Request[portv1.ListSnapshotsRequest]) (*connect.Response[portv1.ListSnapshotsResponse], error) {
	snapshots, err := s.store.ListSnapshots(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	sortField := ""
	if req.Msg.Sort != nil {
		sortField = *req.Msg.Sort
	}

	if sortField != "" {
		columns := map[string]func(portfolio.Snapshot, portfolio.Snapshot) int{
			"date":      func(a, b portfolio.Snapshot) int { return cmp.Compare(a.ObservedOn, b.ObservedOn) },
			"currency":  func(a, b portfolio.Snapshot) int { return cmp.Compare(a.Currency, b.Currency) },
			"cash":      func(a, b portfolio.Snapshot) int { return cmp.Compare(a.CashMinor, b.CashMinor) },
			"invested":  func(a, b portfolio.Snapshot) int { return cmp.Compare(a.InvestedMinor, b.InvestedMinor) },
			"portfolio": func(a, b portfolio.Snapshot) int { return cmp.Compare(a.PortfolioMinor, b.PortfolioMinor) },
			"total":     func(a, b portfolio.Snapshot) int { return cmp.Compare(a.TotalMinor, b.TotalMinor) },
		}
		if err := sortSlice(sortField, snapshots, columns); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
	}

	pbSnapshots := make([]*portv1.Snapshot, len(snapshots))
	for i, snap := range snapshots {
		pbSnapshots[i] = snapshotToProto(snap)
	}
	return connect.NewResponse(&portv1.ListSnapshotsResponse{Snapshots: pbSnapshots}), nil
}

func (s *Server) CreateSnapshot(ctx context.Context, req *connect.Request[portv1.CreateSnapshotRequest]) (*connect.Response[portv1.CreateSnapshotResponse], error) {
	if err := s.store.SaveSnapshot(ctx, req.Msg.ObservedOn); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.CreateSnapshotResponse{}), nil
}

func (s *Server) UpdateSnapshot(ctx context.Context, req *connect.Request[portv1.UpdateSnapshotRequest]) (*connect.Response[portv1.UpdateSnapshotResponse], error) {
	snap := portfolio.Snapshot{
		ID:             req.Msg.Id,
		ObservedOn:     req.Msg.ObservedOn,
		Currency:       req.Msg.Currency,
		CashMinor:      req.Msg.CashMinor,
		InvestedMinor:  req.Msg.InvestedMinor,
		PortfolioMinor: req.Msg.PortfolioMinor,
	}
	if err := s.store.UpdateSnapshot(ctx, snap); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.UpdateSnapshotResponse{Snapshot: snapshotToProto(snap)}), nil
}

func (s *Server) DeleteSnapshot(ctx context.Context, req *connect.Request[portv1.DeleteSnapshotRequest]) (*connect.Response[portv1.DeleteSnapshotResponse], error) {
	if err := s.store.DeleteSnapshot(ctx, req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.DeleteSnapshotResponse{}), nil
}

// --- Helpers ---

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
