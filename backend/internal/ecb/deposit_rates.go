package ecb

import (
	"context"
	"errors"
)

const depositRatesSource = "https://data.ecb.europa.eu/data/datasets/MIR"

func (c *Client) FetchDepositRates(ctx context.Context, observationCount ...int) (MarketContext, error) {
	count := 1
	if len(observationCount) > 0 && observationCount[0] > 0 {
		count = observationCount[0]
	}
	records, err := c.observations(ctx, "MIR", "M.IT.B.L21+L22.A+F.R.A.2250.EUR.N", count)
	if err != nil {
		return MarketContext{}, err
	}
	labels := map[string]string{
		"L21.A": "Italy household overnight deposits",
		"L22.F": "Italy household term deposits up to 1 year",
	}
	latest := make(map[string]Metric, len(labels))
	result := MarketContext{Observations: make([]Observation, 0, len(records))}
	for _, row := range records {
		key := row["BS_ITEM"] + "." + row["MATURITY_NOT_IRATE"]
		label, ok := labels[key]
		if !ok || row["OBS_VALUE"] == "" {
			continue
		}
		value, err := row.number()
		if err != nil {
			return MarketContext{}, err
		}
		code := "MIR_" + key
		result.Observations = append(result.Observations, Observation{Code: code, ObservedOn: row["TIME_PERIOD"], Value: value})
		if current, ok := latest[key]; !ok || row["TIME_PERIOD"] > current.ObservedOn {
			latest[key] = Metric{Code: code, Label: label, Category: "cash_benchmarks", Value: value, Unit: "%", ObservedOn: row["TIME_PERIOD"], SourceURL: depositRatesSource}
		}
	}
	for _, key := range []string{"L21.A", "L22.F"} {
		metric, ok := latest[key]
		if !ok {
			return MarketContext{}, errors.New("ECB deposit-rate response is incomplete")
		}
		result.Metrics = append(result.Metrics, metric)
	}
	return result, nil
}

