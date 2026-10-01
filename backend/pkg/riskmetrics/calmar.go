package riskmetrics

func calmar(growth *float64, drawdown float64) *float64 {
	if growth == nil || drawdown == 0 {
		return nil
	}
	return number(*growth / drawdown)
}
