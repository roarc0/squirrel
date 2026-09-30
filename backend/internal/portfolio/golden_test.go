package portfolio

import (
	"testing"
	"time"
)

func TestGoldenTieredInterestAndTaxRounding(t *testing.T) {
	// Test precise half-away-from-zero rounding and tax calculations
	t.Run("RoundingHalfAwayFromZero", func(t *testing.T) {
		// Numerator: 4999 / 10000 -> 0; 5000 / 10000 -> 1
		rate1BPS := int64(1) // 0.01%
		accDown := Account{
			Name:         "Savings Down",
			Currency:     "EUR",
			BalanceMinor: 4999, // 4999 * 1 = 4999 numerator -> rounds to 0
			TaxBPS:       2600,
			Tiers: []InterestTier{
				{FixedRateBPS: &rate1BPS},
			},
		}
		revDown, _, err := CalculateRevenue(accDown, nil)
		if err != nil {
			t.Fatal(err)
		}
		if revDown.GrossMinor != 0 {
			t.Fatalf("expected 4999/10000 to round to 0 gross, got %d", revDown.GrossMinor)
		}

		accUp := Account{
			Name:         "Savings Up",
			Currency:     "EUR",
			BalanceMinor: 5000, // 5000 * 1 = 5000 numerator -> rounds to 1
			TaxBPS:       2600,
			Tiers: []InterestTier{
				{FixedRateBPS: &rate1BPS},
			},
		}
		revUp, _, err := CalculateRevenue(accUp, nil)
		if err != nil {
			t.Fatal(err)
		}
		if revUp.GrossMinor != 1 {
			t.Fatalf("expected 5000/10000 to round to 1 gross, got %d", revUp.GrossMinor)
		}
	})

	t.Run("TierBoundaryTransitions", func(t *testing.T) {
		tier1Limit := int64(20_000_00) // €20,000.00
		tier1Rate := int64(400)        // 4.00%
		tier2Rate := int64(150)        // 1.50%

		tiers := []InterestTier{
			{UpToMinor: &tier1Limit, FixedRateBPS: &tier1Rate},
			{FixedRateBPS: &tier2Rate},
		}

		// Exact threshold: €20,000.00
		// Gross = 20,000.00 * 4% = €800.00 (80,000 minor)
		accExact := Account{
			Name:           "Exact Threshold Account",
			Currency:       "EUR",
			BalanceMinor:   20_000_00,
			TaxBPS:         2600, // 26%
			AnnualFeeMinor: 10_00, // €10.00
			Tiers:          tiers,
		}
		revExact, _, err := CalculateRevenue(accExact, nil)
		if err != nil {
			t.Fatal(err)
		}
		if revExact.GrossMinor != 80_000 {
			t.Fatalf("expected gross 80,000 minor, got %d", revExact.GrossMinor)
		}
		// Tax = 80,000 * 26% = 20,800
		if revExact.TaxMinor != 20_800 {
			t.Fatalf("expected tax 20,800 minor, got %d", revExact.TaxMinor)
		}
		// Net = 80,000 - 20,800 - 1,000 = 58,200
		if revExact.NetMinor != 58_200 {
			t.Fatalf("expected net 58,200 minor, got %d", revExact.NetMinor)
		}

		// Exactly €1 over threshold: €20,001.00
		// Tier 1: 20,000.00 * 4% = €800.00
		// Tier 2: 1.00 * 1.5% = €0.015 -> numerator = 80,000 * 10,000 + 100 * 150 = 800,015,000
		// Gross = 800,015,000 / 10,000 = 80,002 minor (€800.02)
		accOver := Account{
			Name:           "Over Threshold Account",
			Currency:       "EUR",
			BalanceMinor:   20_001_00,
			TaxBPS:         2600,
			AnnualFeeMinor: 10_00,
			Tiers:          tiers,
		}
		revOver, _, err := CalculateRevenue(accOver, nil)
		if err != nil {
			t.Fatal(err)
		}
		if revOver.GrossMinor != 80_002 {
			t.Fatalf("expected gross 80,002 minor, got %d", revOver.GrossMinor)
		}
	})

	t.Run("ZeroBalanceAndNegativeNet", func(t *testing.T) {
		fixedRate := int64(350)
		accZero := Account{
			Name:           "Zero Balance Account",
			Currency:       "EUR",
			BalanceMinor:   0,
			TaxBPS:         2600,
			AnnualFeeMinor: 36_00, // €36.00/yr account maintenance fee
			Tiers: []InterestTier{
				{FixedRateBPS: &fixedRate},
			},
		}
		revZero, _, err := CalculateRevenue(accZero, nil)
		if err != nil {
			t.Fatal(err)
		}
		if revZero.GrossMinor != 0 || revZero.TaxMinor != 0 {
			t.Fatalf("expected 0 gross and tax for zero balance, got gross=%d tax=%d", revZero.GrossMinor, revZero.TaxMinor)
		}
		if revZero.NetMinor != -36_00 {
			t.Fatalf("expected net revenue of -3,600 minor for fees on zero balance, got %d", revZero.NetMinor)
		}
	})

	t.Run("ItalianGovernmentBondTaxRate", func(t *testing.T) {
		// Whitelist government bond rate: 12.5% = 1250 BPS
		fixedRate := int64(400)
		accGov := Account{
			Name:         "Government Bonds Account",
			Currency:     "EUR",
			BalanceMinor: 10_000_00, // €10,000
			TaxBPS:       1250,      // 12.5%
			Tiers: []InterestTier{
				{FixedRateBPS: &fixedRate},
			},
		}
		revGov, _, err := CalculateRevenue(accGov, nil)
		if err != nil {
			t.Fatal(err)
		}
		// Gross = €400.00 (40,000 minor)
		if revGov.GrossMinor != 40_000 {
			t.Fatalf("expected gross 40,000 minor, got %d", revGov.GrossMinor)
		}
		// Tax = 40,000 * 12.5% = 5,000 minor (€50.00)
		if revGov.TaxMinor != 5_000 {
			t.Fatalf("expected tax 5,000 minor, got %d", revGov.TaxMinor)
		}
		if revGov.NetMinor != 35_000 {
			t.Fatalf("expected net 35,000 minor, got %d", revGov.NetMinor)
		}
	})
}

