package service

import (
	"loot/backend/internal/portfolio"
	portv1 "loot/proto/gen/go/v1"
)

func referenceRateToProto(r portfolio.ReferenceRate) *portv1.ReferenceRate {
	res := &portv1.ReferenceRate{
		Code:       r.Code,
		Label:      r.Label,
		RateBps:    r.RateBPS,
		ObservedOn: r.ObservedOn,
	}
	if r.UpdatedAt != "" {
		res.UpdatedAt = &r.UpdatedAt
	}
	return res
}

func referenceRateFromProto(p *portv1.ReferenceRate) portfolio.ReferenceRate {
	if p == nil {
		return portfolio.ReferenceRate{}
	}
	res := portfolio.ReferenceRate{
		Code:       p.Code,
		Label:      p.Label,
		RateBPS:    p.RateBps,
		ObservedOn: p.ObservedOn,
	}
	if p.UpdatedAt != nil {
		res.UpdatedAt = *p.UpdatedAt
	}
	return res
}

func taxRateToProto(t portfolio.TaxRate) *portv1.TaxRate {
	return &portv1.TaxRate{
		Code:    t.Code,
		Label:   t.Label,
		RateBps: t.RateBPS,
	}
}

func interestTierToProto(t portfolio.InterestTier) *portv1.InterestTier {
	res := &portv1.InterestTier{
		SpreadBps: t.SpreadBPS,
	}
	if t.ID != 0 {
		res.Id = &t.ID
	}
	if t.UpToMinor != nil {
		res.UpToMinor = t.UpToMinor
	}
	if t.FixedRateBPS != nil {
		res.FixedRateBps = t.FixedRateBPS
	}
	if t.ReferenceCode != "" {
		res.ReferenceCode = &t.ReferenceCode
	}
	if t.ResolvedRateBPS != 0 {
		res.ResolvedRateBps = &t.ResolvedRateBPS
	}
	return res
}

func interestTierFromProto(p *portv1.InterestTier) portfolio.InterestTier {
	if p == nil {
		return portfolio.InterestTier{}
	}
	res := portfolio.InterestTier{
		UpToMinor:    p.UpToMinor,
		FixedRateBPS: p.FixedRateBps,
		SpreadBPS:    p.SpreadBps,
	}
	if p.Id != nil {
		res.ID = *p.Id
	}
	if p.ReferenceCode != nil {
		res.ReferenceCode = *p.ReferenceCode
	}
	if p.ResolvedRateBps != nil {
		res.ResolvedRateBPS = *p.ResolvedRateBps
	}
	return res
}

func accountToProto(a portfolio.Account) *portv1.Account {
	tiers := make([]*portv1.InterestTier, len(a.Tiers))
	for i, t := range a.Tiers {
		tiers[i] = interestTierToProto(t)
	}
	return &portv1.Account{
		Id:                 a.ID,
		Name:               a.Name,
		Institution:        a.Institution,
		Type:               a.Type,
		Preferred:          a.Preferred,
		Archived:           a.Archived,
		Currency:           a.Currency,
		BalanceMinor:       a.BalanceMinor,
		TaxBps:             a.TaxBPS,
		AnnualFeeMinor:     a.AnnualFeeMinor,
		Tiers:              tiers,
		GrossRevenueMinor:  a.GrossRevenueMinor,
		TaxMinor:           a.TaxMinor,
		NetRevenueMinor:    a.NetRevenueMinor,
		HoldingCount:       a.HoldingCount,
		HoldingsValueMinor: a.HoldingsValueMinor,
		TotalAssetsMinor:   a.TotalAssetsMinor,
	}
}

func accountFromProto(p *portv1.Account) portfolio.Account {
	if p == nil {
		return portfolio.Account{}
	}
	tiers := make([]portfolio.InterestTier, len(p.Tiers))
	for i, t := range p.Tiers {
		tiers[i] = interestTierFromProto(t)
	}
	return portfolio.Account{
		ID:                 p.Id,
		Name:               p.Name,
		Institution:        p.Institution,
		Type:               p.Type,
		Preferred:          p.Preferred,
		Archived:           p.Archived,
		Currency:           p.Currency,
		BalanceMinor:       p.BalanceMinor,
		TaxBPS:             p.TaxBps,
		AnnualFeeMinor:     p.AnnualFeeMinor,
		Tiers:              tiers,
		GrossRevenueMinor:  p.GrossRevenueMinor,
		TaxMinor:           p.TaxMinor,
		NetRevenueMinor:    p.NetRevenueMinor,
		HoldingCount:       p.HoldingCount,
		HoldingsValueMinor: p.HoldingsValueMinor,
		TotalAssetsMinor:   p.TotalAssetsMinor,
	}
}

