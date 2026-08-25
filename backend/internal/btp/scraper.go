package btp

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

var (
	isinRegex   = regexp.MustCompile(`IT[0-9A-Z]{10}`)
	dateRegex   = regexp.MustCompile(`\d{2}/\d{2}/\d{4}`)
	couponRegex = regexp.MustCompile(`(\d+[\.,]?\d*)\s*%`)
)

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

func (s *Scraper) ScrapeAll(cfg ScoringConfig) ([]BTP, error) {
	var allBTPs []BTP
	seenIsins := make(map[string]bool)

	maxPages := 25
	page := 1

	for page <= maxPages {
		btps, err := s.ScrapePage(page)
		if err != nil || len(btps) == 0 {
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

		if newCount == 0 {
			break
		}
		page++
	}

	now := time.Now()
	for i := range allBTPs {
		allBTPs[i].CalculateMetrics(cfg.TaxRate, now)
	}

	allBTPs = ComputeAdvancedScores(allBTPs, cfg)
	return allBTPs, nil
}

func (s *Scraper) ScrapePage(page int) ([]BTP, error) {
	url := fmt.Sprintf("%s?page=%d", s.baseURL, page)

	req, err := http.NewRequest("GET", url, nil)
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

	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil, err
	}

	var btps []BTP
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	doc.Find("table.m-table tr").Each(func(i int, sel *goquery.Selection) {
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
		if isinMatch == "" {
			return
		}

		name := ""
		if len(cells) > 1 {
			name = cleanText(cells[1])
		}

		price := 0.0
		if len(cells) > 2 {
			price = parseItalianFloat(cells[2])
		}

		semiCoupon := 0.0
		if len(cells) > 3 {
			semiCoupon = parseItalianFloat(cells[3])
		}
		coupon := semiCoupon * 2.0

		if coupon <= 0 {
			coupon = extractCouponFromName(name)
		}

		expiryDate := ""
		if len(cells) > 4 {
			expiryDate = extractDate(cells[4])
		}
		if expiryDate == "" {
			expiryDate = extractDate(rowHtml)
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
