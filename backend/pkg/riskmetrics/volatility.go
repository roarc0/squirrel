package riskmetrics

import "math"

func sampleDeviation(sumSquares, count float64) float64 {
	return math.Sqrt(math.Max(0, sumSquares) / (count - 1))
}
