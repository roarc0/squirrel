package ecb

import (
	"context"
	"fmt"
)

const estrSource = "https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_short-term_rate/html/eurostr_overview.en.html"

func (c *Client) FetchESTR(ctx context.Context) ([]Metric, error) {
	records, err := c.latest(ctx, "EST", "")
	if err != nil {
		return nil, err
	}
	series := []struct {
		code  string
		label string
	}{
		{"EU000A2X2A25.WT", "€STR overnight"},
		{"EU000A2QQF24.CR", "€STR compounded 1 month"},
		{"EU000A2QQF32.CR", "€STR compounded 3 months"},
	}
	values := make(map[string]Metric, len(series))
	for _, row := range records {
		code := row["BENCHMARK_ITEM"] + "." + row["DATA_TYPE_EST"]
		value, err := row.number()
		if err != nil {
			return nil, err
		}
		values[code] = Metric{Code: code, Category: "money_market", Value: value, Unit: "%", ObservedOn: row["TIME_PERIOD"], SourceURL: estrSource}
	}
	metrics := make([]Metric, 0, len(series))
	for _, item := range series {
		metric, ok := values[item.code]
		if !ok {
			return nil, fmt.Errorf("ECB €STR response is missing %s", item.code)
		}
		metric.Label = item.label
		metrics = append(metrics, metric)
	}
	return metrics, nil
}
