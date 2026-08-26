package ecb

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"
)

type EquityFetcher struct {
	http *http.Client
}

func newEquityFetcher() *EquityFetcher {
	return &EquityFetcher{
		http: &http.Client{Timeout: 10 * time.Second},
	}
}

type EquityIndexConfig struct {
	Code           string
	Symbol         string
	FallbackSymbol string
	Label          string
	Category       string
	Unit           string
	SourceURL      string
}

type yahooChartResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Symbol        string  `json:"symbol"`
				RegularMarket float64 `json:"regularMarketPrice"`
			} `json:"meta"`
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Close []interface{} `json:"close"`
				} `json:"quote"`
			} `json:"indicators"`
		} `json:"result"`
	} `json:"chart"`
}

func (e *EquityFetcher) FetchIndexTrend(ctx context.Context, cfg EquityIndexConfig) (MarketContext, error) {
	mc, err := e.fetchSymbol(ctx, cfg.Symbol, cfg)
	if err == nil {
		return mc, nil
	}

	if cfg.FallbackSymbol != "" {
		return e.fetchSymbol(ctx, cfg.FallbackSymbol, cfg)
	}

	return MarketContext{}, err
}

func (e *EquityFetcher) fetchSymbol(ctx context.Context, symbol string, cfg EquityIndexConfig) (MarketContext, error) {
	url := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&range=5y", symbol)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return MarketContext{}, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := e.http.Do(req)
	if err != nil {
		return MarketContext{}, fmt.Errorf("fetch equity index %s: %w", symbol, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return MarketContext{}, fmt.Errorf("equity index %s returned HTTP %d", symbol, resp.StatusCode)
	}

	var data yahooChartResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return MarketContext{}, fmt.Errorf("decode equity index %s JSON: %w", symbol, err)
	}

	if len(data.Chart.Result) == 0 {
		return MarketContext{}, fmt.Errorf("no chart result for %s", symbol)
	}

	res := data.Chart.Result[0]
	timestamps := res.Timestamp
	if len(timestamps) == 0 || len(res.Indicators.Quote) == 0 {
		return MarketContext{}, fmt.Errorf("empty quote data for %s", symbol)
	}

	closesRaw := res.Indicators.Quote[0].Close
	type point struct {
		date  string
		value float64
	}
	var points []point
	for i, ts := range timestamps {
		if i >= len(closesRaw) || closesRaw[i] == nil {
			continue
		}
		val, ok := closesRaw[i].(float64)
		if !ok || val <= 0 {
			continue
		}
		dateStr := time.Unix(ts, 0).UTC().Format("2006-01-02")
		points = append(points, point{date: dateStr, value: val})
	}

	if len(points) == 0 {
		return MarketContext{}, fmt.Errorf("no valid prices for %s", symbol)
	}

	sort.Slice(points, func(i, j int) bool { return points[i].date < points[j].date })

	latest := points[len(points)-1]

	// 1Y Return % using point from ~252 trading days ago
	oneYearAgoIdx := 0
	if len(points) > 252 {
		oneYearAgoIdx = len(points) - 252
	}
	first1Y := points[oneYearAgoIdx]
	change1Y := ((latest.value - first1Y.value) / first1Y.value) * 100

	// 52-week High (past 252 trading days)
	high52w := latest.value
	for i := oneYearAgoIdx; i < len(points); i++ {
		if points[i].value > high52w {
			high52w = points[i].value
		}
	}
	dist52wHigh := ((latest.value - high52w) / high52w) * 100

	// 200-day SMA
	var sma200 float64
	n := 200
	if len(points) < n {
		n = len(points)
	}
	var sum float64
	for i := len(points) - n; i < len(points); i++ {
		sum += points[i].value
	}
	sma200 = sum / float64(n)

	// Downsample up to 250 points for 5-year observation history
	step := 1
	if len(points) > 250 {
		step = len(points) / 250
	}
	var obs []Observation
	for i := 0; i < len(points); i += step {
		obs = append(obs, Observation{
			Code:       cfg.Code,
			ObservedOn: points[i].date,
			Value:      points[i].value,
		})
	}
	if len(obs) == 0 || obs[len(obs)-1].ObservedOn != latest.date {
		obs = append(obs, Observation{
			Code:       cfg.Code,
			ObservedOn: latest.date,
			Value:      latest.value,
		})
	}

	sourceURL := cfg.SourceURL
	if sourceURL == "" {
		sourceURL = fmt.Sprintf("https://finance.yahoo.com/quote/%s", symbol)
	}

	metric := Metric{
		Code:            cfg.Code,
		Label:           cfg.Label,
		Category:        cfg.Category,
		Value:           latest.value,
		Unit:            cfg.Unit,
		ObservedOn:      latest.date,
		SourceURL:       sourceURL,
		Change1Y:        &change1Y,
		Distance52WHigh: &dist52wHigh,
		SMA200:          &sma200,
	}

	return MarketContext{
		Metrics:      []Metric{metric},
		Observations: obs,
	}, nil
}
