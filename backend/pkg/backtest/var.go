package backtest

import (
	"math"
	"slices"
)

type MonthlyStats struct {
	Count                          int
	PositiveFraction, VaR95, VaR99 *float64
}

// Monthly historical VaR is the nonnegative loss at the empirical lower-tail
// quantile (linear interpolation). Partial months are excluded, with a minimum
// of 12 complete months for tail estimates. No normal-distribution assumption.
func monthlyStatistics(months []MonthReturn) MonthlyStats {
	var values []float64
	positive := 0
	for _, m := range months {
		if m.Partial {
			continue
		}
		values = append(values, m.Return)
		if m.Return > 0 {
			positive++
		}
	}
	result := MonthlyStats{Count: len(values)}
	if len(values) > 0 {
		result.PositiveFraction = number(float64(positive) / float64(len(values)))
	}
	if len(values) < 12 {
		return result
	}
	slices.Sort(values)
	quantile := func(p float64) float64 {
		index := p * float64(len(values)-1)
		lo := int(index)
		return values[lo] + (values[min(lo+1, len(values)-1)]-values[lo])*(index-float64(lo))
	}
	result.VaR95 = number(math.Max(0, -quantile(.05)))
	result.VaR99 = number(math.Max(0, -quantile(.01)))
	return result
}
