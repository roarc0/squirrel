package btp

import (
	"math"
	"sort"
	"time"
)

func AdvancedTier(total float64) string {
	switch {
	case total >= 85:
		return "S"
	case total >= 70:
		return "A"
	case total >= 55:
		return "B"
	case total >= 40:
		return "C"
	case total >= 25:
		return "D"
	default:
		return "F"
	}
}

type CurveSet struct {
	Fix   [3]float64
	FixOK bool
	Zc    [3]float64
	ZcOK  bool
}

func solveLinear3x3(A [3][3]float64, b [3]float64) ([3]float64, bool) {
	var mat [3][4]float64
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			mat[i][j] = A[i][j]
		}
		mat[i][3] = b[i]
	}
	for col := 0; col < 3; col++ {
		maxRow := col
		for row := col + 1; row < 3; row++ {
			if math.Abs(mat[row][col]) > math.Abs(mat[maxRow][col]) {
				maxRow = row
			}
		}
		mat[col], mat[maxRow] = mat[maxRow], mat[col]
		if math.Abs(mat[col][col]) < 1e-12 {
			return [3]float64{}, false
		}
		for row := col + 1; row < 3; row++ {
			f := mat[row][col] / mat[col][col]
			for j := col; j <= 3; j++ {
				mat[row][j] -= f * mat[col][j]
			}
		}
	}
	var x [3]float64
	for i := 2; i >= 0; i-- {
		if math.Abs(mat[i][i]) < 1e-12 {
			return [3]float64{}, false
		}
		x[i] = mat[i][3]
		for j := i + 1; j < 3; j++ {
			x[i] -= mat[i][j] * x[j]
		}
		x[i] /= mat[i][i]
	}
	return x, true
}

func FitYieldCurve(btps []BTP) ([3]float64, bool) {
	type pt struct{ x, y float64 }
	var pts []pt
	for _, b := range btps {
		if b.IsTraded && b.DurationMod > 0.1 && b.YTMNet > 0.01 && b.MaturityYears > 0.1 {
			pts = append(pts, pt{b.DurationMod, b.YTMNet})
		}
	}
	n := float64(len(pts))
	if n < 5 {
		return [3]float64{}, false
	}
	var sx, sx2, sx3, sx4, sy, sxy, sx2y float64
	for _, p := range pts {
		x, y := p.x, p.y
		x2 := x * x
		sx += x
		sx2 += x2
		sx3 += x2 * x
		sx4 += x2 * x2
		sy += y
		sxy += x * y
		sx2y += x2 * y
	}
	A := [3][3]float64{{n, sx, sx2}, {sx, sx2, sx3}, {sx2, sx3, sx4}}
	bv := [3]float64{sy, sxy, sx2y}
	return solveLinear3x3(A, bv)
}

func EvalCurve(coef [3]float64, d float64) float64 {
	v := coef[0] + coef[1]*d + coef[2]*d*d
	return math.Max(0, math.Min(20, v))
}

