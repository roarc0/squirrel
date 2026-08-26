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
		{ID: 1, Currency: "EUR", InstrumentName: "EUR ETF", PlannedBPS: 5000, ActualBPS: 5000},
		{ID: 2, Currency: "USD", InstrumentName: "USD ETF", PlannedBPS: 5000, ActualBPS: 9000},
		{ID: 3, Currency: "EUR", InstrumentName: "Empty ETF", PlannedBPS: 1000},
	}

	diagnostics := EvaluateDiagnostics(accounts, holdings, nil, "EUR", 200_00, time.Now())
	if len(diagnostics) != 3 || diagnostics[0].ID != "cash_below_reserve" || !strings.Contains(diagnostics[0].Message, "EUR 100.00") || diagnostics[1].HoldingID != 2 || diagnostics[2].HoldingID != 3 {
		t.Fatalf("currencies were mixed: %+v", diagnostics)
	}
}
