package ecb

import (
	"context"
	"fmt"
	"math"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

const policyRatesKey = "B.U2.EUR.4F.KR.DFR+MRR_FR+MLFR.LEV"

var policyRateSeries = []struct {
	code  string
	label string
}{
	{"DFR", "ECB Deposit Facility"},
	{"MRR_FR", "ECB Main Refinancing Operations"},
	{"MLFR", "ECB Marginal Lending Facility"},
}

func (c *Client) FetchPolicyRates(ctx context.Context) ([]portfolio.ReferenceRate, error) {
	records, err := c.latest(ctx, "FM", policyRatesKey)
	if err != nil {
		return nil, err
	}
	values := make(map[string]portfolio.ReferenceRate, len(policyRateSeries))
	for _, row := range records {
		code := row["PROVIDER_FM_ID"]
		value, err := row.number()
		if err != nil {
			return nil, err
		}
		values[code] = portfolio.ReferenceRate{Code: code, RateBPS: int64(math.Round(value * 100)), ObservedOn: row["TIME_PERIOD"]}
	}
	rates := make([]portfolio.ReferenceRate, 0, len(policyRateSeries))
	for _, item := range policyRateSeries {
		rate, ok := values[item.code]
		if !ok {
			return nil, fmt.Errorf("ECB policy-rate response is missing %s", item.code)
		}
		rate.Label = item.label
		rates = append(rates, rate)
	}
	return rates, nil
}
