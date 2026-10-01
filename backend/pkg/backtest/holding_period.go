package backtest

import "math"

type HoldingPeriod struct {
	Years, Samples                   int
	WorstReturn, NonnegativeFraction *float64
}

// Overlapping windows start on each observed day. Outcomes describe historical
// time-weighted returns, not an independent-sample probability forecast.
func holdingPeriod(days []Day, years int) HoldingPeriod {
	result := HoldingPeriod{Years: years}
	worst, successes := math.Inf(1), 0
	for i, day := range days {
		end := anniversary(day.Time, years)
		if end.After(days[len(days)-1].Time) {
			break
		}
		j := int(end.Sub(days[0].Time).Hours() / 24)
		r := days[j].Index/days[i].Index - 1
		worst = math.Min(worst, r)
		if r >= 0 {
			successes++
		}
		result.Samples++
	}
	if result.Samples > 0 {
		result.WorstReturn = number(worst)
		result.NonnegativeFraction = number(float64(successes) / float64(result.Samples))
	}
	return result
}
