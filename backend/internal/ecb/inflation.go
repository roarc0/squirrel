package ecb

import (
	"context"
	"errors"
	"sort"
)

const inflationSource = "https://data.ecb.europa.eu/data/datasets/HICP"

func (c *Client) FetchInflation(ctx context.Context, observationCount int) (MarketContext, error) {
	records, err := c.observations(ctx, "HICP", "M.IT+U2.N.000000.4D0.ANR", observationCount)
	if err != nil {
		return MarketContext{}, err
	}
	labels := map[string]string{"IT": "Italy annual inflation", "U2": "Euro area annual inflation"}
	latest := make(map[string]Metric, len(labels))
	result := MarketContext{Observations: make([]Observation, 0, len(records))}
	for _, row := range records {
		label, ok := labels[row["REF_AREA"]]
		if !ok || row["OBS_VALUE"] == "" {
			continue
		}
		value, err := row.number()
		if err != nil {
			return MarketContext{}, err
		}
		code := "HICP_" + row["REF_AREA"]
		metric := Metric{Code: code, Label: label, Category: "inflation", Value: value, Unit: "%", ObservedOn: row["TIME_PERIOD"], SourceURL: inflationSource}
		result.Observations = append(result.Observations, Observation{Code: code, ObservedOn: metric.ObservedOn, Value: value})
		if current, ok := latest[row["REF_AREA"]]; !ok || metric.ObservedOn > current.ObservedOn {
			latest[row["REF_AREA"]] = metric
		}
	}
	for _, area := range []string{"IT", "U2"} {
		metric, ok := latest[area]
		if !ok {
			return MarketContext{}, errors.New("ECB inflation response is incomplete")
		}
		result.Metrics = append(result.Metrics, metric)
	}
	sort.Slice(result.Observations, func(i, j int) bool {
		if result.Observations[i].ObservedOn == result.Observations[j].ObservedOn {
			return result.Observations[i].Code < result.Observations[j].Code
		}
		return result.Observations[i].ObservedOn < result.Observations[j].ObservedOn
	})
	return result, nil
}
