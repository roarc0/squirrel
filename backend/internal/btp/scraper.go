package btp

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

var (
	isinRegex   = regexp.MustCompile(`IT[0-9A-Z]{10}`)
	dateRegex   = regexp.MustCompile(`\d{2}/\d{2}/\d{4}|\d{2}\.\d{2}\.\d{4}`)
	couponRegex = regexp.MustCompile(`(\d+[\.,]?\d*)\s*%`)
)

const maxScrapeResponse = 4 << 20

type Scraper struct {
	client  *http.Client
	baseURL string
}

func NewScraper(baseURL string) *Scraper {
	if baseURL == "" {
		baseURL = "https://www.rendimentibtp.it/"
	}
	return &Scraper{
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		baseURL: baseURL,
	}
}

func (s *Scraper) ScrapeAll(ctx context.Context, cfg ScoringConfig) ([]BTP, error) {
	log.Printf("[btp.scraper] Starting ScrapeAll from %s", s.baseURL)
	var allBTPs []BTP
	seenIsins := make(map[string]bool)

	maxPages := 25
	page := 1

	for page <= maxPages {
		btps, err := s.ScrapePage(ctx, page)
		if err != nil {
			return nil, fmt.Errorf("scrape BTP page %d: %w", page, err)
		}
		if len(btps) == 0 {
			log.Printf("[btp.scraper] ScrapePage(%d) returned 0 BTPs", page)
			break
		}

		newCount := 0
		for _, b := range btps {
			if !seenIsins[b.ISIN] {
				seenIsins[b.ISIN] = true
				allBTPs = append(allBTPs, b)
				newCount++
			}
		}
		log.Printf("[btp.scraper] Page %d: scraped %d BTPs (%d new)", page, len(btps), newCount)

		if newCount == 0 {
			break
		}
		page++
	}

	if len(allBTPs) == 0 {
		return nil, fmt.Errorf("BTP source returned no bonds")
	}

	now := time.Now()
	for i := range allBTPs {
		allBTPs[i].CalculateMetrics(cfg.TaxRate, now)
	}

	allBTPs = ComputeAdvancedScores(allBTPs, cfg)
	log.Printf("[btp.scraper] ScrapeAll completed with %d scored BTPs", len(allBTPs))
	return allBTPs, nil
}

func (s *Scraper) ScrapePage(ctx context.Context, page int) ([]BTP, error) {
	url := fmt.Sprintf("%s?page=%d", s.baseURL, page)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept-Language", "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxScrapeResponse+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxScrapeResponse {
		return nil, fmt.Errorf("BTP response is too large")
	}
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	var btps []BTP
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	// Match #GridView1 tr, table.GridView tr, or fallback table tr
	selectors := []string{"#GridView1 tr", "table.GridView tr", "table tr"}
	var rows *goquery.Selection
	for _, sel := range selectors {
		rows = doc.Find(sel)
		if rows.Length() > 1 {
			break
		}
	}

	rows.Each(func(i int, sel *goquery.Selection) {
		tds := sel.Find("td")
		if tds.Length() < 4 {
			return
		}

		var cells []string
		tds.Each(func(_ int, td *goquery.Selection) {
			cells = append(cells, strings.TrimSpace(td.Text()))
		})

		rowHtml, _ := sel.Html()
		isinMatch := isinRegex.FindString(rowHtml)
		if isinMatch == "" && len(cells) > 0 {
			isinMatch = isinRegex.FindString(cells[0])
		}
		if isinMatch == "" {
			return
		}

		name := ""
		if len(cells) > 1 {
			name = cleanText(cells[1])
		}

		expiryDate := ""
		if len(cells) > 3 {
			expiryDate = extractDate(cells[3])
		}
		if expiryDate == "" {
			expiryDate = extractDate(rowHtml)
		}
		// Convert DD.MM.YYYY to DD/MM/YYYY
		expiryDate = strings.ReplaceAll(expiryDate, ".", "/")

		coupon := 0.0
		if len(cells) > 4 {
			coupon = parseItalianFloat(cells[4])
		}
		if coupon <= 0 {
			coupon = extractCouponFromName(name)
		}

		price := 0.0
		if len(cells) > 5 {
			price = parseItalianFloat(cells[5])
		}

		if isinMatch != "" && expiryDate != "" {
			btps = append(btps, BTP{
				ISIN:       isinMatch,
				Name:       name,
				Price:      price,
				Coupon:     coupon,
				ExpiryDate: expiryDate,
				ScrapedAt:  nowStr,
			})
		}
	})

	return btps, nil
}

func parseItalianFloat(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "-" {
		return 0.0
	}
	s = strings.TrimSuffix(s, "%")
	s = strings.TrimSpace(s)

	if strings.Contains(s, ",") {
		s = strings.ReplaceAll(s, ".", "")
		s = strings.ReplaceAll(s, ",", ".")
	} else if strings.Contains(s, ".") {
		parts := strings.Split(s, ".")
		if len(parts) == 2 {
			val, err := strconv.ParseFloat(s, 64)
			if err == nil {
				return val
			}
		}
	}

	val, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0.0
	}
	return val
}

func extractDate(s string) string {
	return dateRegex.FindString(s)
}

func cleanText(s string) string {
	fields := strings.Fields(s)
	return strings.Join(fields, " ")
}

func extractCouponFromName(name string) float64 {
	m := couponRegex.FindStringSubmatch(name)
	if len(m) >= 2 {
		return parseItalianFloat(m[1])
	}
	return 0.0
}
