package portfolio

import (
	"testing"
)

func TestCalculateGeoRadar(t *testing.T) {
	accounts := []Account{
		{ID: 1, BalanceMinor: 100_000, Currency: "EUR"}, // €1,000 cash
	}
	instruments := map[int64]Instrument{
		10: {ID: 10, ISIN: "IE00B4L5Y983", Name: "iShares Core MSCI World UCITS ETF", FundCurrency: "USD"},
		20: {ID: 20, ISIN: "IT0005436693", Name: "BTP 2037", FundCurrency: "EUR"},
	}
	holdings := []Holding{
		{ID: 1, AccountID: 1, InstrumentID: 10, ValueMinor: 1_000_000}, // €10,000 MSCI World
		{ID: 2, AccountID: 1, InstrumentID: 20, ValueMinor: 4_000_000}, // €40,000 BTP Italy
	}

	result := CalculateGeoRadar(accounts, holdings, instruments, 1.08, true)

	if len(result.Countries) == 0 {
		t.Fatal("expected countries exposure, got empty")
	}
	if len(result.Currencies) == 0 {
		t.Fatal("expected currencies exposure, got empty")
	}

	// Italy should be top country due to €40k BTP + €1k cash
	if result.Countries[0].CountryCode != "IT" {
		t.Errorf("expected top country IT, got %s", result.Countries[0].CountryCode)
	}

	// EUR should be top currency
	if result.Currencies[0].Currency != "EUR" {
		t.Errorf("expected top currency EUR, got %s", result.Currencies[0].Currency)
	}
}
