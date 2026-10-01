package riskmetrics

func sharpe(mean, riskFree, deviation, annualScale float64) *float64 {
	if deviation == 0 {
		return nil
	}
	return number((mean - riskFree) / deviation * annualScale)
}
