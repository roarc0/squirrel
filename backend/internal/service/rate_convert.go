package service

import (
	"squirrel/backend/internal/portfolio"
	portv1 "squirrel/proto/gen/go/v1"
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
