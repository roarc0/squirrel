package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type SearchResultItem struct {
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
	URL     string `json:"url"`
}

type SearchResponse struct {
	Query        string             `json:"query"`
	ResultsCount int                `json:"results_count"`
	Results      []SearchResultItem `json:"results"`
}

var (
	ddgResultLinkRegex = regexp.MustCompile(`class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>`)
	ddgSnippetRegex    = regexp.MustCompile(`class="result__snippet"[^>]*>(.*?)</a>`)
	htmlTagRegex       = regexp.MustCompile(`<[^>]*>`)
)

func cleanHTML(s string) string {
	s = htmlTagRegex.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "&quot;", "\"")
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&#39;", "'")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	return strings.TrimSpace(s)
}

func PerformWebSearch(ctx context.Context, query string) (string, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return "", fmt.Errorf("search query cannot be empty")
	}

	client := &http.Client{Timeout: 10 * time.Second}

	// 1. Try DuckDuckGo HTML Search
	form := url.Values{}
	form.Set("q", query)
	form.Set("b", "")
	form.Set("kl", "us-en")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://html.duckduckgo.com/html/", strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("create search request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := client.Do(req)
	var items []SearchResultItem

	if err == nil && resp.StatusCode == http.StatusOK {
		bodyBytes, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr == nil {
			bodyStr := string(bodyBytes)
			linkMatches := ddgResultLinkRegex.FindAllStringSubmatch(bodyStr, 8)
			snippetMatches := ddgSnippetRegex.FindAllStringSubmatch(bodyStr, 8)

			for i := 0; i < len(linkMatches); i++ {
				rawURL := linkMatches[i][1]
				rawTitle := linkMatches[i][2]

				// Unescape duckduckgo target URL if wrapped in /l/?uddg=
				if parsedURL, parseErr := url.Parse(rawURL); parseErr == nil {
					if target := parsedURL.Query().Get("uddg"); target != "" {
						rawURL = target
					}
				}

				snippet := ""
				if i < len(snippetMatches) {
					snippet = cleanHTML(snippetMatches[i][1])
				}

				title := cleanHTML(rawTitle)
				if title != "" && rawURL != "" {
					items = append(items, SearchResultItem{
						Title:   title,
						Snippet: snippet,
						URL:     rawURL,
					})
				}
			}
		}
	} else if resp != nil {
		resp.Body.Close()
	}

	// 2. Fallback to DuckDuckGo Instant Answer API if HTML scraper returns 0 items
	if len(items) == 0 {
		apiURL := fmt.Sprintf("https://api.duckduckgo.com/?q=%s&format=json&no_html=1&skip_disambig=1", url.QueryEscape(query))
		apiReq, apiErr := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
		if apiErr == nil {
			apiReq.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
			if apiResp, doErr := client.Do(apiReq); doErr == nil && apiResp.StatusCode == http.StatusOK {
				var ddgData struct {
					AbstractText   string `json:"AbstractText"`
					AbstractSource string `json:"AbstractSource"`
					AbstractURL    string `json:"AbstractURL"`
					RelatedTopics  []struct {
						Text string `json:"Text"`
						FirstURL string `json:"FirstURL"`
					} `json:"RelatedTopics"`
				}
				if jsonErr := json.NewDecoder(apiResp.Body).Decode(&ddgData); jsonErr == nil {
					if ddgData.AbstractText != "" {
						items = append(items, SearchResultItem{
							Title:   fmt.Sprintf("Summary (%s)", ddgData.AbstractSource),
							Snippet: ddgData.AbstractText,
							URL:     ddgData.AbstractURL,
						})
					}
					for _, topic := range ddgData.RelatedTopics {
						if topic.Text != "" && len(items) < 6 {
							items = append(items, SearchResultItem{
								Title:   topic.Text,
								Snippet: topic.Text,
								URL:     topic.FirstURL,
							})
						}
					}
				}
				apiResp.Body.Close()
			}
		}
	}

	searchResp := SearchResponse{
		Query:        query,
		ResultsCount: len(items),
		Results:      items,
	}

	b, err := json.MarshalIndent(searchResp, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func WebSearchToolDefinition() ToolDefinition {
	return ToolDefinition{
		Name:        "web_search",
		Description: "Performs a live web search to fetch current financial market news, economic statistics, real-time rates, stock prices, or external web information.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"query": map[string]interface{}{
					"type":        "string",
					"description": "The search query string (e.g., '10 year Italian BTP yield today', 'ECB rate decision latest', or 'S&P 500 current valuation').",
				},
			},
			"required": []string{"query"},
		},
	}
}
