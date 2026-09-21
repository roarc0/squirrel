package justetf

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"time"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

func (c *Client) FetchPerformance(ctx context.Context, isin string) ([]portfolio.PerformancePoint, error) {
	if err := c.waitForChart(ctx); err != nil {
		return nil, err
	}
	client := newHTTPClient(c.timeout)
	chartURL := c.baseURL + "/api/etfs/" + url.PathEscape(isin) + "/performance-chart?valuesType=RELATIVE_CHANGE&currency=EUR&reduceData=false&includeDividends=true"
	body, err := get(ctx, client, chartURL)
	if err != nil {
		if errors.Is(err, ErrRateLimited) {
			c.backOffChart(2 * time.Minute)
		}
		return nil, fmt.Errorf("fetch justETF performance chart: %w", err)
	}

	var resp struct {
		Series []struct {
			Date  string `json:"date"`
			Value struct {
				Raw float64 `json:"raw"`
			} `json:"value"`
		} `json:"series"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("parse justETF performance chart: %w", err)
	}

	points := make([]portfolio.PerformancePoint, 0, len(resp.Series))
	for _, s := range resp.Series {
		points = append(points, portfolio.PerformancePoint{
			Date:      s.Date,
			ChangeBPS: int64(math.Round(s.Value.Raw * 100)),
		})
	}
	return points, nil
}
