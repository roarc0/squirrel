package ecb

import (
	"context"
	"fmt"
)

const ycSource = "https://data.ecb.europa.eu/data/data-categories/financial-markets-and-interest-rates/euro-area-yield-curves"

func (c *Client) FetchEuroYieldCurve(ctx context.Context, observationCount ...int) (MarketContext, error) {
	count := 12
	if len(observationCount) > 0 && observationCount[0] > 0 {
		count = observationCount[0]
	}

	maturities := []struct {
		code  string
		label string
		key   string
	}{
		{"YIELD_EUR_2Y", "Euro AAA Govt Bond Yield 2Y", "SR_2Y"},
		{"YIELD_EUR_5Y", "Euro AAA Govt Bond Yield 5Y", "SR_5Y"},
		{"YIELD_EUR_10Y", "Euro AAA Govt Bond Yield 10Y", "SR_10Y"},
		{"YIELD_EUR_30Y", "Euro AAA Govt Bond Yield 30Y", "SR_30Y"},
	}

	var result MarketContext
	latestVals := make(map[string]float64)
	latestDates := make(map[string]string)
	obsByDate := make(map[string]map[string]float64)

	for _, mat := range maturities {
		records, err := c.observations(ctx, "YC", fmt.Sprintf("B.U2.EUR.4F.G_N_A.SV_C_YM.%s", mat.key), count)
		if err != nil {
			continue
		}
		for _, row := range records {
			val, err := row.number()
			if err != nil {
				continue
			}
			period := row["TIME_PERIOD"]
			result.Observations = append(result.Observations, Observation{
				Code:       mat.code,
				ObservedOn: period,
				Value:      val,
			})
			if obsByDate[period] == nil {
				obsByDate[period] = make(map[string]float64)
			}
			obsByDate[period][mat.code] = val

			if currentDate, ok := latestDates[mat.code]; !ok || period > currentDate {
				latestDates[mat.code] = period
				latestVals[mat.code] = val
			}
		}
		if date, ok := latestDates[mat.code]; ok {
			result.Metrics = append(result.Metrics, Metric{
				Code:       mat.code,
				Label:      mat.label,
				Category:   "yield_curves",
				Value:      latestVals[mat.code],
				Unit:       "%",
				ObservedOn: date,
				SourceURL:  ycSource,
			})
		}
	}

	// Calculate 10Y - 2Y Spread history
	for period, vals := range obsByDate {
		y10, ok10 := vals["YIELD_EUR_10Y"]
		y2, ok2 := vals["YIELD_EUR_2Y"]
		if ok10 && ok2 {
			spread := (y10 - y2) * 100 // in bps
			result.Observations = append(result.Observations, Observation{
				Code:       "SPREAD_EUR_10Y_2Y",
				ObservedOn: period,
				Value:      spread,
			})
		}
	}

	y10, ok10 := latestVals["YIELD_EUR_10Y"]
	y2, ok2 := latestVals["YIELD_EUR_2Y"]
	if ok10 && ok2 {
		date := latestDates["YIELD_EUR_10Y"]
		spread := (y10 - y2) * 100
		result.Metrics = append(result.Metrics, Metric{
			Code:       "SPREAD_EUR_10Y_2Y",
			Label:      "Euro AAA Yield Curve 10Y–2Y Spread",
			Category:   "yield_curves",
			Value:      spread,
			Unit:       "bps",
			ObservedOn: date,
			SourceURL:  ycSource,
		})
	}

	return result, nil
}
