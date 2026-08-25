package btp

import (
	"fmt"
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
	log.Printf("[btp.scraper] Starting ScrapeAll from %s", s.baseURL)
	var allBTPs []BTP
	seenIsins := make(map[string]bool)

	maxPages := 25
	page := 1

	for page <= maxPages {
		btps, err := s.ScrapePage(page)
		if err != nil {
			log.Printf("[btp.scraper] ScrapePage(%d) error: %v", page, err)
			break
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
		log.Printf("[btp.scraper] Web scraping returned 0 BTPs; loading catalog seeds fallback...")
		allBTPs = fallbackBTPs()
	}

	now := time.Now()
	for i := range allBTPs {
		allBTPs[i].CalculateMetrics(cfg.TaxRate, now)
	}

	allBTPs = ComputeAdvancedScores(allBTPs, cfg)
	log.Printf("[btp.scraper] ScrapeAll completed with %d scored BTPs", len(allBTPs))
	return allBTPs, nil
}

func fallbackBTPs() []BTP {
	nowStr := time.Now().Format("2006-01-02 15:04:05")
	return []BTP{
		{ISIN: "IT0005518128", Name: "BTP 4.5% 01/10/2053", Price: 98.50, Coupon: 4.50, ExpiryDate: "01/10/2053", ScrapedAt: nowStr},
		{ISIN: "IT0005425233", Name: "BTP 1.7% 01/09/2051", Price: 56.57, Coupon: 1.70, ExpiryDate: "01/09/2051", ScrapedAt: nowStr},
		{ISIN: "IT0005480980", Name: "BTP 2.15% 01/09/2052", Price: 62.23, Coupon: 2.15, ExpiryDate: "01/09/2052", ScrapedAt: nowStr},
		{ISIN: "IT0005438004", Name: "BTP 1.5% 01/04/2045", Price: 62.26, Coupon: 1.50, ExpiryDate: "01/04/2045", ScrapedAt: nowStr},
		{ISIN: "IT0005441883", Name: "BTP 2.15% 01/03/2072", Price: 55.83, Coupon: 2.15, ExpiryDate: "01/03/2072", ScrapedAt: nowStr},
		{ISIN: "IT0005398406", Name: "BTP 2.45% 01/09/2050", Price: 68.37, Coupon: 2.45, ExpiryDate: "01/09/2050", ScrapedAt: nowStr},
		{ISIN: "IT0005217390", Name: "BTP 2.8% 01/03/2067", Price: 66.94, Coupon: 2.80, ExpiryDate: "01/03/2067", ScrapedAt: nowStr},
		{ISIN: "IT0005162828", Name: "BTP 2.7% 01/03/2047", Price: 75.40, Coupon: 2.70, ExpiryDate: "01/03/2047", ScrapedAt: nowStr},
		{ISIN: "IT0005421703", Name: "BTP 1.8% 01/03/2041", Price: 72.97, Coupon: 1.80, ExpiryDate: "01/03/2041", ScrapedAt: nowStr},
		{ISIN: "IT0005083057", Name: "BTP 3.25% 01/09/2046", Price: 83.00, Coupon: 3.25, ExpiryDate: "01/09/2046", ScrapedAt: nowStr},
		{ISIN: "IT0005273013", Name: "BTP 3.45% 01/03/2048", Price: 84.61, Coupon: 3.45, ExpiryDate: "01/03/2048", ScrapedAt: nowStr},
		{ISIN: "IT0005611741", Name: "BTP 4.3% 01/10/2054", Price: 93.32, Coupon: 4.30, ExpiryDate: "01/10/2054", ScrapedAt: nowStr},
		{ISIN: "IT0005363111", Name: "BTP 3.85% 01/09/2049", Price: 89.29, Coupon: 3.85, ExpiryDate: "01/09/2049", ScrapedAt: nowStr},
		{ISIN: "IT0005668238", Name: "BTP 4.65% 01/10/2055", Price: 98.15, Coupon: 4.65, ExpiryDate: "01/10/2055", ScrapedAt: nowStr},
		{ISIN: "IT0005565392", Name: "BTP VALORE 3.25% 10/10/2027", Price: 100.10, Coupon: 3.25, ExpiryDate: "10/10/2027", ScrapedAt: nowStr},
		{ISIN: "IT0005532715", Name: "BTP ITALIA 2.0% 14/03/2028", Price: 99.40, Coupon: 2.00, ExpiryDate: "14/03/2028", ScrapedAt: nowStr},
		{ISIN: "IT0005497000", Name: "BTP ZC 15/12/2026", Price: 95.80, Coupon: 0.00, ExpiryDate: "15/12/2026", ScrapedAt: nowStr},
	}
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
