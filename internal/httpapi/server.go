package httpapi

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"loot/internal/justetf"
	"loot/internal/portfolio"
	"loot/internal/store"
	"loot/ui"
)

type Server struct {
	store        *store.Store
	baseCurrency string
	justETF      *justetf.Client
	taxRates     []portfolio.TaxRate
}

type currencySummary struct {
	Currency          string                 `json:"currency"`
	BalanceMinor      int64                  `json:"balance_minor"`
	GrossRevenueMinor int64                  `json:"gross_revenue_minor"`
	TaxMinor          int64                  `json:"tax_minor"`
	FeesMinor         int64                  `json:"fees_minor"`
	NetRevenueMinor   int64                  `json:"net_revenue_minor"`
	InvestedMinor     int64                  `json:"invested_minor"`
	PortfolioMinor    int64                  `json:"portfolio_minor"`
	TotalMinor        int64                  `json:"total_minor"`
	Allocations       []instrumentAllocation `json:"allocations"`
}

type instrumentAllocation struct {
	AssetClass string `json:"asset_class"`
	ValueMinor int64  `json:"value_minor"`
}

type summary struct {
	BaseCurrency string            `json:"base_currency"`
	Currencies   []currencySummary `json:"currencies"`
}

func New(data *store.Store, baseCurrency string, taxRates []portfolio.TaxRate, profileInterval ...time.Duration) http.Handler {
	s := &Server{store: data, baseCurrency: baseCurrency, justETF: justetf.New(profileInterval...), taxRates: taxRates}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/summary", s.getSummary)
	mux.HandleFunc("GET /api/accounts", s.getAccounts)
	mux.HandleFunc("POST /api/accounts", s.createAccount)
	mux.HandleFunc("PUT /api/accounts/{id}", s.updateAccount)
	mux.HandleFunc("DELETE /api/accounts/{id}", s.deleteAccount)
	mux.HandleFunc("GET /api/reference-rates", s.getReferenceRates)
	mux.HandleFunc("PUT /api/reference-rates/{code}", s.putReferenceRate)
	mux.HandleFunc("GET /api/tax-rates", s.getTaxRates)
	mux.HandleFunc("GET /api/instruments", s.getInstruments)
	mux.HandleFunc("GET /api/instruments/search", s.searchInstruments)
	mux.HandleFunc("POST /api/instruments/catalog/sync", s.syncInstrumentCatalog)
	mux.HandleFunc("POST /api/instruments/catalog/enrich", s.enrichInstrumentCatalog)
	mux.HandleFunc("POST /api/instruments/catalog/enrich/stream", s.streamInstrumentCatalog)
	mux.HandleFunc("POST /api/instruments", s.putInstrument)
	mux.HandleFunc("POST /api/instruments/lookup", s.lookupInstrument)
	mux.HandleFunc("POST /api/instruments/import", s.importInstruments)
	mux.HandleFunc("DELETE /api/instruments/{id}", s.deleteInstrument)
	mux.HandleFunc("PUT /api/instruments/{isin}/star", s.starInstrument)
	mux.HandleFunc("GET /api/instruments/{id}/alternatives", s.getInstrumentAlternatives)
	mux.HandleFunc("POST /api/instruments/rank", s.rankInstruments)
	mux.HandleFunc("GET /api/holdings", s.getHoldings)
	mux.HandleFunc("POST /api/holdings", s.createHolding)
	mux.HandleFunc("PUT /api/holdings/{id}", s.updateHolding)
	mux.HandleFunc("DELETE /api/holdings/{id}", s.deleteHolding)
	mux.HandleFunc("GET /api/snapshots", s.getSnapshots)
	mux.HandleFunc("POST /api/snapshots", s.saveSnapshot)
	mux.HandleFunc("PUT /api/snapshots/{id}", s.updateSnapshot)
	mux.HandleFunc("DELETE /api/snapshots/{id}", s.deleteSnapshot)
	mux.Handle("/", ui.Handler())
	return securityHeaders(mux)
}

