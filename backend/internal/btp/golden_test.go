package btp

import (
	"math"
	"testing"
	"time"
)

func TestGoldenZeroCouponClosedForm(t *testing.T) {
	// A zero coupon bond pays exactly 100 at maturity T with no coupons.
	// Annual effective yield: Y = (100 / Price)^(1 / T) - 1
	// DurationMac = T
	// DurationMod = T / (1 + Y)
	ref := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		price      float64
		expiryDate string
		days       float64
	}{
		{"1-Year ZC", 96.50, "01/01/2027", 365.0},
		{"2-Year ZC", 93.00, "01/01/2028", 730.0},
		{"6-Month ZC", 98.25, "02/07/2026", 182.0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b := BTP{
				Name:       tc.name,
				BondType:   BondTypeZeroCoupon,
				Price:      tc.price,
				Coupon:     0,
				ExpiryDate: tc.expiryDate,
			}
			b.CalculateMetrics(0.125, ref)

			if !b.AnalyticsAvailable {
				t.Fatalf("expected analytics available for %s", tc.name)
			}

			expiry, _ := time.Parse("02/01/2006", tc.expiryDate)
			years := expiry.Sub(ref).Hours() / (24 * 365.25)
			expectedGrossYield := (math.Pow(100.0/tc.price, 1.0/years) - 1.0) * 100

			// Compare calculated YTMGross with theoretical closed form
			if math.Abs(b.YTMGross-expectedGrossYield) > 0.02 {
				t.Errorf("expected YTMGross ~%.2f%%, got %.2f%%", expectedGrossYield, b.YTMGross)
			}

			// Macaulay duration for zero-coupon must equal years to maturity
			expectedMac := years
			if math.Abs(b.DurationMac-expectedMac) > 0.05 {
				t.Errorf("expected DurationMac ~%.2f, got %.2f", expectedMac, b.DurationMac)
			}

			// Modified duration: Mac / (1 + y)
			expectedMod := expectedMac / (1.0 + expectedGrossYield/100.0)
			if math.Abs(b.DurationMod-expectedMod) > 0.05 {
				t.Errorf("expected DurationMod ~%.2f, got %.2f", expectedMod, b.DurationMod)
			}
		})
	}
}

func TestGoldenMaturedAndInvalidBTPs(t *testing.T) {
	ref := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)

	t.Run("MaturedBond", func(t *testing.T) {
		// Bond matured in the past (e.g. 2025)
		b := BTP{
			ISIN:       "IT0005000001",
			Name:       "BTP 2.5% 01/01/2025",
			Price:      100.0,
			Coupon:     2.5,
			ExpiryDate: "01/01/2025",
		}
		b.CalculateMetrics(0.125, ref)

		if b.IsTraded {
			t.Errorf("expected IsTraded = false for matured bond")
		}
		if b.AnalyticsAvailable {
			t.Errorf("expected AnalyticsAvailable = false for matured bond")
		}
		if b.YTMGross != 0 || b.YTMNet != 0 {
			t.Errorf("expected 0 yield for matured bond, got %v / %v", b.YTMGross, b.YTMNet)
		}
	})

	t.Run("InvalidPrices", func(t *testing.T) {
		invalidPrices := []float64{0.0, -10.0, math.NaN(), math.Inf(1)}
		for _, price := range invalidPrices {
			b := BTP{
				ISIN:       "IT0005000002",
				Name:       "BTP 3.0% 01/01/2030",
				Price:      price,
				Coupon:     3.0,
				ExpiryDate: "01/01/2030",
			}
			b.CalculateMetrics(0.125, ref)
			if b.AnalyticsAvailable || b.IsTraded {
				t.Errorf("expected invalid price %v to disable trading and analytics", price)
			}
		}
	})

	t.Run("NonStandardBondsRequireSchedule", func(t *testing.T) {
		nonStandard := []struct {
			name   string
			bType  BondType
			coupon float64
		}{
			{"BTP ITALIA 1.6% NOV 28", BondTypeItalia, 1.6},
			{"BTP VALORE 3.25% OCT 27", BondTypeValore, 3.25},
			{"CCTEU 15/10/2031", BondTypeFloating, 1.2},
			{"BTP€I 0.15% MAY 51", BondTypeInflation, 0.15},
		}

		for _, item := range nonStandard {
			b := BTP{
				Name:       item.name,
				BondType:   item.bType,
				Price:      99.0,
				Coupon:     item.coupon,
				ExpiryDate: "01/01/2030",
			}
			b.CalculateMetrics(0.125, ref)

			// Traded should be true (valid future maturity and price)
			if !b.IsTraded {
				t.Errorf("expected %s to be marked as traded", item.name)
			}
			// But analytics must be false because fixed yield is misleading
			if b.AnalyticsAvailable {
				t.Errorf("expected AnalyticsAvailable = false for non-fixed bond %s", item.name)
			}
			if b.AnalyticsNote == "" {
				t.Errorf("expected non-empty analytics note explaining why yield is unavailable")
			}
		}
	})
}
