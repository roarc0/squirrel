package backtest

import (
	"math"
	"time"
)

type ReturnPoint struct {
	Time   time.Time
	Return float64
}
type RollingWindow struct {
	Years  int
	Points []ReturnPoint
}

// anniversary clamps February 29 to February 28 in non-leap years.
func anniversary(date time.Time, years int) time.Time {
	last := time.Date(date.Year()+years, date.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	return time.Date(date.Year()+years, date.Month(), min(date.Day(), last), 0, 0, 0, 0, time.UTC)
}

// Returns for every trailing calendar-year window, annualized using actual time.
func rollingReturns(days []Day, years int) RollingWindow {
	result := RollingWindow{Years: years}
	for i, day := range days {
		start := anniversary(day.Time, -years)
		if start.Before(days[0].Time) {
			continue
		}
		j := int(start.Sub(days[0].Time).Hours() / 24)
		elapsed := day.Time.Sub(days[j].Time).Hours() / (24 * 365.25)
		value := math.Expm1(math.Log(days[i].Index/days[j].Index) / elapsed)
		result.Points = append(result.Points, ReturnPoint{Time: day.Time, Return: value})
	}
	return result
}
