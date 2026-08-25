package service

import (
	"squirrel/backend/internal/portfolio"
	portv1 "squirrel/proto/gen/go/v1"
)

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
		PacAmountMinor:     a.PACAmountMinor,
		Notes:              a.Notes,
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
		PACAmountMinor:     p.PacAmountMinor,
		Notes:              p.Notes,
	}
}
