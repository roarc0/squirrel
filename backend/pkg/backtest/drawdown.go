package backtest

import (
	"math"
	"time"

	"github.com/roarc0/squirrel/backend/pkg/riskmetrics"
)

type DrawdownAnalysis struct {
	Maximum                  float64
	Values                   []float64
	Average                  float64
	LongestDays              int
	LongestStart, LongestEnd time.Time
	Unrecovered              bool
}

func drawdownAnalysis(points []riskmetrics.Point) DrawdownAnalysis {
	a := DrawdownAnalysis{Values: riskmetrics.Drawdowns(points)}
	peak := 0
	for i, d := range a.Values {
		a.Maximum = math.Max(a.Maximum, d)
		a.Average += d / float64(len(points))
		if d == 0 {
			if i > 0 && a.Values[i-1] > 0 {
				duration := int(points[i].Time.Sub(points[peak].Time).Hours() / 24)
				if duration > a.LongestDays {
					a.LongestDays, a.LongestStart, a.LongestEnd, a.Unrecovered = duration, points[peak].Time, points[i].Time, false
				}
			}
			peak = i
		} else if i == len(points)-1 {
			duration := int(points[i].Time.Sub(points[peak].Time).Hours() / 24)
			if duration > a.LongestDays {
				a.LongestDays, a.LongestStart, a.LongestEnd, a.Unrecovered = duration, points[peak].Time, points[i].Time, true
			}
		}
	}
	return a
}
