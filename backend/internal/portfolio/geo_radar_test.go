package portfolio

import (
	"math"
	"testing"
)

func TestGeoRadarUsesEURValuesAndUnknownExposures(t *testing.T) {
	accounts := []Account{{ID: 1, Currency: "EUR", BalanceMinor: 10000}, {ID: 2, Currency: "USD", BalanceMinor: 10000}, {ID: 3, Currency: "EUR", BalanceMinor: 999999, Archived: true}, {ID: 4, Currency: "GBP", BalanceMinor: 999999}}
	result := CalculateGeoRadar(accounts, nil, nil, 2, true)
	var usd CurrencyExposureItem
	for _, item := range result.Currencies {
		if item.Currency == "USD" {
			usd = item
		}
	}
	if usd.ValueMinor != 5000 || math.Abs(usd.Percentage-100.0/3) > 0.0001 || usd.FXImpact5PctMinor != 250 {
		t.Fatalf("incorrect converted exposure: %+v", usd)
	}
	if len(result.Countries) != 1 || result.Countries[0].CountryCode != "UNKNOWN" || result.Countries[0].ValueMinor != 15000 {
		t.Fatalf("invented geography or included archived assets: %+v", result.Countries)
	}
	excluded := false
	for _, d := range result.Diagnostics {
		if d.ID == "fx-excluded-GBP" {
			excluded = true
		}
	}
	if !excluded {
		t.Fatal("unsupported currency excluded silently")
	}
	holdings := []Holding{{AccountID: 1, ValueMinor: 10000}, {AccountID: 3, ValueMinor: 999999}}
	result = CalculateGeoRadar(accounts, holdings, nil, 2, false)
	if len(result.Currencies) != 1 || result.Currencies[0].Currency != "UNKNOWN" || result.Currencies[0].ValueMinor != 10000 || result.Currencies[0].FXImpact5PctMinor != 0 {
		t.Fatalf("invented investment currency exposure: %+v", result)
	}
	for _, rate := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		result = CalculateGeoRadar(accounts[:2], nil, nil, rate, true)
		if len(result.Currencies) != 1 || result.Currencies[0].Currency != "EUR" || result.Currencies[0].ValueMinor != 10000 {
			t.Fatalf("invalid FX rate was used: %+v", result)
		}
	}
}

func TestGeoRadarRestoresEstimatedLookThrough(t *testing.T) {
	accounts := []Account{{ID: 1, Currency: "EUR"}}
	holdings := []Holding{{AccountID: 1, InstrumentID: 1, ValueMinor: 10001}}
	instruments := map[int64]Instrument{1: {IndexName: "MSCI World", AssetClass: "equity"}}
	r := CalculateGeoRadar(accounts, holdings, instruments, 0, false)
	var countries, currencies int64
	var us bool
	for _, item := range r.Countries {
		countries += item.ValueMinor
		us = us || item.CountryCode == "US"
	}
	for _, item := range r.Currencies {
		currencies += item.ValueMinor
	}
	if !us || countries != 10001 || currencies != 10001 || len(r.Diagnostics) == 0 {
		t.Fatalf("missing estimates or lost value: %+v", r)
	}
	// Fund denomination alone must not invent a geographic allocation.
	instruments[1] = Instrument{FundCurrency: "USD"}
	r = CalculateGeoRadar(accounts, holdings, instruments, 0, false)
	if len(r.Countries) != 1 || r.Countries[0].CountryCode != "UNKNOWN" {
		t.Fatalf("invented geography: %+v", r)
	}
}
