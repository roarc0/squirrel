package btp

import (
	"context"
	"fmt"
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
