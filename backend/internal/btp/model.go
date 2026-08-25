package btp

import (
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
	ISIN             string   `json:"isin"`
	Name             string   `json:"name"`
	BondType         BondType `json:"bond_type"`
	Price            float64  `json:"price"`
	Coupon           float64  `json:"coupon"`
	ExpiryDate       string   `json:"expiry_date"`
	MaturityYears    float64  `json:"maturity_years"`
	DurationMac      float64  `json:"duration_mac"`
	DurationMod      float64  `json:"duration_mod"`
	RateHikeImpact   float64  `json:"rate_hike_impact"`
	SimpleYieldNet   float64  `json:"simple_yield_net"`
	SimpleYieldGross float64  `json:"simple_yield_gross"`
	YTMGross         float64  `json:"ytm_gross"`
	YTMNet           float64  `json:"ytm_net"`
	TotalReturnNet   float64  `json:"total_return_net"`
	TotalReturnGross float64  `json:"total_return_gross"`
	Score            float64  `json:"score"`
	TierRank         string   `json:"tier_rank"`
	IsTraded         bool     `json:"is_traded"`
	ScrapedAt        string   `json:"scraped_at"`
	IsStarred        bool     `json:"is_starred"`
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

	expiry, err := time.Parse("02/01/2006", b.ExpiryDate)
	if err != nil {
		b.MaturityYears = 0
		b.SimpleYieldNet = 0
		b.SimpleYieldGross = 0
		b.IsTraded = false
		return
	}

	durationDays := expiry.Sub(referenceTime).Hours() / 24.0
	if durationDays <= 0 {
		b.MaturityYears = 0.01
	} else {
		b.MaturityYears = math.Max(0.01, math.Round((durationDays/365.25)*100)/100)
	}

	if b.Price <= 0 {
		b.IsTraded = false
		b.SimpleYieldNet = 0
		b.SimpleYieldGross = 0
		b.Score = 0
		b.TierRank = "F"
		return
	}

	b.IsTraded = true
	if taxRate <= 0 {
		taxRate = 0.125
	}

	netCoupon := b.Coupon * (1.0 - taxRate)
	annualCapitalGain := (100.0 - b.Price) / b.MaturityYears

	var netCapitalGain float64
	if annualCapitalGain > 0 {
		netCapitalGain = annualCapitalGain * (1.0 - taxRate)
	} else {
		netCapitalGain = annualCapitalGain
	}

	netYield := ((netCoupon + netCapitalGain) / b.Price) * 100.0
	grossYield := ((b.Coupon + annualCapitalGain) / b.Price) * 100.0

	b.SimpleYieldNet = sanitizeFloatValue(netYield, 2)
	b.SimpleYieldGross = sanitizeFloatValue(grossYield, 2)

	totalCouponGross := b.Coupon * b.MaturityYears
	totalCapGross := 100.0 - b.Price
	b.TotalReturnGross = sanitizeFloatValue(((totalCouponGross+totalCapGross)/b.Price)*100.0, 2)

	totalCouponNet := netCoupon * b.MaturityYears
	totalCapNet := netCapitalGain * b.MaturityYears
	b.TotalReturnNet = sanitizeFloatValue(((totalCouponNet+totalCapNet)/b.Price)*100.0, 2)

	b.YTMGross, b.YTMNet = CalculateCompoundYTM(b.Price, b.Coupon, b.MaturityYears, taxRate)
	b.DurationMac, b.DurationMod, b.RateHikeImpact = CalculateDuration(b.Price, b.Coupon, b.MaturityYears, b.YTMNet)
}

func sanitizeFloatValue(val float64, decimals int) float64 {
	if math.IsNaN(val) || math.IsInf(val, 0) {
		return 0.0
	}
	pow := math.Pow(10, float64(decimals))
	return math.Round(val*pow) / pow
}
