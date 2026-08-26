package ecb

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

func (c *Client) FetchMarketContext(ctx context.Context, inflationObservationCount int) (MarketContext, error) {
	collectors := []struct {
		name string
		get  func(context.Context) (MarketContext, error)
	}{
		{"€STR", func(ctx context.Context) (MarketContext, error) {
			metrics, err := c.FetchESTR(ctx)
			return MarketContext{Metrics: metrics}, err
		}},
		{"inflation", func(ctx context.Context) (MarketContext, error) {
			return c.FetchInflation(ctx, inflationObservationCount)
		}},
		{"deposit rates", func(ctx context.Context) (MarketContext, error) {
			metrics, err := c.FetchDepositRates(ctx)
			return MarketContext{Metrics: metrics}, err
		}},
		{"sovereign yields", func(ctx context.Context) (MarketContext, error) {
			metrics, err := c.FetchSovereignYields(ctx)
			return MarketContext{Metrics: metrics}, err
		}},
	}
	results := make([]MarketContext, len(collectors))
	errs := make([]error, len(collectors))
	var group sync.WaitGroup
	for i, collector := range collectors {
		group.Go(func() {
			results[i], errs[i] = collector.get(ctx)
		})
	}
	group.Wait()

	var result MarketContext
	for i, collected := range results {
		result.Metrics = append(result.Metrics, collected.Metrics...)
		result.Observations = append(result.Observations, collected.Observations...)
		if errs[i] != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", collectors[i].name, errs[i]))
		}
	}
	if len(result.Metrics) == 0 {
		return result, errors.Join(errs...)
	}
	return result, nil
}
