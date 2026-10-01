package riskmetrics

import "math"

// Drawdowns returns positive peak-to-trough loss fractions. Callers must pass
// validated, chronological, positive levels (as required by Calculate).
func Drawdowns(points []Point) []float64 {
	result := make([]float64, len(points))
	var peak float64
	for i, p := range points {
		peak = math.Max(peak, p.Price)
		result[i] = 1 - p.Price/peak
	}
	return result
}

func maxDrawdown(drawdowns []float64) float64 {
	var result float64
	for _, d := range drawdowns {
		result = math.Max(result, d)
	}
	return result
}
