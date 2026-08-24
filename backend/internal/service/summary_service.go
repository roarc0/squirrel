package service

import (
	"cmp"
	"context"
	"slices"
	"time"

	"connectrpc.com/connect"

	"loot/backend/internal/auth"
	"loot/backend/internal/portfolio"
	portv1 "loot/proto/gen/go/v1"
)

type currencySummary struct {
	currency        string
	balanceMinor    int64
	grossMinor      int64
	taxMinor        int64
	feesMinor       int64
	netMinor        int64
	investedMinor   int64
	portfolioMinor  int64
	totalMinor      int64
	assetClassValue map[string]int64
}

func (s *Server) GetSummary(ctx context.Context, req *connect.Request[portv1.GetSummaryRequest]) (*connect.Response[portv1.GetSummaryResponse], error) {
	accounts, err := s.accountsWithRevenue(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	holdings, err := s.store.ListHoldings(ctx, auth.UserIDOrEmpty(ctx))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	instruments, err := s.store.ListInstruments(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	summaries := make(map[string]*currencySummary)
	getSummary := func(currency string) *currencySummary {
		if summary, ok := summaries[currency]; ok {
			return summary
		}
		summary := &currencySummary{currency: currency, assetClassValue: make(map[string]int64)}
		summaries[currency] = summary
		return summary
	}

	for _, account := range accounts {
		if account.Archived {
			continue
		}
		summary := getSummary(account.Currency)
		summary.balanceMinor += account.BalanceMinor
		summary.grossMinor += account.GrossRevenueMinor
		summary.taxMinor += account.TaxMinor
		summary.feesMinor += account.AnnualFeeMinor
		summary.netMinor += account.NetRevenueMinor
	}

	for _, holding := range holdings {
		currency := holding.Currency
		if currency == "" {
			currency = "EUR"
		}
		summary := getSummary(currency)
		summary.investedMinor += holding.InvestedMinor
		summary.portfolioMinor += holding.ValueMinor
		assetClass := holding.AssetClass
		if assetClass == "" {
			assetClass = "other"
		}
		summary.assetClassValue[assetClass] += holding.ValueMinor
	}

	result := make([]*portv1.CurrencySummary, 0, len(summaries))
	for _, summary := range summaries {
		summary.totalMinor = summary.balanceMinor + summary.portfolioMinor
		allocations := make([]*portv1.InstrumentAllocation, 0, len(summary.assetClassValue))
		for assetClass, value := range summary.assetClassValue {
			allocations = append(allocations, &portv1.InstrumentAllocation{
				AssetClass: assetClass,
				ValueMinor: value,
			})
		}
		slices.SortFunc(allocations, func(a, b *portv1.InstrumentAllocation) int {
			if order := cmp.Compare(b.ValueMinor, a.ValueMinor); order != 0 {
				return order
			}
			return cmp.Compare(a.AssetClass, b.AssetClass)
		})
		result = append(result, &portv1.CurrencySummary{
			Currency:          summary.currency,
			BalanceMinor:      summary.balanceMinor,
			GrossRevenueMinor: summary.grossMinor,
			TaxMinor:          summary.taxMinor,
			FeesMinor:         summary.feesMinor,
			NetRevenueMinor:   summary.netMinor,
			InvestedMinor:     summary.investedMinor,
			PortfolioMinor:    summary.portfolioMinor,
			TotalMinor:        summary.totalMinor,
			Allocations:       allocations,
		})
	}

	slices.SortFunc(result, func(a, b *portv1.CurrencySummary) int {
		if a.Currency == s.baseCurrency {
			return -1
		}
		if b.Currency == s.baseCurrency {
			return 1
		}
		return cmp.Compare(a.Currency, b.Currency)
	})

	var targetCashMinor int64
	if req.Msg.TargetCashMinor != nil {
		targetCashMinor = *req.Msg.TargetCashMinor
	}

	rawDiagnostics := portfolio.EvaluateDiagnostics(accounts, holdings, instruments, targetCashMinor, time.Now())
	pbDiagnostics := make([]*portv1.Diagnostic, len(rawDiagnostics))
	for i, d := range rawDiagnostics {
		pbDiagnostics[i] = &portv1.Diagnostic{
			Id:        d.ID,
			Category:  d.Category,
			Severity:  string(d.Severity),
			Title:     d.Title,
			Message:   d.Message,
			HoldingId: d.HoldingID,
			AccountId: d.AccountID,
			Isin:      d.ISIN,
		}
	}

	return connect.NewResponse(&portv1.GetSummaryResponse{
		Summary: &portv1.Summary{
			BaseCurrency: s.baseCurrency,
			Currencies:   result,
			Diagnostics:  pbDiagnostics,
		},
	}), nil
}
