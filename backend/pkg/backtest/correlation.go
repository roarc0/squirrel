package backtest

import "math"

type Correlation struct {
	Left, Right string
	Value       *float64
}
type CorrelationWindow struct {
	Years, Observations int
	Pairs               []Correlation
}

// Correlations calculates Pearson correlation of aligned simple daily returns.
// A 0-year window means the complete history. Other windows must be fully covered.
// Constant series have no defined correlation. Calendar weekends are retained.
func Correlations(h History, years int) CorrelationWindow {
	result := CorrelationWindow{Years: years}
	if len(h.Dates) < 31 || years < 0 {
		return result
	}
	from := 0
	if years > 0 {
		start := anniversary(h.Dates[len(h.Dates)-1], -years)
		if start.Before(h.Dates[0]) {
			return result
		}
		from = int(start.Sub(h.Dates[0]).Hours() / 24)
	}
	result.Observations = len(h.Dates) - from - 1
	for i, left := range h.Coverage {
		for j := 0; j <= i; j++ {
			right := h.Coverage[j]
			x, y := h.Levels[left.ID], h.Levels[right.ID]
			var mx, my, vx, vy, cov float64
			for k := from + 1; k < len(h.Dates); k++ {
				n := float64(k - from)
				rx, ry := x[k]/x[k-1]-1, y[k]/y[k-1]-1
				dx, dy := rx-mx, ry-my
				mx += dx / n
				my += dy / n
				vx += dx * (rx - mx)
				vy += dy * (ry - my)
				cov += dx * (ry - my)
			}
			var value *float64
			if vx > 0 && vy > 0 {
				value = number(math.Max(-1, math.Min(1, cov/math.Sqrt(vx)/math.Sqrt(vy))))
			}
			result.Pairs = append(result.Pairs, Correlation{Left: left.ID, Right: right.ID, Value: value})
		}
	}
	return result
}
