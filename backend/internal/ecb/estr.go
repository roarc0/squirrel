package ecb

import (
	"context"
	"fmt"
)

const estrSource = "https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_short-term_rate/html/eurostr_overview.en.html"

func (c *Client) FetchESTR(ctx context.Context, observationCount ...int) (MarketContext, error) {
	count := 1
	if len(observationCount) > 0 && observationCount[0] > 0 {
		count = observationCount[0]
	}
	records, err := c.observations(ctx, "EST", "", count)
	if err != nil {
		return MarketContext{}, err
	}
	series := []struct {
		code  string
		label string
	}{
		{"EU000A2X2A25.WT", "€STR overnight"},
		{"EU000A2QQF24.CR", "€STR compounded 1 month"},
		{"EU000A2QQF32.CR", "€STR compounded 3 months"},
	}
	seriesMap := map[string]string{
		"EU000A2X2A25.WT": "€STR overnight",
		"EU000A2QQF24.CR": "€STR compounded 1 month",
		"EU000A2QQF32.CR": "€STR compounded 3 months",
	}
	latest := make(map[string]Metric, len(series))
	result := MarketContext{Observations: make([]Observation, 0, len(records))}
	for _, row := range records {
		code := row["BENCHMARK_ITEM"] + "." + row["DATA_TYPE_EST"]
		if _, ok := seriesMap[code]; !ok || row["OBS_VALUE"] == "" {
			continue
		}
		value, err := row.number()
		if err != nil {
			return MarketContext{}, err
		}
		obs := Observation{Code: code, ObservedOn: row["TIME_PERIOD"], Value: value}
		result.Observations = append(result.Observations, obs)
		if current, ok := latest[code]; !ok || obs.ObservedOn > current.ObservedOn {
			latest[code] = Metric{Code: code, Category: "money_market", Value: value, Unit: "%", ObservedOn: obs.ObservedOn, SourceURL: estrSource}
		}
	}
	for _, item := range series {
		metric, ok := latest[item.code]
		if !ok {
			return MarketContext{}, fmt.Errorf("ECB €STR response is missing %s", item.code)
		}
		metric.Label = item.label
		result.Metrics = append(result.Metrics, metric)
	}
	return result, nil
}