func instrumentToProto(inst portfolio.Instrument) *portv1.Instrument {
	res := &portv1.Instrument{
		Id:                    inst.ID,
		Isin:                  inst.ISIN,
		Name:                  inst.Name,
		InstrumentType:        inst.InstrumentType,
		CurrencyHedged:        inst.CurrencyHedged,
		Starred:               inst.Starred,
		DataStatus:            inst.DataStatus,
		Distribution:          inst.Distribution,
		Replication:           inst.Replication,
		FundCurrency:          inst.FundCurrency,
		TerBps:                inst.TERBPS,
		FundSizeMillion:       inst.FundSizeMillion,
		TrackingDifferenceBps: inst.TrackingDifferenceBPS,
		TrackingErrorBps:      inst.TrackingErrorBPS,
		Ucits:                 inst.UCITS,
	}
	if inst.Ticker != "" {
		res.Ticker = &inst.Ticker
	}
	if inst.Provider != "" {
		res.Provider = &inst.Provider
	}
	if inst.IndexName != "" {
		res.IndexName = &inst.IndexName
	}
	if inst.InvestmentFocus != "" {
		res.InvestmentFocus = &inst.InvestmentFocus
	}
	if inst.AssetClass != "" {
		res.AssetClass = &inst.AssetClass
	}
	if inst.Strategy != "" {
		res.Strategy = &inst.Strategy
	}
	if inst.Domicile != "" {
		res.Domicile = &inst.Domicile
	}
	if inst.InceptionDate != "" {
		res.InceptionDate = &inst.InceptionDate
	}
	if inst.SourceURL != "" {
		res.SourceUrl = &inst.SourceURL
	}
	if inst.RefreshedAt != "" {
		res.RefreshedAt = &inst.RefreshedAt
	}
	if inst.EnrichedAt != "" {
		res.EnrichedAt = &inst.EnrichedAt
	}
	return res
}

func instrumentFromProto(p *portv1.Instrument) portfolio.Instrument {
	if p == nil {
		return portfolio.Instrument{}
	}
	res := portfolio.Instrument{
		ID:                    p.Id,
		ISIN:                  p.Isin,
		Name:                  p.Name,
		InstrumentType:        p.InstrumentType,
		CurrencyHedged:        p.CurrencyHedged,
		Starred:               p.Starred,
		DataStatus:            p.DataStatus,
		Distribution:          p.Distribution,
		Replication:           p.Replication,
		FundCurrency:          p.FundCurrency,
		TERBPS:                p.TerBps,
		FundSizeMillion:       p.FundSizeMillion,
		TrackingDifferenceBPS: p.TrackingDifferenceBps,
		TrackingErrorBPS:      p.TrackingErrorBps,
		UCITS:                 p.Ucits,
	}
	if p.Ticker != nil {
		res.Ticker = *p.Ticker
	}
	if p.Provider != nil {
		res.Provider = *p.Provider
	}
	if p.IndexName != nil {
		res.IndexName = *p.IndexName
	}
	if p.InvestmentFocus != nil {
		res.InvestmentFocus = *p.InvestmentFocus
	}
	if p.AssetClass != nil {
		res.AssetClass = *p.AssetClass
	}
	if p.Strategy != nil {
		res.Strategy = *p.Strategy
	}
	if p.Domicile != nil {
		res.Domicile = *p.Domicile
	}
	if p.InceptionDate != nil {
		res.InceptionDate = *p.InceptionDate
	}
	if p.SourceUrl != nil {
		res.SourceURL = *p.SourceUrl
	}
	if p.RefreshedAt != nil {
		res.RefreshedAt = *p.RefreshedAt
	}
	if p.EnrichedAt != nil {
		res.EnrichedAt = *p.EnrichedAt
	}
	return res
}

