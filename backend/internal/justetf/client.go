package justetf

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"sync"
	"time"
)

const (
	defaultBaseURL = "https://www.justetf.com"
	maxResponse    = 4 << 20
)

var (
	ErrInvalidQuery = errors.New("invalid ETF query")
	ErrNotFound     = errors.New("ETF not found")
	ErrRateLimited  = errors.New("justETF temporarily blocked requests")
)

type Client struct {
	baseURL         string
	timeout         time.Duration
	profileInterval time.Duration
	profileMu       sync.Mutex
	nextProfile     time.Time
}

func New(profileInterval ...time.Duration) *Client {
	interval := 10 * time.Second
	if len(profileInterval) > 0 {
		interval = profileInterval[0]
	}
	return &Client{baseURL: defaultBaseURL, timeout: 20 * time.Second, profileInterval: interval}
}

func newHTTPClient(timeout time.Duration) *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Timeout: timeout, Jar: jar}
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
