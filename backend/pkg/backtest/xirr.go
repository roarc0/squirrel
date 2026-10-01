package backtest

import "math"

// Positive deposits plus one terminal redemption give a monotonic root in log
// growth, avoiding ambiguous multiple IRRs. Annualization uses ACT/365.25.
func moneyWeightedReturn(days []Day) *float64 {
	last := days[len(days)-1]
	objective := func(growth float64) float64 {
		var future, previous float64
		for _, d := range days {
			deposit := d.Contributed - previous
			previous = d.Contributed
			if deposit == 0 {
				continue
			}
			years := last.Time.Sub(d.Time).Hours() / (24 * 365.25)
			future += deposit * math.Exp(growth*years)
		}
		return future - last.Value
	}
	lo, hi := -32.0, 32.0
	if objective(lo) > 0 || objective(hi) < 0 {
		return nil
	}
	for range 160 {
		mid := (lo + hi) / 2
		if objective(mid) > 0 {
			hi = mid
		} else {
			lo = mid
		}
	}
	return number(math.Expm1((lo + hi) / 2))
}
