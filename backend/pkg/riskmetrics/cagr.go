package riskmetrics

import "math"

func cagr(points []Point) *float64 {
	years := points[len(points)-1].Time.Sub(points[0].Time).Hours() / (24 * DaysPerYear)
	return number(math.Expm1((math.Log(points[len(points)-1].Price) - math.Log(points[0].Price)) / years))
}
