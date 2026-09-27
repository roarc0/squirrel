package btp

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDetectBondType(t *testing.T) {
	tests := []struct {
		name     string
		coupon   float64
		expected BondType
	}{
		{"BTP 4.5% 01/10/2053", 4.5, BondTypeFixed},
		{"BTP ITALIA 1.6% NOV 28", 1.6, BondTypeItalia},
		{"BTP VALORE 3.25% OCT 27", 3.25, BondTypeValore},
		{"BTP FUTURA 0.75% JUL 30", 0.75, BondTypeFutura},
		{"BTP ZC 15/12/2026", 0.0, BondTypeZeroCoupon},
		{"BTP€I 0.15% MAY 51", 0.15, BondTypeInflation},
		{"CCTEU 15/10/2031", 1.2, BondTypeFloating},
	}

	for _, tt := range tests {
		got := DetectBondType(tt.name, tt.coupon)
		if got != tt.expected {
			t.Errorf("DetectBondType(%q, %v) = %v, want %v", tt.name, tt.coupon, got, tt.expected)
		}
	}
}

func TestCalculateMetricsAndScores(t *testing.T) {
	refTime := time.Date(2026, 8, 25, 0, 0, 0, 0, time.UTC)
	b := BTP{
		ISIN:       "IT0005518128",
		Name:       "BTP 4.5% 01/10/2053",
		Price:      98.5,
		Coupon:     4.5,
		ExpiryDate: "01/10/2053",
	}

	b.CalculateMetrics(0.125, refTime)
	if !b.AnalyticsAvailable || b.YTMNet <= 0 {
		t.Fatal("regular fixed coupon estimates must be available")
	}
	b.Name, b.BondType, b.Coupon = "BTP ZC", BondTypeZeroCoupon, 0
	b.CalculateMetrics(0.125, refTime)

	if !b.IsTraded {
		t.Fatalf("expected BTP to be traded")
	}
	if b.YTMNet <= 0 {
		t.Errorf("expected positive net YTM, got %v", b.YTMNet)
	}
	if b.DurationMod <= 0 {
		t.Errorf("expected positive modified duration, got %v", b.DurationMod)
	}

	btps := []BTP{b}
	scored := ComputeAdvancedScores(btps, ScoringConfig{TaxRate: 0.125})
	if len(scored) != 1 {
		t.Fatalf("expected 1 scored BTP")
	}
	if scored[0].Score <= 0 {
		t.Errorf("expected score > 0, got %v", scored[0].Score)
	}
}

func TestScraper(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("page") == "1" {
			fmt.Fprint(w, `<table><tr><th>BTP</th></tr><tr><td>IT0005518128</td><td>BTP 4.5% 01/10/2053</td><td>-</td><td>01/10/2053</td><td>4,5%</td><td>98,50</td></tr></table>`)
			return
		}
		fmt.Fprint(w, `<table><tr><th>BTP</th></tr></table>`)
	}))
	defer server.Close()
	scraper := NewScraper(server.URL + "/")
	btps, err := scraper.ScrapeAll(context.Background(), ScoringConfig{TaxRate: 0.125})
	if err != nil {
		t.Fatalf("ScrapeAll error: %v", err)
	}
	if len(btps) == 0 {
		t.Fatalf("expected BTPs from ScrapeAll, got 0")
	}
	t.Logf("Successfully scraped %d BTPs", len(btps))
}

func TestZeroCouponUsesExactMaturityAndGrossDuration(t *testing.T) {
	ref := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	b := BTP{Name: "Zero", BondType: BondTypeZeroCoupon, Price: 95, Coupon: 0, ExpiryDate: "01/01/2027"}
	b.CalculateMetrics(0.125, ref)
	years := 365.0 / 365.25
	expectedYield := (math.Pow(100.0/95, 1/years) - 1) * 100
	if !b.AnalyticsAvailable || math.Abs(b.YTMGross-expectedYield) > 0.005 {
		t.Fatalf("incorrect yield: %+v", b)
	}
	expectedDuration := years / (1 + expectedYield/100)
	if math.Abs(b.DurationMod-expectedDuration) > 0.005 {
		t.Fatalf("duration not based on gross yield: %+v", b)
	}
	firstYield := b.YTMGross
	b.CalculateMetrics(0, ref.AddDate(0, 3, 0))
	if b.YTMGross == firstYield || b.YTMGross != b.YTMNet {
		t.Fatal("exact timing and zero tax must be respected")
	}
	for _, kind := range []BondType{BondTypeValore, BondTypeFutura, BondTypeItalia, BondTypeInflation, BondTypeFloating} {
		b.BondType, b.Score, b.YTMNet = kind, 99, 20
		b.CalculateMetrics(0.125, ref)
		if b.AnalyticsAvailable || b.Score != 0 || b.YTMNet != 0 || b.TierRank != "N/A" {
			t.Fatalf("unsupported analytics survive: %+v", b)
		}
	}
	b.BondType = BondTypeZeroCoupon
	b.CalculateMetrics(0.125, ref.AddDate(2, 0, 0))
	if b.IsTraded || b.AnalyticsAvailable {
		t.Fatal("matured bond must not be ranked")
	}
}

func TestFixedCouponDatedEstimates(t *testing.T) {
	ref := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	b := BTP{Price: 100, Coupon: 4, BondType: BondTypeFixed, ExpiryDate: "01/01/2031"}
	b.CalculateMetrics(0, ref)
	// At par on a coupon date, a 4% semiannual coupon is ~4.04% annual effective.
	if !b.AnalyticsAvailable || math.Abs(b.YTMGross-4.04) > 0.01 || b.YTMNet != b.YTMGross || b.TotalReturnGross != 20 {
		t.Fatalf("incorrect par coupon estimate: %+v", b)
	}
	// A bond one month from redemption still pays a whole final coupon. The
	// purchaser pays accrued interest, so that coupon is not a windfall.
	b.ExpiryDate = "01/07/2026"
	b.CalculateMetrics(0, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	if !b.AnalyticsAvailable || b.YTMGross < 3.9 || b.YTMGross > 4.1 || b.TotalReturnGross > 0.4 {
		t.Fatalf("fractional period/accrual calculation incorrect: %+v", b)
	}
	b = BTP{ISIN: "IT0005425233", Price: 53.84, Coupon: 1.7, BondType: BondTypeFixed, ExpiryDate: "01/09/2051"}
	b.CalculateMetrics(0.125, time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC))
	if !b.AnalyticsAvailable || b.YTMGross < 4 || b.YTMGross > 6 || b.YTMNet >= b.YTMGross || b.DurationMod <= 10 {
		t.Fatalf("reported fixed BTP regression: %+v", b)
	}
}
