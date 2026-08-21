package justetf

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html"

	"loot/internal/portfolio"
)

const (
	defaultBaseURL = "https://www.justetf.com"
	maxResponse    = 4 << 20
)

var (
	ErrInvalidQuery = errors.New("invalid ETF query")
	ErrNotFound     = errors.New("ETF not found")
	ErrRateLimited  = errors.New("justETF temporarily blocked requests")
	fetchURLPattern = regexp.MustCompile(`"fetchCallbackUrl"\s*:\s*"([^"]+)"`)
	etfsPattern     = regexp.MustCompile(`"etfsParams"\s*:\s*"([^"]+)"`)
	fetchVarPattern = regexp.MustCompile(`var\s+fetchCallbackUrl\s*=\s*'([^']+)'`)
	etfsVarPattern  = regexp.MustCompile(`var\s+etfsParams\s*=\s*'([^']+)'`)
	numberPattern   = regexp.MustCompile(`[0-9]+(?:[,.][0-9]+)*`)
)

type Client struct {
	baseURL         string
	timeout         time.Duration
	profileInterval time.Duration
	profileMu       sync.Mutex
	nextProfile     time.Time
}

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

func New(profileInterval ...time.Duration) *Client {
	interval := 10 * time.Second
	if len(profileInterval) > 0 {
		interval = profileInterval[0]
	}
	return &Client{baseURL: defaultBaseURL, timeout: 20 * time.Second, profileInterval: interval}
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

func (c *Client) Catalog(ctx context.Context, limit int) ([]portfolio.Instrument, int, error) {
	return c.catalog(ctx, limit, true)
}

func (c *Client) CatalogCandidates(ctx context.Context, limit int) ([]portfolio.Instrument, int, error) {
	return c.catalog(ctx, limit, false)
}

func (c *Client) catalog(ctx context.Context, limit int, requireUCITSLabel bool) ([]portfolio.Instrument, int, error) {
	if limit < 1 || limit > 4_000 {
		return nil, 0, errors.New("catalog limit must be between 1 and 4000")
	}
	client := newHTTPClient(c.timeout)
	searchURL := c.baseURL + "/en/search.html?search=ETFS"
	var results []portfolio.Instrument
	total := 0
	for start := 0; start < limit; start += 500 {
		rows, available, err := c.searchRows(ctx, client, searchURL, "en/search.html?search=ETFS", start, min(500, limit-start))
		if err != nil {
			return nil, total, err
		}
		total = available
		results = append(results, c.catalogETFs(rows, requireUCITSLabel)...)
		if len(rows) == 0 || start+len(rows) >= available {
			break
		}
	}
	return results, total, nil
}

func (c *Client) catalogETFs(rows []searchRow, requireUCITSLabel bool) []portfolio.Instrument {
	var results []portfolio.Instrument
	now := time.Now().UTC().Format(time.RFC3339)
	for _, row := range rows {
		name := strings.ToUpper(row.Name)
		labelledUCITS := strings.Contains(name, "UCITS") && strings.Contains(name, "ETF")
		if (requireUCITSLabel && !labelledUCITS) || !portfolio.ValidISIN(row.ISIN) {
			continue
		}
		ter, terErr := percentBPS(row.TER)
		size, sizeErr := millions(row.FundSize)
		started, dateErr := profileDate(row.InceptionDate)
		if terErr != nil || sizeErr != nil || dateErr != nil {
			continue
		}
		etf := portfolio.Instrument{
			ISIN: strings.ToUpper(row.ISIN), Name: row.Name, Ticker: strings.ToUpper(row.Ticker),
			InstrumentType: portfolio.InferInstrumentType(row.Name),
			DataStatus:     portfolio.InstrumentStatusCatalog,
			CurrencyHedged: strings.Contains(strings.ToLower(row.FundCurrency), "hedged"),
			Distribution:   distribution(row.DistributionPolicy), Replication: replication(row.ReplicationMethod),
			Domicile: countryCode(row.DomicileCountry), FundCurrency: currencyCode(row.FundCurrency),
			TERBPS: ter, FundSizeMillion: size, InceptionDate: started, UCITS: labelledUCITS,
			SourceURL:   c.baseURL + "/en/etf-profile.html?isin=" + url.QueryEscape(row.ISIN),
			RefreshedAt: now,
		}
		portfolio.ClassifyInstrument(&etf)
		if portfolio.ValidateInstrument(etf) == nil {
			results = append(results, etf)
		}
	}
	return results
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

func newHTTPClient(timeout time.Duration) *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Timeout: timeout, Jar: jar}
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

func (c *Client) fetchProfile(ctx context.Context, client *http.Client, isin string) (portfolio.Instrument, error) {
	if err := c.waitForProfile(ctx); err != nil {
		return portfolio.Instrument{}, err
	}
	profileURL := c.baseURL + "/en/etf-profile.html?isin=" + url.QueryEscape(isin)
	body, err := get(ctx, client, profileURL)
	if err != nil {
		if errors.Is(err, ErrRateLimited) {
			c.backOffProfiles(2 * time.Minute)
		}
		return portfolio.Instrument{}, fmt.Errorf("open justETF profile: %w", err)
	}
	doc, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return portfolio.Instrument{}, fmt.Errorf("parse justETF profile: %w", err)
	}
	value := func(id string) string { return testIDText(doc, id) }
	name := value("etf-profile-header_etf-name")
	if name == "" {
		return portfolio.Instrument{}, fmt.Errorf("%w: %s", ErrNotFound, isin)
	}
	ter, err := percentBPS(value("tl_etf-basics_value_ter"))
	if err != nil {
		return portfolio.Instrument{}, fmt.Errorf("parse justETF TER: %w", err)
	}
	size, err := millions(value("etf-profile-header_fund-size-value-wrapper"))
	if err != nil {
		return portfolio.Instrument{}, fmt.Errorf("parse justETF fund size: %w", err)
	}
	started, err := profileDate(value("tl_etf-basics_value_launch-date"))
	if err != nil {
		return portfolio.Instrument{}, fmt.Errorf("parse justETF inception date: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	etf := portfolio.Instrument{
		ISIN:            strings.ToUpper(value("etf-profile-header_isin-value")),
		Name:            name,
		Ticker:          strings.ToUpper(value("etf-profile-header_identifier-value-ticker")),
		InstrumentType:  portfolio.InferInstrumentType(name),
		Provider:        value("tl_etf-basics_value_fund-provider"),
		IndexName:       value("tl_etf-basics_value_index-name"),
		InvestmentFocus: value("tl_etf-basics_value_investment-focus"),
		CurrencyHedged:  strings.EqualFold(value("tl_etf-basics_value_currency-hedge"), "Currency hedged"),
		DataStatus:      portfolio.InstrumentStatusEnriched,
		Distribution:    distribution(value("tl_etf-basics_value_distribution-policy")),
		Replication:     replication(value("tl_etf-basics_value_replication") + " " + value("tl_etf-basics_value_replication-method")),
		Domicile:        countryCode(value("tl_etf-basics_value_domicile-country")),
		FundCurrency:    strings.ToUpper(value("tl_etf-basics_value_fund-currency")),
		TERBPS:          ter,
		FundSizeMillion: size,
		InceptionDate:   started,
		UCITS:           strings.EqualFold(tableValue(doc, "UCITS compliance"), "Yes"),
		SourceURL:       profileURL,
		RefreshedAt:     now,
		EnrichedAt:      now,
	}
	portfolio.ClassifyInstrument(&etf)
	if etf.ISIN != isin {
		return portfolio.Instrument{}, errors.New("justETF returned a different ISIN")
	}
	if err := portfolio.ValidateInstrument(etf); err != nil {
		return portfolio.Instrument{}, fmt.Errorf("justETF returned incomplete ETF data: %w", err)
	}
	return etf, nil
}

func (c *Client) waitForProfile(ctx context.Context) error {
	if c.profileInterval <= 0 {
		return nil
	}
	c.profileMu.Lock()
	now := time.Now()
	start := maxTime(now, c.nextProfile)
	c.nextProfile = start.Add(c.profileInterval)
	c.profileMu.Unlock()
	if !start.After(now) {
		return nil
	}
	timer := time.NewTimer(time.Until(start))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (c *Client) backOffProfiles(delay time.Duration) {
	c.profileMu.Lock()
	defer c.profileMu.Unlock()
	until := time.Now().Add(delay)
	if c.nextProfile.Before(until) {
		c.nextProfile = until
	}
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func get(ctx context.Context, client *http.Client, address string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	requestHeaders(req)
	return do(client, req)
}

func do(client *http.Client, req *http.Request) ([]byte, error) {
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
			return nil, fmt.Errorf("%w (HTTP %d)", ErrRateLimited, resp.StatusCode)
		}
		return nil, fmt.Errorf("justETF returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxResponse {
		return nil, errors.New("justETF response is too large")
	}
	return body, nil
}

func requestHeaders(req *http.Request) {
	req.Header.Set("Accept", "text/html,application/json;q=0.9")
	req.Header.Set("Accept-Language", "en")
	req.Header.Set("User-Agent", "LOOT/0.1 (local personal portfolio)")
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

func testIDText(node *html.Node, id string) string {
	if node.Type == html.ElementNode {
		for _, attr := range node.Attr {
			if attr.Key == "data-testid" && attr.Val == id {
				return nodeText(node)
			}
		}
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if value := testIDText(child, id); value != "" {
			return value
		}
	}
	return ""
}

func nodeText(node *html.Node) string {
	var parts []string
	var walk func(*html.Node)
	walk = func(current *html.Node) {
		if current.Type == html.TextNode {
			parts = append(parts, current.Data)
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return strings.Join(strings.Fields(strings.Join(parts, " ")), " ")
}

func tableValue(node *html.Node, label string) string {
	if node.Type == html.ElementNode && node.Data == "tr" {
		var cells []*html.Node
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			if child.Type == html.ElementNode && (child.Data == "td" || child.Data == "th") {
				cells = append(cells, child)
			}
		}
		if len(cells) >= 2 && strings.EqualFold(nodeText(cells[0]), label) {
			return nodeText(cells[1])
		}
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if value := tableValue(child, label); value != "" {
			return value
		}
	}
	return ""
}

func percentBPS(value string) (int64, error) {
	match := numberPattern.FindString(value)
	if match == "" {
		return 0, errors.New("value is missing")
	}
	number, err := strconv.ParseFloat(strings.ReplaceAll(match, ",", "."), 64)
	return int64(math.Round(number * 100)), err
}

func millions(value string) (int64, error) {
	match := numberPattern.FindString(value)
	if match == "" {
		return 0, errors.New("value is missing")
	}
	number, err := strconv.ParseFloat(strings.ReplaceAll(match, ",", ""), 64)
	return int64(math.Round(number)), err
}

func profileDate(value string) (string, error) {
	for _, format := range []string{"2 January 2006", "02.01.06"} {
		if parsed, err := time.Parse(format, value); err == nil {
			return parsed.Format(time.DateOnly), nil
		}
	}
	return "", errors.New("unsupported date")
}

func distribution(value string) string {
	if strings.Contains(strings.ToLower(value), "accum") {
		return portfolio.DistributionAccumulating
	}
	if strings.Contains(strings.ToLower(value), "distribut") {
		return portfolio.DistributionDistributing
	}
	return ""
}

func replication(value string) string {
	value = strings.ToLower(value)
	if strings.Contains(value, "synthetic") || strings.Contains(value, "swap") {
		return portfolio.ReplicationSynthetic
	}
	if strings.Contains(value, "sampling") {
		return portfolio.ReplicationSampling
	}
	if strings.Contains(value, "physical") || strings.Contains(value, "full") {
		return portfolio.ReplicationPhysicalFull
	}
	return ""
}

func countryCode(value string) string {
	return map[string]string{
		"denmark": "DK", "france": "FR", "germany": "DE", "ireland": "IE", "jersey": "JE",
		"luxembourg": "LU", "netherlands": "NL", "sweden": "SE", "switzerland": "CH",
		"united kingdom": "GB", "united states": "US",
	}[strings.ToLower(strings.TrimSpace(value))]
}

func currencyCode(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if len(value) >= 3 {
		return value[:3]
	}
	return value
}
