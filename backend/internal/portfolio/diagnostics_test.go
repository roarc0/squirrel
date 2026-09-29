package portfolio

import (
	"strings"
	"testing"
	"time"
)

func TestDiagnosticsKeepCurrenciesSeparate(t *testing.T) {
	accounts := []Account{
		{Currency: "EUR", BalanceMinor: 100_00},
		{Currency: "USD", BalanceMinor: 10_000_00},
	}
	holdings := []Holding{
		{ID: 1, Currency: "EUR", InstrumentName: "EUR ETF", ActualBPS: 5000},
		{ID: 2, Currency: "USD", InstrumentName: "USD ETF", ActualBPS: 9000},
		{ID: 3, Currency: "EUR", InstrumentName: "Empty ETF"},
	}

	diagnostics := EvaluateDiagnostics(accounts, holdings, nil, "EUR", 200_00, time.Now())
	if len(diagnostics) != 1 || diagnostics[0].ID != "cash_below_reserve" || !strings.Contains(diagnostics[0].Message, "EUR 100.00") {
		t.Fatalf("unexpected diagnostics: %+v", diagnostics)
	}
}
