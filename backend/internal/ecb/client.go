package ecb

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

const baseURL = "https://data-api.ecb.europa.eu/service/data"

type Client struct {
	baseURL string
	http    *http.Client
}

type record map[string]string

func New() *Client {
	return &Client{baseURL: baseURL, http: &http.Client{Timeout: 20 * time.Second}}
}

func newClient(baseURL string, client *http.Client) *Client {
	return &Client{baseURL: baseURL, http: client}
}

func (c *Client) latest(ctx context.Context, flow, key string) ([]record, error) {
	return c.observations(ctx, flow, key, 1)
}

func (c *Client) observations(ctx context.Context, flow, key string, count int) ([]record, error) {
	address := c.baseURL + "/" + flow
	if key != "" {
		address += "/" + key
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	query := req.URL.Query()
	query.Set("format", "csvdata")
	if count > 0 {
		query.Set("lastNObservations", strconv.Itoa(count))
	}
	query.Set("detail", "dataonly")
	query.Set("endPeriod", time.Now().UTC().Format(time.DateOnly))
	req.URL.RawQuery = query.Encode()
	req.Header.Set("Accept", "text/csv")
	req.Header.Set("User-Agent", "Squirrel/0.1")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch ECB %s data: %w", flow, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ECB %s returned HTTP %d", flow, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20+1))
	if err != nil {
		return nil, fmt.Errorf("read ECB %s data: %w", flow, err)
	}
	if len(body) > 16<<20 {
		return nil, errors.New("ECB response is too large")
	}

	rows, err := csv.NewReader(bytes.NewReader(body)).ReadAll()
	if err != nil || len(rows) < 2 {
		return nil, fmt.Errorf("ECB %s returned invalid CSV", flow)
	}
	records := make([]record, 0, len(rows)-1)
	for _, row := range rows[1:] {
		if len(row) != len(rows[0]) {
			return nil, fmt.Errorf("ECB %s returned an incomplete row", flow)
		}
		item := make(record, len(row))
		for i, value := range row {
			item[rows[0][i]] = value
		}
		records = append(records, item)
	}
	return records, nil
}

func (r record) number() (float64, error) {
	value, err := strconv.ParseFloat(r["OBS_VALUE"], 64)
	if err != nil {
		return 0, fmt.Errorf("parse ECB value %q: %w", r["OBS_VALUE"], err)
	}
	return value, nil
}
