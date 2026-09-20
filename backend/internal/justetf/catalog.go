package justetf

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/roarc0/squirrel/backend/internal/portfolio"
)

func (c *Client) Catalog(ctx context.Context, limit int) ([]portfolio.Instrument, int, error) {
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
		results = append(results, c.catalogInstruments(rows)...)
		if len(rows) == 0 || start+len(rows) >= available {
			break
		}
	}
	return results, total, nil
}

func (c *Client) catalogInstruments(rows []searchRow) []portfolio.Instrument {
	var results []portfolio.Instrument
	now := time.Now().UTC().Format(time.RFC3339)
	for _, row := range rows {
		if !portfolio.ValidISIN(row.ISIN) || strings.TrimSpace(row.Name) == "" {
			continue
		}
		currency := currencyCode(row.FundCurrency)
		if len(currency) != 3 {
			continue
		}
		ter, _ := percentBPS(row.TER)
		size, _ := millions(row.FundSize)
		started, _ := profileDate(row.InceptionDate)
		name := strings.ToUpper(row.Name)
		etf := portfolio.Instrument{
			ISIN:            strings.ToUpper(row.ISIN),
			Name:            row.Name,
			Ticker:          strings.ToUpper(row.Ticker),
			InstrumentType:  portfolio.InferInstrumentType(row.Name),
			DataStatus:      portfolio.InstrumentStatusCatalog,
			CurrencyHedged:  strings.Contains(strings.ToLower(row.FundCurrency), "hedged"),
			Distribution:    distribution(row.DistributionPolicy),
			Replication:     replication(row.ReplicationMethod),
			Domicile:        countryCode(row.DomicileCountry),
			FundCurrency:    currency,
			TERBPS:          ter,
			FundSizeMillion: size,
			InceptionDate:   started,
			UCITS:           strings.Contains(name, "UCITS"),
			SourceURL:       c.baseURL + "/en/etf-profile.html?isin=" + url.QueryEscape(row.ISIN),
			RefreshedAt:     now,
		}
		portfolio.ClassifyInstrument(&etf)
		results = append(results, etf)
	}
	return results
}
