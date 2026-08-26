package ecb

import (
	"context"
	"errors"
)

const depositRatesSource = "https://data.ecb.europa.eu/data/datasets/MIR"

func (c *Client) FetchDepositRates(ctx context.Context) ([]Metric, error) {
	records, err := c.latest(ctx, "MIR", "M.IT.B.L21+L22.A+F.R.A.2250.EUR.N")
	if err != nil {
		return nil, err
	}
	labels := map[string]string{
		"L21.A": "Italy household overnight deposits",
		"L22.F": "Italy household term deposits up to 1 year",
	}
	metrics := make([]Metric, 0, len(labels))
	for _, row := range records {
		code := row["BS_ITEM"] + "." + row["MATURITY_NOT_IRATE"]
		label, ok := labels[code]
		if !ok {
			continue
		}
		value, err := row.number()
		if err != nil {
			return nil, err
		}
		metrics = append(metrics, Metric{Code: "MIR_" + code, Label: label, Category: "cash_benchmarks", Value: value, Unit: "%", ObservedOn: row["TIME_PERIOD"], SourceURL: depositRatesSource})
	}
	if len(metrics) != len(labels) {
		return nil, errors.New("ECB deposit-rate response is incomplete")
	}
	return metrics, nil
}
