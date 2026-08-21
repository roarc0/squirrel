package justetf

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"loot/backend/internal/portfolio"
)

var (
	fetchURLPattern = regexp.MustCompile(`"fetchCallbackUrl"\s*:\s*"([^"]+)"`)
	etfsPattern     = regexp.MustCompile(`"etfsParams"\s*:\s*"([^"]+)"`)
	fetchVarPattern = regexp.MustCompile(`var\s+fetchCallbackUrl\s*=\s*'([^']+)'`)
	etfsVarPattern  = regexp.MustCompile(`var\s+etfsParams\s*=\s*'([^']+)'`)
)

type searchRow struct {
	ISIN               string `json:"isin"`
	Name               string `json:"name"`
	Ticker             string `json:"ticker"`
	DistributionPolicy string `json:"distributionPolicy"`
	ReplicationMethod  string `json:"replicationMethod"`
	DomicileCountry    string `json:"domicileCountry"`
	FundCurrency       string `json:"fundCurrency"`
	TER                string `json:"ter"`
	FundSize           string `json:"fundSize"`
	InceptionDate      string `json:"inceptionDate"`
}

func (c *Client) Search(ctx context.Context, query string) ([]portfolio.Instrument, error) {
	query = strings.TrimSpace(query)
	if query == "" || len(query) > 80 || strings.ContainsAny(query, "\r\n\x00") {
		return nil, fmt.Errorf("%w: enter a search up to 80 characters", ErrInvalidQuery)
	}
	searchURL := c.baseURL + "/en/search.html?query=" + url.QueryEscape(query)
	rows, _, err := c.searchRows(ctx, newHTTPClient(c.timeout), searchURL, "en/search.html?query="+url.QueryEscape(query), 0, 20)
	if err != nil {
		return nil, err
	}
	return c.catalogETFs(rows, false), nil
}

func (c *Client) Lookup(ctx context.Context, query string) (portfolio.Instrument, error) {
	query = strings.ToUpper(strings.TrimSpace(query))
	if err := validateQuery(query); err != nil {
		return portfolio.Instrument{}, err
	}

	httpClient := newHTTPClient(c.timeout)
	isin := query
	if !portfolio.ValidISIN(isin) {
		var err error
		isin, err = c.resolveISIN(ctx, httpClient, query)
		if err != nil {
			return portfolio.Instrument{}, err
		}
	}
	return c.fetchProfile(ctx, httpClient, isin)
}

func validateQuery(query string) error {
	if query == "" || len(query) > 20 {
		return fmt.Errorf("%w: enter a ticker or ISIN", ErrInvalidQuery)
	}
	for _, char := range query {
		if (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '.' && char != '-' {
			return fmt.Errorf("%w: use letters, numbers, dots, or hyphens", ErrInvalidQuery)
		}
	}
	if len(query) == 12 && query[0] >= 'A' && query[0] <= 'Z' && query[1] >= 'A' && query[1] <= 'Z' && !portfolio.ValidISIN(query) {
		return fmt.Errorf("%w: ISIN checksum is invalid", ErrInvalidQuery)
	}
	return nil
}

func (c *Client) resolveISIN(ctx context.Context, client *http.Client, ticker string) (string, error) {
	searchURL := c.baseURL + "/en/search.html?query=" + url.QueryEscape(ticker)
	rows, _, err := c.searchRows(ctx, client, searchURL, "en/search.html?query="+url.QueryEscape(ticker), 0, 10)
	if err != nil {
		return "", err
	}
	for _, item := range rows {
		if strings.EqualFold(item.Ticker, ticker) && portfolio.ValidISIN(item.ISIN) {
			return strings.ToUpper(item.ISIN), nil
		}
	}
	return "", fmt.Errorf("%w: %s", ErrNotFound, ticker)
}

func (c *Client) searchRows(ctx context.Context, client *http.Client, searchURL, wicketBaseURL string, start, limit int) ([]searchRow, int, error) {
	body, err := get(ctx, client, searchURL)
	if err != nil {
		return nil, 0, fmt.Errorf("open justETF search: %w", err)
	}
	callback, ok := scriptValue(body, fetchURLPattern, fetchVarPattern)
	if !ok {
		return nil, 0, errors.New("justETF search format changed")
	}
	etfsParams, ok := scriptValue(body, etfsPattern, etfsVarPattern)
	if !ok {
		return nil, 0, errors.New("justETF search format changed")
	}
	base, err := url.Parse(c.baseURL)
	if err != nil {
		return nil, 0, err
	}
	relative, err := url.Parse(callback)
	if err != nil {
		return nil, 0, fmt.Errorf("parse justETF search callback: %w", err)
	}

	form := url.Values{
		"draw":            {"1"},
		"start":           {strconv.Itoa(start)},
		"length":          {strconv.Itoa(limit)},
		"lang":            {"en"},
		"country":         {"DE"},
		"defaultCurrency": {"EUR"},
		"universeType":    {"private"},
		"etfsParams":      {etfsParams},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base.ResolveReference(relative).String(), strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, err
	}
	requestHeaders(req)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Referer", searchURL)
	req.Header.Set("Wicket-Ajax", "true")
	req.Header.Set("Wicket-Ajax-BaseURL", wicketBaseURL)
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	body, err = do(client, req)
	if err != nil {
		return nil, 0, fmt.Errorf("query justETF search: %w", err)
	}
	var result struct {
		Data            []searchRow `json:"data"`
		RecordsFiltered int         `json:"recordsFiltered"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, 0, errors.New("justETF search format changed")
	}
	return result.Data, result.RecordsFiltered, nil
}

func scriptValue(body []byte, patterns ...*regexp.Regexp) (string, bool) {
	for _, pattern := range patterns {
		match := pattern.FindSubmatch(body)
		if len(match) != 2 {
			continue
		}
		value, err := strconv.Unquote(`"` + string(match[1]) + `"`)
		return value, err == nil
	}
	return "", false
}
