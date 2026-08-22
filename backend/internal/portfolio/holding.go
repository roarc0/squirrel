package portfolio

import "errors"

type Holding struct {
	ID               int64  `json:"id,omitempty"`
	AccountID        int64  `json:"account_id"`
	InstrumentID     int64  `json:"instrument_id"`
	AccountName      string `json:"account_name,omitempty"`
	Currency         string `json:"currency,omitempty"`
	InstrumentName   string `json:"instrument_name,omitempty"`
	InstrumentISIN   string `json:"instrument_isin,omitempty"`
	InstrumentTicker string `json:"instrument_ticker,omitempty"`
	InstrumentType   string `json:"instrument_type,omitempty"`
	AssetClass       string `json:"asset_class,omitempty"`
	InvestedMinor    int64  `json:"invested_minor"`
	ValueMinor       int64  `json:"value_minor"`
	TaxBPS           int64  `json:"tax_bps"`
	PlannedBPS       int64  `json:"planned_bps"`
	ActualBPS        int64  `json:"actual_bps"`
	TERBPS           int64  `json:"ter_bps,omitempty"`
	IsPAC            bool   `json:"is_pac"`
	PACAmountMinor   int64  `json:"pac_amount_minor"`
	PACFrequency     string `json:"pac_frequency"`
}

func ValidateHolding(holding Holding) error {
	if holding.AccountID <= 0 || holding.InstrumentID <= 0 {
		return errors.New("account and instrument are required")
	}
	if holding.InvestedMinor < 0 || holding.ValueMinor < 0 || holding.InvestedMinor > 1_000_000_000_000 || holding.ValueMinor > 1_000_000_000_000 {
		return errors.New("holding values are outside the supported range")
	}
	if holding.TaxBPS < 0 || holding.TaxBPS > 10_000 {
		return errors.New("tax rate must be between 0% and 100%")
	}
	if holding.PlannedBPS < 0 || holding.PlannedBPS > 10_000 {
		return errors.New("planned allocation must be between 0% and 100%")
	}
	return nil
}
