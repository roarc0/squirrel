package btp

import (
	"fmt"
	"math"
	"strings"
	"time"
)

type BondType string

const (
	BondTypeFixed      BondType = "Fixed"
	BondTypeFutura     BondType = "Futura"
	BondTypeValore     BondType = "Valore"
	BondTypeItalia     BondType = "Italia"
	BondTypeZeroCoupon BondType = "ZeroCoupon"
	BondTypeInflation  BondType = "Inflation"
	BondTypeFloating   BondType = "Floating"
)

func DetectBondType(name string, coupon float64) BondType {
	upper := strings.ToUpper(name)

	if strings.Contains(upper, "ZERO") ||
		strings.Contains(upper, " ZC") ||
		strings.Contains(upper, "CTZ") ||
		strings.Contains(upper, "STRIP") ||
		strings.Contains(upper, "STR ") ||
		strings.HasSuffix(upper, " STR") {
		return BondTypeZeroCoupon
	}

	if strings.Contains(upper, "ITALIA") {
		return BondTypeItalia
	}

	if strings.Contains(upper, "FUTURA") {
		return BondTypeFutura
	}

	if strings.Contains(upper, "VALORE") {
		return BondTypeValore
	}

	if strings.Contains(upper, "BTP€I") ||
		strings.Contains(upper, "BTPEI") ||
		strings.Contains(upper, "BTPI") ||
		strings.Contains(upper, "€I ") ||
		strings.Contains(upper, "INDICIZZATO") ||
		strings.Contains(upper, "INFLATION") ||
		strings.Contains(upper, " REAL") {
		return BondTypeInflation
	}

	if strings.Contains(upper, "CCT") ||
		strings.Contains(upper, "VARIABILE") ||
		strings.Contains(upper, "FLOATING") {
		return BondTypeFloating
	}

	if coupon == 0 {
		return BondTypeZeroCoupon
	}

	return BondTypeFixed
}

type BTP struct {
	ISIN               string   `json:"isin"`
	Name               string   `json:"name"`
	BondType           BondType `json:"bond_type"`
	Price              float64  `json:"price"`
	Coupon             float64  `json:"coupon"`
	ExpiryDate         string   `json:"expiry_date"`
	MaturityYears      float64  `json:"maturity_years"`
	DurationMac        float64  `json:"duration_mac"`
	DurationMod        float64  `json:"duration_mod"`
	RateHikeImpact     float64  `json:"rate_hike_impact"`
	SimpleYieldNet     float64  `json:"simple_yield_net"`
	SimpleYieldGross   float64  `json:"simple_yield_gross"`
	YTMGross           float64  `json:"ytm_gross"`
	YTMNet             float64  `json:"ytm_net"`
	TotalReturnNet     float64  `json:"total_return_net"`
	TotalReturnGross   float64  `json:"total_return_gross"`
	Score              float64  `json:"score"`
	TierRank           string   `json:"tier_rank"`
	IsTraded           bool     `json:"is_traded"`
	ScrapedAt          string   `json:"scraped_at"`
	AnalyticsAvailable bool     `json:"analytics_available"`
	AnalyticsNote      string   `json:"analytics_note"`
	IsStarred          bool     `json:"is_starred"`
}

type ScoringConfig struct {
	TaxRate            float64
	TargetMaturityYear int
	CommissionEur      float64
	InvestmentEur      float64
}

func (b *BTP) CalculateMetrics(taxRate float64, referenceTime time.Time) {
	if b.BondType == "" {
		b.BondType = DetectBondType(b.Name, b.Coupon)
	}

	if referenceTime.IsZero() {
		referenceTime = time.Now()
	}

	// Clear derived values even when recalculating records from an older cache.
	b.MaturityYears, b.DurationMac, b.DurationMod, b.RateHikeImpact = 0, 0, 0, 0
	b.SimpleYieldNet, b.SimpleYieldGross, b.YTMGross, b.YTMNet = 0, 0, 0, 0
	b.TotalReturnNet, b.TotalReturnGross, b.Score = 0, 0, 0
	b.TierRank, b.AnalyticsAvailable, b.IsTraded = "N/A", false, false
	b.AnalyticsNote = "Analytics unavailable: the quote is invalid or the bond has matured."
	expiry, err := time.Parse("02/01/2006", b.ExpiryDate)
	if err != nil || !expiry.After(referenceTime) || b.Price <= 0 || math.IsNaN(b.Price) || math.IsInf(b.Price, 0) {
		return
	}
	b.MaturityYears = expiry.Sub(referenceTime).Hours() / (24 * 365.25)
	b.IsTraded = true
	b.AnalyticsNote = "Yield and cash-flow calculations unavailable: verified payment schedule, settlement and accrued interest are missing."
	if b.BondType != BondTypeZeroCoupon || b.Coupon != 0 || taxRate < 0 || taxRate > 1 || math.IsNaN(taxRate) {
		return
	}
	// Zero coupons have a single dated payment; no coupon schedule or accrued coupon is inferred.
	netRedemption := 100 - math.Max(0, 100-b.Price)*taxRate
	grossYield := math.Pow(100/b.Price, 1/b.MaturityYears) - 1
	netYield := math.Pow(netRedemption/b.Price, 1/b.MaturityYears) - 1
	if math.IsNaN(grossYield) || math.IsInf(grossYield, 0) || math.IsNaN(netYield) || math.IsInf(netYield, 0) {
		return
	}
	b.AnalyticsAvailable = true
	b.AnalyticsNote = fmt.Sprintf("Zero-coupon estimate at the quote date: redemption at 100, annual effective yield, ACT/365.25, %.2f%% tax; excludes fees and settlement lag.", taxRate*100)
	b.YTMGross, b.YTMNet = sanitizeFloatValue(grossYield*100, 2), sanitizeFloatValue(netYield*100, 2)
	b.DurationMac = sanitizeFloatValue(b.MaturityYears, 2)
	b.DurationMod = sanitizeFloatValue(b.MaturityYears/(1+grossYield), 2)
	b.RateHikeImpact = sanitizeFloatValue(-b.MaturityYears/(1+grossYield), 1)
	b.TotalReturnGross = sanitizeFloatValue((100/b.Price-1)*100, 2)
	b.TotalReturnNet = sanitizeFloatValue((netRedemption/b.Price-1)*100, 2)
	b.SimpleYieldGross = sanitizeFloatValue(b.TotalReturnGross/b.MaturityYears, 2)
	b.SimpleYieldNet = sanitizeFloatValue(b.TotalReturnNet/b.MaturityYears, 2)
}

func sanitizeFloatValue(val float64, decimals int) float64 {
	if math.IsNaN(val) || math.IsInf(val, 0) {
		return 0.0
	}
	pow := math.Pow(10, float64(decimals))
	return math.Round(val*pow) / pow
}
