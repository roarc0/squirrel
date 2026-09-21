package justetf

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"time"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

func (c *Client) FetchPerformance(ctx context.Context, isin string) ([]portfolio.PerformancePoint, error) {
	if err := c.waitForChart(ctx); err != nil {
		return nil, err
	}
	httpClient := newHTTPClient(c.timeout)
	chartURL := c.baseURL + "/api/etfs/" + url.PathEscape(isin) + "/performance-chart?valuesType=RELATIVE_CHANGE&currency=EUR&locale=en&reduceData=false&includeDividends=true"

	parsedURL, err := url.Parse(chartURL)
	if err != nil {
		return nil, err
	}

	// Warm request: establishes the XSRF-TOKEN cookie (response is always 400 on first hit).
	if warmReq, err2 := http.NewRequestWithContext(ctx, http.MethodGet, chartURL, nil); err2 == nil {
		requestHeaders(warmReq)
		if warmResp, err2 := httpClient.Do(warmReq); err2 == nil {
			io.Copy(io.Discard, warmResp.Body) //nolint:errcheck
			warmResp.Body.Close()
		}
	}

	// Read XSRF token planted by the warm request.
	var xsrfToken string
	for _, cookie := range httpClient.Jar.Cookies(parsedURL) {
		if cookie.Name == "XSRF-TOKEN" {
			xsrfToken = cookie.Value
			break
		}
	}

	// Actual request — cookie jar sends XSRF-TOKEN cookie, header mirrors it.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, chartURL, nil)
	if err != nil {
		return nil, err
	}
	requestHeaders(req)
	if xsrfToken != "" {
		req.Header.Set("X-XSRF-TOKEN", xsrfToken)
	}

	body, err := do(httpClient, req)
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
