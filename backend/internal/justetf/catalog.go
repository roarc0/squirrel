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
