package ecb

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type FREDFetcher struct {
	http *http.Client
	sem  chan struct{}
}

func newFREDFetcher() *FREDFetcher {
	tr := &http.Transport{
		DisableKeepAlives: true,
		TLSNextProto:      make(map[string]func(authority string, c *tls.Conn) http.RoundTripper),
	}
	return &FREDFetcher{
		http: &http.Client{
			Transport: tr,
			Timeout:   8 * time.Second,
		},
		sem: make(chan struct{}, 4), // Cap at 4 concurrent requests
	}
}

type FREDSeriesConfig struct {
	Code      string
	FREDID    string
	Label     string
	Category  string
	Unit      string
	SourceURL string
}

func (f *FREDFetcher) FetchSeries(ctx context.Context, cfg FREDSeriesConfig, observationCount int) (MarketContext, error) {
	select {
	case f.sem <- struct{}{}:
		defer func() { <-f.sem }()
	case <-ctx.Done():
		return MarketContext{}, ctx.Err()
	}

	url := fmt.Sprintf("https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s", cfg.FREDID)

	var resp *http.Response
	var err error

	for attempt := 1; attempt <= 2; attempt++ {
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if reqErr != nil {
			return MarketContext{}, reqErr
		}
		req.Header.Set("User-Agent", "curl/8.7.1")
		req.Header.Set("Accept", "*/*")

		resp, err = f.http.Do(req)
		if err == nil && resp.StatusCode == http.StatusOK {
			break
		}
		if resp != nil {
			resp.Body.Close()
		}
		if attempt < 2 {
			time.Sleep(100 * time.Millisecond)
		}
	}

	if err != nil {
		return MarketContext{}, fmt.Errorf("fetch FRED series %s: %w", cfg.FREDID, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return MarketContext{}, fmt.Errorf("FRED series %s returned HTTP %d", cfg.FREDID, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return MarketContext{}, fmt.Errorf("read FRED series %s: %w", cfg.FREDID, err)
	}

	rows, err := csv.NewReader(bytes.NewReader(body)).ReadAll()
	if err != nil || len(rows) < 2 {
		return MarketContext{}, fmt.Errorf("FRED series %s returned invalid CSV", cfg.FREDID)
	}

	type obsRow struct {
		date  string
		value float64
	}
	var valid []obsRow
	for _, row := range rows[1:] {
		if len(row) < 2 {
			continue
		}
		valStr := strings.TrimSpace(row[1])
		if valStr == "" || valStr == "." {
			continue
		}
		val, err := strconv.ParseFloat(valStr, 64)
		if err != nil {
			continue
		}
		valid = append(valid, obsRow{date: strings.TrimSpace(row[0]), value: val})
	}

	if len(valid) == 0 {
		return MarketContext{}, fmt.Errorf("FRED series %s has no valid observations", cfg.FREDID)
	}

	startIdx := 0
	if observationCount > 0 && len(valid) > observationCount {
		startIdx = len(valid) - observationCount
	}
	subset := valid[startIdx:]

	step := 1
	if len(subset) > 250 {
		step = len(subset) / 250
	}

	result := MarketContext{
		Observations: make([]Observation, 0, len(subset)/step+1),
	}

	for i := 0; i < len(subset); i += step {
		result.Observations = append(result.Observations, Observation{
			Code:       cfg.Code,
			ObservedOn: subset[i].date,
			Value:      subset[i].value,
		})
	}
	if len(result.Observations) == 0 || result.Observations[len(result.Observations)-1].ObservedOn != subset[len(subset)-1].date {
		result.Observations = append(result.Observations, Observation{
			Code:       cfg.Code,
			ObservedOn: subset[len(subset)-1].date,
			Value:      subset[len(subset)-1].value,
		})
	}

	latest := subset[len(subset)-1]
	sourceURL := cfg.SourceURL
	if sourceURL == "" {
		sourceURL = fmt.Sprintf("https://fred.stlouisfed.org/series/%s", cfg.FREDID)
	}

	result.Metrics = []Metric{
		{
			Code:       cfg.Code,
			Label:      cfg.Label,
			Category:   cfg.Category,
			Value:      latest.value,
			Unit:       cfg.Unit,
			ObservedOn: latest.date,
			SourceURL:  sourceURL,
		},
	}

	return result, nil
}