func (s *Server) getSummary(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.accountsWithRevenue(r)
	if err != nil {
		serverError(w, r, err)
		return
	}
	holdings, err := s.store.ListHoldings(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	byCurrency := make(map[string]*currencySummary)
	allocations := make(map[string]map[string]int64)
	archivedAccounts := make(map[int64]bool)
	for _, account := range accounts {
		if account.Archived {
			archivedAccounts[account.ID] = true
			continue
		}
		item := byCurrency[account.Currency]
		if item == nil {
			item = &currencySummary{Currency: account.Currency}
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
			item = &currencySummary{Currency: holding.Currency}
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
			item.Allocations = append(item.Allocations, instrumentAllocation{AssetClass: assetClass, ValueMinor: allocations[item.Currency][assetClass]})
		}
	}
	result := summary{BaseCurrency: s.baseCurrency}
	for _, currency := range []string{s.baseCurrency} {
		if item := byCurrency[currency]; item != nil {
			result.Currencies = append(result.Currencies, *item)
			delete(byCurrency, currency)
		}
	}
	keys := make([]string, 0, len(byCurrency))
	for currency := range byCurrency {
		keys = append(keys, currency)
	}
	slices.Sort(keys)
	for _, currency := range keys {
		result.Currencies = append(result.Currencies, *byCurrency[currency])
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) getAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.accountsWithRevenue(r)
	if err != nil {
		serverError(w, r, err)
		return
	}
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
	if r.URL.Query().Get("sort") == "" {
		slices.SortStableFunc(accounts, func(a, b portfolio.Account) int {
			if order := cmp.Compare(boolInt(a.Archived), boolInt(b.Archived)); order != 0 {
				return order
			}
			if order := cmp.Compare(b.TotalAssetsMinor, a.TotalAssetsMinor); order != 0 {
				return order
			}
			return cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
		})
	} else if err := sortRows(r, accounts, columns); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusOK, accounts)
}

func (s *Server) accountsWithRevenue(r *http.Request) ([]portfolio.Account, error) {
	rates, err := s.store.ListReferenceRates(r.Context())
	if err != nil {
		return nil, err
	}
	references := make(map[string]int64, len(rates))
	for _, rate := range rates {
		references[rate.Code] = rate.RateBPS
	}
	accounts, err := s.store.ListAccounts(r.Context())
	if err != nil {
		return nil, err
	}
	holdings, err := s.store.ListHoldings(r.Context())
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

func (s *Server) createAccount(w http.ResponseWriter, r *http.Request) {
	var account portfolio.Account
	if !decodeJSON(w, r, &account) {
		return
	}
	account.ID = 0
	if err := s.store.SaveAccount(r.Context(), &account); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, account)
}

