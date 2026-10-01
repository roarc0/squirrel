package backtest

import "time"

type MonthReturn struct {
	Year, Month int
	Return      float64
	Partial     bool
}

type YearReturn struct {
	Year    int
	Return  float64
	Partial bool
}

// Calendar returns require the preceding period-end close. The first and last
// buckets are marked partial if that baseline or the final close is missing.
func heatmap(days []Day) ([]MonthReturn, []YearReturn) {
	var months []MonthReturn
	for from := 0; from < len(days); {
		to := from
		for to+1 < len(days) && days[to+1].Time.Month() == days[from].Time.Month() {
			to++
		}
		base := from
		if from > 0 {
			base--
		}
		last := days[to].Time
		months = append(months, MonthReturn{Year: last.Year(), Month: int(last.Month()), Return: days[to].Index/days[base].Index - 1,
			Partial: from == 0 || last.Day() != time.Date(last.Year(), last.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()})
		from = to + 1
	}
	var years []YearReturn
	for from := 0; from < len(days); {
		to := from
		for to+1 < len(days) && days[to+1].Time.Year() == days[from].Time.Year() {
			to++
		}
		base := from
		if from > 0 {
			base--
		}
		last := days[to].Time
		years = append(years, YearReturn{Year: last.Year(), Return: days[to].Index/days[base].Index - 1,
			Partial: from == 0 || last.Month() != time.December || last.Day() != 31})
		from = to + 1
	}
	return months, years
}
