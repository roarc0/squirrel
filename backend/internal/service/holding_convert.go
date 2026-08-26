package service

import (
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

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
		TerBps:        h.TERBPS,
		IsPac:         h.IsPAC,
		PacBps:        h.PACBPS,
		PacFrequency:  h.PACFrequency,
		Notes:         h.Notes,
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
		TERBPS:        p.TerBps,
		IsPAC:         p.IsPac,
		PACBPS:        p.PacBps,
		PACFrequency:  p.PacFrequency,
		Notes:         p.Notes,
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
