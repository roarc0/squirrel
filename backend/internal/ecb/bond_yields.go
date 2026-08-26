package ecb

import (
	"context"
	"errors"
)

const bondYieldsSource = "https://data.ecb.europa.eu/data/data-categories/financial-markets-and-interest-rates/interest-rate-statistics-convergence-purposes/long-term-interest-rates"

func (c *Client) FetchSovereignYields(ctx context.Context) ([]Metric, error) {
	records, err := c.latest(ctx, "IRS", "M.IT+DE.L.L40.CI.0000.EUR.N.Z")
	if err != nil {
		return nil, err
	}
	labels := map[string]string{"IT": "Italy 10-year government yield", "DE": "Germany 10-year government yield"}
	byArea := make(map[string]Metric, 2)
	for _, row := range records {
		label, ok := labels[row["REF_AREA"]]
		if !ok {
			continue
		}
		value, err := row.number()
		if err != nil {
			return nil, err
		}
		byArea[row["REF_AREA"]] = Metric{Code: "YIELD_10Y_" + row["REF_AREA"], Label: label, Category: "sovereign_bonds", Value: value, Unit: "%", ObservedOn: row["TIME_PERIOD"], SourceURL: bondYieldsSource}
	}
	italy, italyOK := byArea["IT"]
	germany, germanyOK := byArea["DE"]
	if !italyOK || !germanyOK || italy.ObservedOn != germany.ObservedOn {
		return nil, errors.New("ECB sovereign-yield response is incomplete")
	}
	spread := Metric{Code: "SPREAD_IT_DE_10Y", Label: "Italy–Germany 10-year spread", Category: "sovereign_bonds", Value: (italy.Value - germany.Value) * 100, Unit: "bps", ObservedOn: italy.ObservedOn, SourceURL: bondYieldsSource}
	return []Metric{italy, germany, spread}, nil
}
