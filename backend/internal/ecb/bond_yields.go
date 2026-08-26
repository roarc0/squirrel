package ecb

import (
	"context"
	"errors"
)

const bondYieldsSource = "https://data.ecb.europa.eu/data/data-categories/financial-markets-and-interest-rates/interest-rate-statistics-convergence-purposes/long-term-interest-rates"

func (c *Client) FetchSovereignYields(ctx context.Context, observationCount ...int) (MarketContext, error) {
	count := 1
	if len(observationCount) > 0 && observationCount[0] > 0 {
		count = observationCount[0]
	}
	records, err := c.observations(ctx, "IRS", "M.IT+DE.L.L40.CI.0000.EUR.N.Z", count)
	if err != nil {
		return MarketContext{}, err
	}
	labels := map[string]string{"IT": "Italy 10-year government yield", "DE": "Germany 10-year government yield"}
	byPeriodAndArea := make(map[string]map[string]float64)
	latest := make(map[string]Metric, 2)
	result := MarketContext{Observations: make([]Observation, 0, len(records))}

	for _, row := range records {
		area := row["REF_AREA"]
		label, ok := labels[area]
		if !ok || row["OBS_VALUE"] == "" {
			continue
		}
		value, err := row.number()
		if err != nil {
			return MarketContext{}, err
		}
		period := row["TIME_PERIOD"]
		code := "YIELD_10Y_" + area
		result.Observations = append(result.Observations, Observation{Code: code, ObservedOn: period, Value: value})
		if current, ok := latest[area]; !ok || period > current.ObservedOn {
			latest[area] = Metric{Code: code, Label: label, Category: "sovereign_bonds", Value: value, Unit: "%", ObservedOn: period, SourceURL: bondYieldsSource}
		}
		if byPeriodAndArea[period] == nil {
			byPeriodAndArea[period] = make(map[string]float64)
		}
		byPeriodAndArea[period][area] = value
	}

	for period, areas := range byPeriodAndArea {
		it, itOK := areas["IT"]
		de, deOK := areas["DE"]
		if itOK && deOK {
			spread := (it - de) * 100
			result.Observations = append(result.Observations, Observation{Code: "SPREAD_IT_DE_10Y", ObservedOn: period, Value: spread})
		}
	}

	italy, italyOK := latest["IT"]
	germany, germanyOK := latest["DE"]
	if !italyOK || !germanyOK || italy.ObservedOn != germany.ObservedOn {
		return MarketContext{}, errors.New("ECB sovereign-yield response is incomplete")
	}
	spread := Metric{Code: "SPREAD_IT_DE_10Y", Label: "Italy–Germany 10-year spread", Category: "sovereign_bonds", Value: (italy.Value - germany.Value) * 100, Unit: "bps", ObservedOn: italy.ObservedOn, SourceURL: bondYieldsSource}
	result.Metrics = append(result.Metrics, italy, germany, spread)
	return result, nil
}

