package service

import (
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

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