func percentileRank(val float64, sortedVals []float64) float64 {
	n := len(sortedVals)
	if n <= 1 {
		return 5.0
	}
	lo := sortedVals[maxInt(0, n*5/100)]
	hi := sortedVals[minInt(n-1, n*95/100)]
	if hi <= lo {
		return 5.0
	}
	v := math.Max(lo, math.Min(hi, val))
	return (v - lo) / (hi - lo) * 10.0
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func scoreD(b *BTP, targetYear int) float64 {
	dur := b.DurationMod
	if dur <= 0 {
		return 5.0
	}
	if targetYear > 0 {
		now := time.Now()
		targetYears := float64(targetYear-now.Year()) + 0.5
		if targetYears < 0 {
			targetYears = 0
		}
		excess := math.Max(0, dur-targetYears)
		penalty := excess * 1.5
		return math.Max(1.0, math.Min(10.0, 10.0-penalty))
	}
	switch {
	case dur <= 1.5:
		return 5.0
	case dur <= 3.0:
		return 7.5
	case dur <= 7.0:
		return 9.0
	case dur <= 12.0:
		return 6.0
	case dur <= 18.0:
		return 3.5
	default:
		return 1.5
	}
}

func scoreL(b *BTP) float64 {
	score := 6.0
	switch {
	case b.MaturityYears <= 5.0:
		score += 2.0
	case b.MaturityYears <= 10.0:
		score += 1.0
	case b.MaturityYears > 20.0:
		score -= 2.0
	}
	if b.MaturityYears < 0.5 {
		score -= 2.5
	}
	switch b.BondType {
	case BondTypeZeroCoupon:
		score -= 1.5
	case BondTypeInflation:
		score -= 1.0
	case BondTypeFutura, BondTypeValore, BondTypeItalia:
		score -= 0.5
	}
	return math.Min(10.0, math.Max(0.0, score))
}

func scoreF(b *BTP, commissionEur, investmentEur float64) float64 {
	score := 5.0
	switch {
	case b.Price < 90.0:
		score += 3.0
	case b.Price < 95.0:
		score += 2.0
	case b.Price < 100.0:
		score += 1.0
	case b.Price > 110.0:
		score -= 2.0
	case b.Price > 105.0:
		score -= 1.0
	case b.Price > 102.0:
		score -= 0.5
	}
	if commissionEur > 0 && investmentEur > 0 && b.MaturityYears > 0 {
		drag := (commissionEur / investmentEur) * 100.0 / b.MaturityYears
		switch {
		case drag < 0.01:
			score += 0.5
		case drag > 0.15:
			score -= 1.5
		case drag > 0.08:
			score -= 0.5
		}
	}
	return math.Min(10.0, math.Max(0.0, score))
}

func scoreM(expiryDate string, targetYear int) float64 {
	if targetYear <= 0 {
		return -1
	}
	expiry, err := time.Parse("02/01/2006", expiryDate)
	if err != nil {
		return 5.0
	}
	target := time.Date(targetYear, time.June, 30, 0, 0, 0, 0, time.UTC)
	months := math.Abs(expiry.Sub(target).Hours() / 24.0 / 30.4375)
	switch {
	case months <= 6:
		return 10.0
	case months <= 12:
		return 8.0 + (12-months)/6.0
	case months <= 24:
		return 5.0 + (24-months)/12.0*3.0
	case months <= 36:
		return 2.0 + (36-months)/12.0*3.0
	case months <= 60:
		return math.Max(0, 2.0-(months-36)/24.0*2.0)
	default:
		return 0.0
	}
}

func ComputeAdvancedScores(btps []BTP, cfg ScoringConfig) []BTP {
	if len(btps) == 0 {
		return nil
	}

	var fixBonds, zcBonds, otherBonds []BTP
	for _, b := range btps {
		if !b.IsTraded || b.YTMNet <= 0 || b.MaturityYears <= 0.1 || b.DurationMod <= 0 {
			continue
		}
		switch b.BondType {
		case BondTypeFixed:
			fixBonds = append(fixBonds, b)
		case BondTypeZeroCoupon:
			zcBonds = append(zcBonds, b)
		default:
			otherBonds = append(otherBonds, b)
		}
	}

	allTraded := append(append(append([]BTP{}, fixBonds...), zcBonds...), otherBonds...)
	if len(allTraded) == 0 {
		return btps
	}

	curves := CurveSet{}
	if len(fixBonds) >= 5 {
		curves.Fix, curves.FixOK = FitYieldCurve(fixBonds)
	}
	if len(zcBonds) >= 5 {
		curves.Zc, curves.ZcOK = FitYieldCurve(zcBonds)
	}
	allCurve, allCurveOK := FitYieldCurve(allTraded)

	type bondWithCurve struct {
		btp     BTP
		vSpread float64
		fairYTM float64
	}
	bwc := make([]bondWithCurve, 0, len(allTraded))

	for _, b := range allTraded {
		var fairYTM float64

		switch b.BondType {
		case BondTypeFixed:
			if curves.FixOK {
				fairYTM = EvalCurve(curves.Fix, b.DurationMod)
			} else if allCurveOK {
				fairYTM = EvalCurve(allCurve, b.DurationMod)
			}
		case BondTypeZeroCoupon:
			if curves.ZcOK {
				fairYTM = EvalCurve(curves.Zc, b.DurationMod)
			} else if allCurveOK {
				fairYTM = EvalCurve(allCurve, b.DurationMod)
			}
		default:
			if allCurveOK {
				fairYTM = EvalCurve(allCurve, b.DurationMod)
			}
		}

		vSpread := b.YTMNet - fairYTM
		bwc = append(bwc, bondWithCurve{b, vSpread, fairYTM})
	}

	rawYTMs := make([]float64, len(bwc))
	rawVSpreads := make([]float64, len(bwc))
	for i, b := range bwc {
		rawYTMs[i] = b.btp.YTMNet
		rawVSpreads[i] = b.vSpread
	}
	sort.Float64s(rawYTMs)
	sort.Float64s(rawVSpreads)

	hasTarget := cfg.TargetMaturityYear > 0
	scoredMap := make(map[string]BTP)

	for _, item := range bwc {
		b := item.btp

		r := percentileRank(b.YTMNet, rawYTMs)
		v := percentileRank(item.vSpread, rawVSpreads)
		d := scoreD(&b, cfg.TargetMaturityYear)
		l := scoreL(&b)
		f := scoreF(&b, cfg.CommissionEur, cfg.InvestmentEur)
		m := scoreM(b.ExpiryDate, cfg.TargetMaturityYear)

		var total float64
		if hasTarget {
			total = r*2.5 + v*1.5 + d*1.5 + l*1.0 + f*0.5 + m*3.0
		} else {
			total = (r*4.0 + v*2.5 + d*1.0 + l*1.0 + f*0.5) * (100.0 / 90.0)
		}
		total = math.Round(math.Max(0, math.Min(100, total))*10) / 10

		b.Score = total
		b.TierRank = AdvancedTier(total)
		scoredMap[b.ISIN] = b
	}

	results := make([]BTP, len(btps))
	for i, b := range btps {
		if scored, ok := scoredMap[b.ISIN]; ok {
			results[i] = scored
		} else {
			results[i] = b
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	return results
}