func (s *Server) updateAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var account portfolio.Account
	if !decodeJSON(w, r, &account) {
		return
	}
	account.ID = id
	if err := s.store.SaveAccount(r.Context(), &account); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteAccount(r.Context(), id); err != nil {
		badRequest(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getReferenceRates(w http.ResponseWriter, r *http.Request) {
	rates, err := s.store.ListReferenceRates(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, rates)
}

func (s *Server) putReferenceRate(w http.ResponseWriter, r *http.Request) {
	var rate portfolio.ReferenceRate
	if !decodeJSON(w, r, &rate) {
		return
	}
	rate.Code = r.PathValue("code")
	if err := s.store.SaveReferenceRate(r.Context(), rate); err != nil {
		badRequest(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getTaxRates(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.taxRates)
}

func (s *Server) getInstruments(w http.ResponseWriter, r *http.Request) {
	instruments, err := s.store.ListInstruments(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	if err := sortRows(r, instruments, map[string]func(portfolio.Instrument, portfolio.Instrument) int{
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
	}); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusOK, instruments)
}

func (s *Server) searchInstruments(w http.ResponseWriter, r *http.Request) {
	instruments, err := s.justETF.Search(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		justETFError(w, r, r.URL.Query().Get("q"), err)
		return
	}
	writeJSON(w, http.StatusOK, instruments)
}

func (s *Server) syncInstrumentCatalog(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Limit int `json:"limit"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Limit == 0 {
		input.Limit = 4_000
	}
	if input.Limit < 1 || input.Limit > 4_000 {
		badRequest(w, errors.New("catalog limit must be between 1 and 4000"))
		return
	}
	instruments, available, err := s.justETF.Catalog(r.Context(), input.Limit)
	if err != nil {
		justETFError(w, r, "catalog", err)
		return
	}
	for i := range instruments {
		if err := s.store.SaveInstrument(r.Context(), &instruments[i]); err != nil {
			serverError(w, r, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"saved": len(instruments), "available": available})
}

func (s *Server) enrichInstrumentCatalog(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Limit int `json:"limit"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Limit == 0 {
		input.Limit = 20
	}
	items, err := s.store.ListInstrumentsToEnrich(r.Context(), input.Limit)
	if err != nil {
		badRequest(w, err)
		return
	}
	enriched, failed := 0, 0
	for _, item := range items {
		_, err := s.enrichInstrument(r.Context(), item, false)
		if err != nil {
			failed++
			slog.WarnContext(r.Context(), "justETF enrichment failed", "isin", item.ISIN, "error", err)
			if errors.Is(err, justetf.ErrRateLimited) {
				break
			}
			continue
		}
		enriched++
	}
	writeJSON(w, http.StatusOK, map[string]int{"enriched": enriched, "failed": failed})
}

type enrichmentProgress struct {
	Mode      string `json:"mode"`
	Phase     string `json:"phase"`
	Current   string `json:"current,omitempty"`
	Processed int    `json:"processed"`
	Total     int    `json:"total"`
	Available int    `json:"available,omitempty"`
	Enriched  int    `json:"enriched"`
	Skipped   int    `json:"skipped"`
	Failed    int    `json:"failed"`
	Done      bool   `json:"done"`
	Error     string `json:"error,omitempty"`
}

func (s *Server) streamInstrumentCatalog(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Mode string `json:"mode"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Mode != "missing" && input.Mode != "oldest" && input.Mode != "discover" {
		badRequest(w, errors.New("mode must be missing, oldest, or discover"))
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		serverError(w, r, errors.New("streaming is unavailable"))
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	encoder := json.NewEncoder(w)
	send := func(progress enrichmentProgress) bool {
		if err := encoder.Encode(progress); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	progress := enrichmentProgress{Mode: input.Mode, Phase: "loading"}
	if !send(progress) {
		return
	}
	var items []portfolio.Instrument
	if input.Mode == "discover" {
		candidates, available, err := s.justETF.CatalogCandidates(r.Context(), 4_000)
		if err != nil {
			progress.Done, progress.Error = true, err.Error()
			send(progress)
			return
		}
		known, err := s.store.ListInstruments(r.Context())
		if err != nil {
			progress.Done, progress.Error = true, err.Error()
			send(progress)
			return
		}
		seen := make(map[string]bool, len(known))
		for _, instrument := range known {
			seen[instrument.ISIN] = true
		}
		excluded, err := s.store.ListInstrumentExclusions(r.Context())
		if err != nil {
			progress.Done, progress.Error = true, err.Error()
			send(progress)
			return
		}
		for _, candidate := range candidates {
			if !seen[candidate.ISIN] && !excluded[candidate.ISIN] {
				items = append(items, candidate)
			}
		}
		progress.Available = available
	} else {
		var err error
		items, err = s.store.ListInstrumentsForEnrichment(r.Context(), input.Mode)
		if err != nil {
			progress.Done, progress.Error = true, err.Error()
			send(progress)
			return
		}
	}
	progress.Phase, progress.Total = "enriching", len(items)
	if !send(progress) {
		return
	}
	for _, item := range items {
		progress.Current = item.ISIN
		skipped, err := s.enrichInstrument(r.Context(), item, input.Mode == "discover")
		progress.Processed++
		if err != nil {
			progress.Failed++
			slog.WarnContext(r.Context(), "streamed justETF enrichment failed", "isin", item.ISIN, "error", err)
			if errors.Is(err, justetf.ErrRateLimited) {
				progress.Error = "justETF blocked requests; enrichment stopped and will back off before the next run"
				send(progress)
				return
			}
		} else if skipped {
			progress.Skipped++
		} else {
			progress.Enriched++
		}
		if !send(progress) {
			return
		}
	}
	progress.Current, progress.Done = "", true
	send(progress)
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

func (s *Server) putInstrument(w http.ResponseWriter, r *http.Request) {
	var instrument portfolio.Instrument
	if !decodeJSON(w, r, &instrument) {
		return
	}
	instrument.ID = 0
	if err := s.store.SaveInstrument(r.Context(), &instrument); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, instrument)
}

func (s *Server) lookupInstrument(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Query string `json:"query"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	instrument, err := s.justETF.Lookup(r.Context(), input.Query)
	if err != nil {
		justETFError(w, r, input.Query, err)
		return
	}
	if err := s.store.SaveInstrument(r.Context(), &instrument); err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, instrument)
}

func (s *Server) importInstruments(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ISINs []string `json:"isins"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if len(input.ISINs) == 0 || len(input.ISINs) > 20 {
		badRequest(w, errors.New("select between 1 and 20 instruments"))
		return
	}
	seen := make(map[string]bool, len(input.ISINs))
	imported := make([]portfolio.Instrument, 0, len(input.ISINs))
	for _, isin := range input.ISINs {
		isin = strings.ToUpper(strings.TrimSpace(isin))
		if seen[isin] {
			continue
		}
		seen[isin] = true
		instrument, err := s.justETF.Lookup(r.Context(), isin)
		if err != nil {
			justETFError(w, r, isin, err)
			return
		}
		imported = append(imported, instrument)
	}
	for i := range imported {
		if err := s.store.SaveInstrument(r.Context(), &imported[i]); err != nil {
			serverError(w, r, err)
			return
		}
	}
	writeJSON(w, http.StatusCreated, imported)
}

func justETFError(w http.ResponseWriter, r *http.Request, query string, err error) {
	switch {
	case errors.Is(err, justetf.ErrInvalidQuery):
		badRequest(w, err)
	case errors.Is(err, justetf.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	default:
		slog.WarnContext(r.Context(), "justETF request failed", "query", query, "error", err)
		writeError(w, http.StatusBadGateway, err.Error())
	}
}

func (s *Server) deleteInstrument(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteInstrument(r.Context(), id); err != nil {
		badRequest(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) starInstrument(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Starred bool `json:"starred"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.store.SetInstrumentStarred(r.Context(), r.PathValue("isin"), input.Starred); err != nil {
		badRequest(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getInstrumentAlternatives(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	instruments, err := s.store.ListInstruments(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	for _, instrument := range instruments {
		if instrument.ID == id {
			writeJSON(w, http.StatusOK, portfolio.FindInstrumentAlternatives(instrument, instruments, time.Now()))
			return
		}
	}
	writeError(w, http.StatusNotFound, "instrument not found")
}

func (s *Server) rankInstruments(w http.ResponseWriter, r *http.Request) {
	var criteria portfolio.RankCriteria
	if !decodeJSON(w, r, &criteria) {
		return
	}
	instruments, err := s.store.ListInstruments(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	ranked, err := portfolio.RankInstruments(instruments, criteria, time.Now())
	if err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ranked)
}

func (s *Server) getHoldings(w http.ResponseWriter, r *http.Request) {
	holdings, err := s.store.ListHoldings(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	if err := sortRows(r, holdings, map[string]func(portfolio.Holding, portfolio.Holding) int{
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
	}); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusOK, holdings)
}

func (s *Server) createHolding(w http.ResponseWriter, r *http.Request) {
	var holding portfolio.Holding
	if !decodeJSON(w, r, &holding) {
		return
	}
	holding.ID = 0
	if err := s.store.SaveHolding(r.Context(), &holding); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, holding)
}

func (s *Server) updateHolding(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var holding portfolio.Holding
	if !decodeJSON(w, r, &holding) {
		return
	}
	holding.ID = id
	if err := s.store.SaveHolding(r.Context(), &holding); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusOK, holding)
}

func (s *Server) deleteHolding(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteHolding(r.Context(), id); err != nil {
		badRequest(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getSnapshots(w http.ResponseWriter, r *http.Request) {
	snapshots, err := s.store.ListSnapshots(r.Context())
	if err != nil {
		serverError(w, r, err)
		return
	}
	if err := sortRows(r, snapshots, map[string]func(portfolio.Snapshot, portfolio.Snapshot) int{
		"date":      func(a, b portfolio.Snapshot) int { return cmp.Compare(a.ObservedOn, b.ObservedOn) },
		"currency":  func(a, b portfolio.Snapshot) int { return cmp.Compare(a.Currency, b.Currency) },
		"cash":      func(a, b portfolio.Snapshot) int { return cmp.Compare(a.CashMinor, b.CashMinor) },
		"invested":  func(a, b portfolio.Snapshot) int { return cmp.Compare(a.InvestedMinor, b.InvestedMinor) },
		"portfolio": func(a, b portfolio.Snapshot) int { return cmp.Compare(a.PortfolioMinor, b.PortfolioMinor) },
		"total":     func(a, b portfolio.Snapshot) int { return cmp.Compare(a.TotalMinor, b.TotalMinor) },
	}); err != nil {
		badRequest(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshots)
}

func (s *Server) saveSnapshot(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ObservedOn string `json:"observed_on"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.store.SaveSnapshot(r.Context(), input.ObservedOn); err != nil {
		badRequest(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) updateSnapshot(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var snapshot portfolio.Snapshot
	if !decodeJSON(w, r, &snapshot) {
		return
	}
	snapshot.ID = id
	if err := s.store.UpdateSnapshot(r.Context(), snapshot); err != nil {
		badRequest(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteSnapshot(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteSnapshot(r.Context(), id); err != nil {
		badRequest(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		badRequest(w, errors.New("invalid id"))
		return 0, false
	}
	return id, true
}

func sortRows[T any](r *http.Request, rows []T, columns map[string]func(T, T) int) error {
	key := r.URL.Query().Get("sort")
	if key == "" {
		return nil
	}
	compare, ok := columns[key]
	if !ok {
		return fmt.Errorf("unsupported sort column %q", key)
	}
	direction := r.URL.Query().Get("direction")
	if direction == "" {
		direction = "asc"
	}
	if direction != "asc" && direction != "desc" {
		return errors.New("sort direction must be asc or desc")
	}
	slices.SortStableFunc(rows, func(a, b T) int {
		result := compare(a, b)
		if direction == "desc" {
			return -result
		}
		return result
	})
	return nil
}

func compareOptional(a, b *int64) int {
	if a == nil {
		if b == nil {
			return 0
		}
		return 1
	}
	if b == nil {
		return -1
	}
	return cmp.Compare(*a, *b)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		badRequest(w, fmt.Errorf("invalid JSON: %w", err))
		return false
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		badRequest(w, errors.New("request must contain one JSON value"))
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func badRequest(w http.ResponseWriter, err error) { writeError(w, http.StatusBadRequest, err.Error()) }

func serverError(w http.ResponseWriter, r *http.Request, err error) {
	slog.ErrorContext(r.Context(), "request failed", "method", r.Method, "path", r.URL.Path, "error", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeError(w, http.StatusForbidden, "cross-site requests are not allowed")
			return
		}
		next.ServeHTTP(w, r)
	})
}
