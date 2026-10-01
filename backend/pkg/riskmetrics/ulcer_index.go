package riskmetrics

import "math"

func ulcerIndex(drawdowns []float64) float64 {
	var squares float64
	for _, d := range drawdowns {
		squares += d * d
	}
	return math.Sqrt(squares / float64(len(drawdowns)))
}
