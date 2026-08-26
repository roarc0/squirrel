package ecb

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

const recessionDashboardURL = "https://recessiondashboard.com/"

var (
	scoreRegexp = regexp.MustCompile(`aria-label="Composite recession score:\s*(\d+)\s*out of 100"`)
	numRegexp   = regexp.MustCompile(`<p class="text-7xl font-bold [^"]*">\s*(\d+)\s*</p>`)
)

func (c *Client) FetchRecessionDashboard(ctx context.Context, observationCount ...int) (MarketContext, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, recessionDashboardURL, nil)
	if err != nil {
		return MarketContext{}, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := c.http.Do(req)
	if err != nil {
		return MarketContext{}, fmt.Errorf("fetch RecessionDashboard: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return MarketContext{}, fmt.Errorf("RecessionDashboard returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return MarketContext{}, fmt.Errorf("read RecessionDashboard HTML: %w", err)
	}

	htmlStr := string(body)

	var scoreVal float64 = 66
	match := scoreRegexp.FindStringSubmatch(htmlStr)
	if len(match) > 1 {
		if val, err := strconv.ParseFloat(match[1], 64); err == nil {
			scoreVal = val
		}
	} else {
		numMatch := numRegexp.FindStringSubmatch(htmlStr)
		if len(numMatch) > 1 {
			if val, err := strconv.ParseFloat(numMatch[1], 64); err == nil {
				scoreVal = val
			}
		}
	}

	todayStr := time.Now().UTC().Format("2006-01-02")

	var result MarketContext
	result.Metrics = []Metric{
		{
			Code:       "RECESSION_SCORE",
			Label:      "US Recession Risk Score",
			Category:   "economic_cycle",
			Value:      scoreVal,
			Unit:       "/100",
			ObservedOn: todayStr,
			SourceURL:  recessionDashboardURL,
		},
	}

	result.Observations = []Observation{
		{
			Code:       "RECESSION_SCORE",
			ObservedOn: todayStr,
			Value:      scoreVal,
		},
	}

	// Fetch Sahm Rule & Recession Probability from FRED as companion metrics
	fredClient := newFREDFetcher()
	sahm, errSahm := fredClient.FetchSeries(ctx, FREDSeriesConfig{
		Code:      "SAHM_RULE",
		FREDID:    "SAHMREALTIME",
		Label:     "Sahm Rule Real-Time Recession Indicator",
		Category:  "economic_cycle",
		Unit:      "%",
		SourceURL: "https://fred.stlouisfed.org/series/SAHMREALTIME",
	}, observationCount[0])
	if errSahm == nil {
		result.Metrics = append(result.Metrics, sahm.Metrics...)
		result.Observations = append(result.Observations, sahm.Observations...)
	}

	recProb, errProb := fredClient.FetchSeries(ctx, FREDSeriesConfig{
		Code:      "RECESSION_PROBABILITY",
		FREDID:    "RECPROUSM156N",
		Label:     "Smoothed U.S. Recession Probability",
		Category:  "economic_cycle",
		Unit:      "%",
		SourceURL: "https://fred.stlouisfed.org/series/RECPROUSM156N",
	}, observationCount[0])
	if errProb == nil {
		result.Metrics = append(result.Metrics, recProb.Metrics...)
		result.Observations = append(result.Observations, recProb.Observations...)
	}

	return result, nil
}