func TestGoldenMultiCurrencyDiagnosticsSeparation(t *testing.T) {
	now := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)

	accounts := []Account{
		{ID: 1, Name: "EUR Checking", Currency: "EUR", BalanceMinor: 5_000_00}, // €5,000
		{ID: 2, Name: "USD Brokerage", Currency: "USD", BalanceMinor: 100_000_00}, // $100,000
	}
	holdings := []Holding{
		{ID: 1, AccountID: 1, Currency: "EUR", ValueMinor: 15_000_00}, // €15,000
		{ID: 2, AccountID: 2, Currency: "USD", ValueMinor: 50_000_00},  // $50,000
	}
	instruments := []Instrument{
		{ISIN: "IE00B4L5Y983", FundCurrency: "USD"},
	}

	// Target cash reserve is set in EUR: €10,000.
	// Liquid EUR cash is €5,000 (< €10,000 target).
	// USD cash is $100,000, but must NOT bleed into EUR cash reserve calculation!
	diags := EvaluateDiagnostics(accounts, holdings, instruments, "EUR", 10_000_00, now)

	var foundBelowReserve bool
	for _, d := range diags {
		if d.ID == "cash_below_reserve" {
			foundBelowReserve = true
		}
		if d.ID == "excessive_cash_reserve" || d.ID == "excessive_cash" {
			t.Fatalf("USD cash leaked into EUR reserve diagnostic: %+v", d)
		}
	}
	if !foundBelowReserve {
		t.Fatalf("expected cash_below_reserve for EUR portfolio with €5,000 cash vs €10,000 target")
	}
}