func holdingToProto(h portfolio.Holding) *portv1.Holding {
	res := &portv1.Holding{
		Id:            h.ID,
		AccountId:     h.AccountID,
		InstrumentId:  h.InstrumentID,
		InvestedMinor: h.InvestedMinor,
		ValueMinor:    h.ValueMinor,
		TaxBps:        h.TaxBPS,
		PlannedBps:    h.PlannedBPS,
		ActualBps:     h.ActualBPS,
	}
	if h.AccountName != "" {
		res.AccountName = &h.AccountName
	}
	if h.Currency != "" {
		res.Currency = &h.Currency
	}
	if h.InstrumentName != "" {
		res.InstrumentName = &h.InstrumentName
	}
	if h.InstrumentISIN != "" {
		res.InstrumentIsin = &h.InstrumentISIN
	}
	if h.InstrumentTicker != "" {
		res.InstrumentTicker = &h.InstrumentTicker
	}
	if h.InstrumentType != "" {
		res.InstrumentType = &h.InstrumentType
	}
	if h.AssetClass != "" {
		res.AssetClass = &h.AssetClass
	}
	return res
}

func holdingFromProto(p *portv1.Holding) portfolio.Holding {
	if p == nil {
		return portfolio.Holding{}
	}
	res := portfolio.Holding{
		ID:            p.Id,
		AccountID:     p.AccountId,
		InstrumentID:  p.InstrumentId,
		InvestedMinor: p.InvestedMinor,
		ValueMinor:    p.ValueMinor,
		TaxBPS:        p.TaxBps,
		PlannedBPS:    p.PlannedBps,
		ActualBPS:     p.ActualBps,
	}
	if p.AccountName != nil {
		res.AccountName = *p.AccountName
	}
	if p.Currency != nil {
		res.Currency = *p.Currency
	}
	if p.InstrumentName != nil {
		res.InstrumentName = *p.InstrumentName
	}
	if p.InstrumentIsin != nil {
		res.InstrumentISIN = *p.InstrumentIsin
	}
	if p.InstrumentTicker != nil {
		res.InstrumentTicker = *p.InstrumentTicker
	}
	if p.InstrumentType != nil {
		res.InstrumentType = *p.InstrumentType
	}
	if p.AssetClass != nil {
		res.AssetClass = *p.AssetClass
	}
	return res
}

func snapshotToProto(s portfolio.Snapshot) *portv1.Snapshot {
	return &portv1.Snapshot{
		Id:            s.ID,
		ObservedOn:    s.ObservedOn,
		Currency:      s.Currency,
		CashMinor:     s.CashMinor,
		InvestedMinor: s.InvestedMinor,
		PortfolioMinor: s.PortfolioMinor,
		TotalMinor:    s.TotalMinor,
	}
}

func snapshotFromProto(p *portv1.Snapshot) portfolio.Snapshot {
	if p == nil {
		return portfolio.Snapshot{}
	}
	return portfolio.Snapshot{
		ID:             p.Id,
		ObservedOn:     p.ObservedOn,
		Currency:       p.Currency,
		CashMinor:      p.CashMinor,
		InvestedMinor:  p.InvestedMinor,
		PortfolioMinor: p.PortfolioMinor,
		TotalMinor:     p.TotalMinor,
	}
}

func rankCriteriaFromProto(p *portv1.RankCriteria) portfolio.RankCriteria {
	if p == nil {
		return portfolio.RankCriteria{}
	}
	res := portfolio.RankCriteria{
		IndexQuery:         p.IndexQuery,
		Distribution:       p.Distribution,
		Replications:       p.Replications,
		Domiciles:          p.Domiciles,
		MaxTERBPS:          p.MaxTerBps,
		MinFundSizeMillion: p.MinFundSizeMillion,
		MinAgeYears:        int(p.MinAgeYears),
	}
	if p.Weights != nil {
		res.Weights = portfolio.RankWeights{
			Cost:               p.Weights.Cost,
			TrackingDifference: p.Weights.TrackingDifference,
			TrackingError:      p.Weights.TrackingError,
			Size:               p.Weights.Size,
			Age:                p.Weights.Age,
		}
	}
	return res
}

func rankedInstrumentToProto(r portfolio.Score) *portv1.RankedInstrument {
	return &portv1.RankedInstrument{
		Instrument:         instrumentToProto(r.Instrument),
		Total:              r.Total,
		Cost:               r.Cost,
		TrackingDifference: r.TrackingDifference,
		TrackingError:      r.TrackingError,
		Size:               r.Size,
		Age:                r.Age,
	}
}

func instrumentAlternativeToProto(a portfolio.InstrumentAlternative) *portv1.InstrumentAlternative {
	return &portv1.InstrumentAlternative{
		Instrument: instrumentToProto(a.Instrument),
		Match:      a.Match,
		Better:     a.Better,
		Score:      a.Score,
		Reasons:    a.Reasons,
	}
}
