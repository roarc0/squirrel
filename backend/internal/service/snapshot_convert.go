package service

import (
	"loot/backend/internal/portfolio"
	portv1 "loot/proto/gen/go/v1"
)

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
