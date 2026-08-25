package btp

import (
	"math"
)

func CalculateDuration(price, annualCoupon, maturityYears, netYield float64) (macDur float64, modDur float64, rateImpact float64) {
	if price <= 0 || maturityYears <= 0 {
		return 0, 0, 0
	}

	y := netYield / 100.0
	if y <= -0.5 || math.IsNaN(y) || math.IsInf(y, 0) {
		y = 0.001
	}

	c := annualCoupon / 2.0
	periods := int(math.Round(maturityYears * 2.0))
	if periods < 1 {
		periods = 1
	}

	discountFactorPerPeriod := 1.0 + (y / 2.0)
	if discountFactorPerPeriod <= 0.001 {
		discountFactorPerPeriod = 1.001
	}

	weightedCashFlows := 0.0
	totalPresentValue := 0.0

	for t := 1; t <= periods; t++ {
		timeInYears := float64(t) / 2.0
		cf := c
		if t == periods {
			cf += 100.0
		}

		pv := cf / math.Pow(discountFactorPerPeriod, float64(t))
		totalPresentValue += pv
		weightedCashFlows += timeInYears * pv
	}

	if totalPresentValue <= 0 {
		totalPresentValue = price
	}

	macDur = weightedCashFlows / totalPresentValue
	modDur = macDur / discountFactorPerPeriod
	rateImpact = -modDur * 1.0

	macDur = sanitizeFloat(macDur, 2)
	modDur = sanitizeFloat(modDur, 2)
	rateImpact = sanitizeFloat(rateImpact, 1)

	return macDur, modDur, rateImpact
}

func CalculateCompoundYTM(price, annualCoupon, maturityYears, taxRate float64) (ytmGross float64, ytmNet float64) {
	if price <= 0 || maturityYears <= 0 {
		return 0, 0
	}

	if taxRate <= 0 {
		taxRate = 0.125
	}

	periods := int(math.Round(maturityYears * 2.0))
	if periods < 1 {
		periods = 1
	}

	ytmGross = solveBondYTM(price, annualCoupon/2.0, 100.0, periods, maturityYears)

	netCoupon := (annualCoupon * (1.0 - taxRate)) / 2.0
	netRedemption := 100.0
	if price < 100.0 {
		capitalGain := 100.0 - price
		netRedemption = 100.0 - (capitalGain * taxRate)
	}
	ytmNet = solveBondYTM(price, netCoupon, netRedemption, periods, maturityYears)

	ytmGross = sanitizeFloat(ytmGross, 2)
	ytmNet = sanitizeFloat(ytmNet, 2)

	return ytmGross, ytmNet
}

func solveBondYTM(price, couponPerPeriod, redemption float64, periods int, maturityYears float64) float64 {
	if periods <= 0 || price <= 0 {
		return 0.0
	}

	if couponPerPeriod <= 0 {
		if maturityYears <= 0 {
			return 0.0
		}
		rSemi := math.Pow(redemption/price, 1.0/(2.0*maturityYears)) - 1.0
		res := rSemi * 2.0 * 100.0
		if math.IsNaN(res) || math.IsInf(res, 0) {
			return 0.0
		}
		return res
	}

	r := ((couponPerPeriod + (redemption-price)/float64(periods)) / ((price + redemption) / 2.0))
	if r <= -0.5 || r > 1.0 || math.IsNaN(r) || math.IsInf(r, 0) {
		r = 0.02
	}

	converged := false
	for i := 0; i < 40; i++ {
		pv := 0.0
		dpv := 0.0
		for t := 1; t <= periods; t++ {
			cf := couponPerPeriod
			if t == periods {
				cf += redemption
			}
			df := math.Pow(1.0+r, float64(t))
			if df == 0 || math.IsNaN(df) || math.IsInf(df, 0) {
				break
			}
			pv += cf / df
			dpv -= (float64(t) * cf) / (df * (1.0 + r))
		}

		diff := pv - price
		if math.Abs(diff) < 1e-6 {
			converged = true
			break
		}

		if math.Abs(dpv) > 1e-12 && !math.IsNaN(dpv) && !math.IsInf(dpv, 0) {
			nextR := r - diff/dpv
			if nextR <= -0.5 || nextR > 2.0 || math.IsNaN(nextR) || math.IsInf(nextR, 0) {
				break
			}
			r = nextR
		} else {
			break
		}
	}

	if !converged {
		r = bisectionBondYTM(price, couponPerPeriod, redemption, periods)
	}

	res := r * 2.0 * 100.0
	if math.IsNaN(res) || math.IsInf(res, 0) || res < -50.0 || res > 100.0 {
		return 0.0
	}
	return res
}

func bisectionBondYTM(price, couponPerPeriod, redemption float64, periods int) float64 {
	low := -0.20
	high := 0.50

	for iter := 0; iter < 60; iter++ {
		mid := (low + high) / 2.0
		pv := 0.0
		for t := 1; t <= periods; t++ {
			cf := couponPerPeriod
			if t == periods {
				cf += redemption
			}
			pv += cf / math.Pow(1.0+mid, float64(t))
		}

		if math.Abs(pv-price) < 1e-6 {
			return mid
		}

		if pv > price {
			low = mid
		} else {
			high = mid
		}
	}
	return (low + high) / 2.0
}

func sanitizeFloat(val float64, decimals int) float64 {
	if math.IsNaN(val) || math.IsInf(val, 0) || val < -100.0 || val > 100.0 {
		return 0.0
	}
	pow := math.Pow(10, float64(decimals))
	return math.Round(val*pow) / pow
}
