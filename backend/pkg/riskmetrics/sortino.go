package riskmetrics

func sortino(mean, target, downside, annualScale float64) *float64 {
	if downside == 0 {
		return nil
	}
	return number((mean - target) / downside * annualScale)
}
