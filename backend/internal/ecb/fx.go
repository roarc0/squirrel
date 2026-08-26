package ecb

import (
	"context"
)

const fxSource = "https://data.ecb.europa.eu/data/data-categories/financial-markets-and-interest-rates/exchange-rates"

func (c *Client) FetchEURUSD(ctx context.Context, observationCount ...int) (MarketContext, error) {
	count := 30
	if len(observationCount) > 0 && observationCount[0] > 0 {
		count = observationCount[0]
	}

	records, err := c.observations(ctx, "EXR", "D.USD.EUR.SP00.A", count)
	if err != nil {
		return MarketContext{}, err
	}

	var result MarketContext
	var latestPeriod string
	var latestVal float64

	for _, row := range records {
		val, err := row.number()
		if err != nil || val <= 0 {
			continue
		}
		period := row["TIME_PERIOD"]
		result.Observations = append(result.Observations, Observation{
			Code:       "FX_EURUSD",
			ObservedOn: period,
			Value:      val,
		})
		if period > latestPeriod {
			latestPeriod = period
			latestVal = val
		}
	}

	if latestPeriod != "" {
		result.Metrics = append(result.Metrics, Metric{
			Code:       "FX_EURUSD",
			Label:      "EUR / USD Exchange Rate",
			Category:   "commodities_fx",
			Value:      latestVal,
			Unit:       "USD",
			ObservedOn: latestPeriod,
			SourceURL:  fxSource,
		})
	}

	return result, nil
}
