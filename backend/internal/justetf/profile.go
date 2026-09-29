package justetf

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

var numberPattern = regexp.MustCompile(`[0-9]+(?:[,.][0-9]+)*`)

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
		name = testIDText(doc, "etf-profile_header_name")
		if name == "" {
			return portfolio.Instrument{}, fmt.Errorf("%w: %s", ErrNotFound, isin)
		}
	}

	// Pull whatever fields are available without failing if secondary metrics are missing
	ter, _ := percentBPS(value("tl_etf-basics_value_ter"))
	if ter < 0 || ter > 1_000 {
		ter = 0
	}

	size, _ := millions(value("etf-profile-header_fund-size-value-wrapper"))
	if size <= 0 {
		size, _ = millions(value("tl_etf-basics_value_fund-size"))
	}
	if size < 0 {
		size = 0
	}

	started, _ := profileDate(value("tl_etf-basics_value_launch-date"))
	if started == "" {
		started, _ = profileDate(tableValue(doc, "Inception/ Listing Date"))
	}

	dist := distribution(value("tl_etf-basics_value_distribution-policy"))
	if dist == "" {
		nameLower := strings.ToLower(name)
		if strings.Contains(nameLower, "dis") || strings.Contains(nameLower, "dist") {
			dist = portfolio.DistributionDistributing
		} else {
			dist = portfolio.DistributionAccumulating
		}
	}

	rep := replication(value("tl_etf-basics_value_replication") + " " + value("tl_etf-basics_value_replication-method"))
	if rep == "" {
		nameLower := strings.ToLower(name)
		if strings.Contains(nameLower, "swap") || strings.Contains(nameLower, "synthetic") {
			rep = portfolio.ReplicationSynthetic
		} else {
			rep = portfolio.ReplicationPhysicalFull
		}
	}

	dom := countryCode(value("tl_etf-basics_value_domicile-country"))
	if dom == "" && len(isin) >= 2 {
		dom = strings.ToUpper(isin[:2])
	}

	currency := currencyCode(value("tl_etf-basics_value_fund-currency"))
	if len(currency) != 3 {
		currency = detectCurrencyFromName(name)
	}

	rawISIN := strings.ToUpper(value("etf-profile-header_isin-value"))
	if rawISIN == "" || !portfolio.ValidISIN(rawISIN) {
		rawISIN = isin
	}
	if rawISIN != isin {
		return portfolio.Instrument{}, errors.New("justETF returned a different ISIN")
	}

	ticker := strings.ToUpper(value("etf-profile-header_identifier-value-ticker"))
	if ticker == "-" {
		ticker = ""
	}

	now := time.Now().UTC().Format(time.RFC3339)
	etf := portfolio.Instrument{
		ISIN:            rawISIN,
		Name:            name,
		Ticker:          ticker,
		InstrumentType:  portfolio.InferInstrumentType(name),
		Provider:        value("tl_etf-basics_value_fund-provider"),
		IndexName:       value("tl_etf-basics_value_index-name"),
		InvestmentFocus: value("tl_etf-basics_value_investment-focus"),
		CurrencyHedged:  strings.EqualFold(value("tl_etf-basics_value_currency-hedge"), "Currency hedged"),
		DataStatus:      portfolio.InstrumentStatusEnriched,
		Distribution:    dist,
		Replication:     rep,
		Domicile:        dom,
		FundCurrency:    currency,
		TERBPS:          ter,
		FundSizeMillion: size,
		InceptionDate:   started,
		UCITS:           strings.EqualFold(tableValue(doc, "UCITS compliance"), "Yes") || strings.Contains(strings.ToUpper(name), "UCITS"),
		SourceURL:       profileURL,
		RefreshedAt:     now,
	}
	portfolio.ClassifyInstrument(&etf)
	if err := portfolio.ValidateInstrument(etf); err != nil {
		return portfolio.Instrument{}, fmt.Errorf("justETF returned incomplete ETF data: %w", err)
	}
	return etf, nil
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
	value = strings.TrimSpace(value)
	if value == "" || value == "-" {
		return "", errors.New("missing date")
	}
	for _, format := range []string{
		"2 January 2006",
		"02.01.06",
		"02.01.2006",
		"2006-01-02",
		"02/01/2006",
		"01/02/2006",
		"January 2, 2006",
	} {
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

func detectCurrencyFromName(name string) string {
	upper := strings.ToUpper(name)
	for _, code := range []string{"USD", "EUR", "GBP", "CHF", "JPY", "CAD", "AUD"} {
		if strings.Contains(upper, code) {
			return code
		}
	}
	return "EUR"
}

