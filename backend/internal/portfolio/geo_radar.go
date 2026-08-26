package portfolio

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

type GeoExposureItem struct {
	Region      string  `json:"region"`
	CountryCode string  `json:"country_code"`
	CountryName string  `json:"country_name"`
	ValueMinor  int64   `json:"value_minor"`
	Percentage  float64 `json:"percentage"`
}

type CurrencyExposureItem struct {
	Currency           string  `json:"currency"`
	IsHedged           bool    `json:"is_hedged"`
	ValueMinor         int64   `json:"value_minor"`
	Percentage         float64 `json:"percentage"`
	FXImpact5PctMinor  int64   `json:"fx_impact_5pct_minor"`
}

type GeoRadarResult struct {
	Regions             []GeoExposureItem      `json:"regions"`
	Countries           []GeoExposureItem      `json:"countries"`
	Currencies          []CurrencyExposureItem `json:"currencies"`
	Diagnostics         []Diagnostic           `json:"diagnostics"`
	CurrentEURUSDRate   float64                `json:"current_eur_usd_rate"`
}

type itemWeight struct {
	countryCode string
	countryName string
	region      string
	currency    string
	weight      float64 // 0.0 to 1.0
}

func CalculateGeoRadar(accounts []Account, holdings []Holding, instruments map[int64]Instrument, eurUsdRate float64, includeCash bool) GeoRadarResult {
	if eurUsdRate <= 0 {
		eurUsdRate = 1.08
	}

	var totalWealthMinor int64
	countryMap := make(map[string]*GeoExposureItem)
	regionMap := make(map[string]*GeoExposureItem)
	currencyMap := make(map[string]*CurrencyExposureItem)

	countryNames := map[string]string{
		"US": "United States",
		"IT": "Italy",
		"DE": "Germany",
		"FR": "France",
		"JP": "Japan",
		"GB": "United Kingdom",
		"CH": "Switzerland",
		"CA": "Canada",
		"CN": "China",
		"IN": "India",
		"TW": "Taiwan",
		"KR": "South Korea",
		"NL": "Netherlands",
		"ES": "Spain",
		"BR": "Brazil",
		"OTHER": "Other / Global",
	}

	// 1. Process Cash Accounts if enabled
	if includeCash {
		for _, acc := range accounts {
			bal := acc.BalanceMinor
			if bal <= 0 {
				continue
			}
			totalWealthMinor += bal
			ccy := strings.ToUpper(acc.Currency)
			if ccy == "" {
				ccy = "EUR"
			}

			cCode := "IT"
			cName := "Italy"
			region := "Europe"
			if ccy == "USD" {
				cCode = "US"
				cName = "United States"
				region = "North America"
			}

			addExposure(countryMap, cCode, cName, region, bal)
			addRegion(regionMap, region, bal)
			addCurrency(currencyMap, ccy, false, bal)
		}
	}

	// 2. Process Holdings
	for _, h := range holdings {
		val := h.ValueMinor
		if val <= 0 {
			continue
		}
		totalWealthMinor += val

		inst, ok := instruments[h.InstrumentID]
		if !ok {
			addExposure(countryMap, "OTHER", "Other / Global", "Global", val)
			addRegion(regionMap, "Global", val)
			addCurrency(currencyMap, "EUR", false, val)
			continue
		}

		weights := resolveWeights(inst)
		for _, w := range weights {
			portion := int64(math.Round(float64(val) * w.weight))
			if portion <= 0 {
				continue
			}

			cName := w.countryName
			if cName == "" {
				if n, exists := countryNames[w.countryCode]; exists {
					cName = n
				} else {
					cName = w.countryCode
				}
			}

			curr := w.currency
			isHedged := inst.CurrencyHedged
			if isHedged {
				curr = "EUR"
			}

			addExposure(countryMap, w.countryCode, cName, w.region, portion)
			addRegion(regionMap, w.region, portion)
			addCurrency(currencyMap, curr, isHedged, portion)
		}
	}

	// 3. Normalize percentages
	var result GeoRadarResult
	result.CurrentEURUSDRate = eurUsdRate

	if totalWealthMinor > 0 {
		for _, item := range countryMap {
			item.Percentage = math.Round((float64(item.ValueMinor)/float64(totalWealthMinor)*100)*10) / 10
			result.Countries = append(result.Countries, *item)
		}
		for _, item := range regionMap {
			item.Percentage = math.Round((float64(item.ValueMinor)/float64(totalWealthMinor)*100)*10) / 10
			result.Regions = append(result.Regions, *item)
		}
		for _, item := range currencyMap {
			item.Percentage = math.Round((float64(item.ValueMinor)/float64(totalWealthMinor)*100)*10) / 10
			// 5% FX impact: if non-EUR currency shifts 5%, impact = 5% * value
			if item.Currency != "EUR" && !item.IsHedged {
				item.FXImpact5PctMinor = int64(math.Round(float64(item.ValueMinor) * 0.05))
			}
			result.Currencies = append(result.Currencies, *item)
		}
	}

	sort.Slice(result.Countries, func(i, j int) bool { return result.Countries[i].ValueMinor > result.Countries[j].ValueMinor })
	sort.Slice(result.Regions, func(i, j int) bool { return result.Regions[i].ValueMinor > result.Regions[j].ValueMinor })
	sort.Slice(result.Currencies, func(i, j int) bool { return result.Currencies[i].ValueMinor > result.Currencies[j].ValueMinor })

	// 4. Diagnostics
	for _, c := range result.Countries {
		if c.CountryCode == "US" && c.Percentage > 65.0 {
			result.Diagnostics = append(result.Diagnostics, Diagnostic{
				ID:       "geo-us-concentration",
				Category: "allocation",
				Severity: "warning",
				Title:    "High US Market Concentration",
				Message:  fmt.Sprintf("%.1f%% of your total portfolio is exposed to the United States market. Consider diversifying into European or Emerging Market assets.", c.Percentage),
			})
		}
		if c.CountryCode == "IT" && c.Percentage > 50.0 {
			result.Diagnostics = append(result.Diagnostics, Diagnostic{
				ID:       "geo-home-bias-italy",
				Category: "allocation",
				Severity: "info",
				Title:    "Domestic Market Bias (Italy)",
				Message:  fmt.Sprintf("%.1f%% of your wealth is concentrated in Italian sovereign bonds and accounts. Keep domestic default risk in mind.", c.Percentage),
			})
		}
	}

	for _, curr := range result.Currencies {
		if curr.Currency == "USD" && !curr.IsHedged && curr.Percentage > 60.0 {
			result.Diagnostics = append(result.Diagnostics, Diagnostic{
				ID:       "geo-usd-fx-risk",
				Category: "allocation",
				Severity: "warning",
				Title:    "Significant Unhedged USD FX Exposure",
				Message:  fmt.Sprintf("%.1f%% of your wealth is in unhedged USD assets. A 5%% decline in USD/EUR would decrease net worth by ~€%.2f.", curr.Percentage, float64(curr.FXImpact5PctMinor)/100.0),
			})
		}
	}

	return result
}

func addExposure(m map[string]*GeoExposureItem, code, name, region string, value int64) {
	if item, ok := m[code]; ok {
		item.ValueMinor += value
	} else {
		m[code] = &GeoExposureItem{
			CountryCode: code,
			CountryName: name,
			Region:      region,
			ValueMinor:  value,
		}
	}
}

func addRegion(m map[string]*GeoExposureItem, region string, value int64) {
	if item, ok := m[region]; ok {
		item.ValueMinor += value
	} else {
		m[region] = &GeoExposureItem{
			Region:     region,
			ValueMinor: value,
		}
	}
}

func addCurrency(m map[string]*CurrencyExposureItem, ccy string, isHedged bool, value int64) {
	key := fmt.Sprintf("%s_%t", ccy, isHedged)
	if item, ok := m[key]; ok {
		item.ValueMinor += value
	} else {
		m[key] = &CurrencyExposureItem{
			Currency:   ccy,
			IsHedged:   isHedged,
			ValueMinor: value,
		}
	}
}

func resolveWeights(inst Instrument) []itemWeight {
	isin := strings.ToUpper(inst.ISIN)
	focus := strings.ToLower(inst.InvestmentFocus + " " + inst.IndexName + " " + inst.Name)

	// Special presets by ISIN or Index
	if strings.Contains(isin, "IE00B4L5Y983") || strings.Contains(isin, "IE00BK5BQT35") || strings.Contains(isin, "LU1781541179") || strings.Contains(focus, "msci world") || strings.Contains(focus, "ftse all-world") || strings.Contains(focus, "acwi") {
		return []itemWeight{
			{countryCode: "US", countryName: "United States", region: "North America", currency: "USD", weight: 0.66},
			{countryCode: "JP", countryName: "Japan", region: "Developed Asia", currency: "JPY", weight: 0.06},
			{countryCode: "GB", countryName: "United Kingdom", region: "Europe", currency: "GBP", weight: 0.04},
			{countryCode: "FR", countryName: "France", region: "Europe", currency: "EUR", weight: 0.03},
			{countryCode: "DE", countryName: "Germany", region: "Europe", currency: "EUR", weight: 0.03},
			{countryCode: "CH", countryName: "Switzerland", region: "Europe", currency: "CHF", weight: 0.03},
			{countryCode: "CA", countryName: "Canada", region: "North America", currency: "CAD", weight: 0.03},
			{countryCode: "OTHER", countryName: "Other Global", region: "Other", currency: "USD", weight: 0.12},
		}
	}

	if strings.Contains(focus, "s&p 500") || strings.Contains(focus, "sp500") || strings.Contains(focus, "nasdaq") || strings.Contains(focus, "us equity") || strings.Contains(focus, "usa") {
		return []itemWeight{
			{countryCode: "US", countryName: "United States", region: "North America", currency: "USD", weight: 1.0},
		}
	}

	if strings.Contains(focus, "msci europe") || strings.Contains(focus, "stoxx 600") || strings.Contains(focus, "euro stoxx 50") || strings.Contains(focus, "europe") {
		return []itemWeight{
			{countryCode: "FR", countryName: "France", region: "Europe", currency: "EUR", weight: 0.28},
			{countryCode: "DE", countryName: "Germany", region: "Europe", currency: "EUR", weight: 0.24},
			{countryCode: "GB", countryName: "United Kingdom", region: "Europe", currency: "GBP", weight: 0.15},
			{countryCode: "NL", countryName: "Netherlands", region: "Europe", currency: "EUR", weight: 0.10},
			{countryCode: "CH", countryName: "Switzerland", region: "Europe", currency: "CHF", weight: 0.08},
			{countryCode: "IT", countryName: "Italy", region: "Europe", currency: "EUR", weight: 0.05},
			{countryCode: "OTHER", countryName: "Other Europe", region: "Europe", currency: "EUR", weight: 0.10},
		}
	}

	if strings.Contains(focus, "emerging") || strings.Contains(focus, "msci em") {
		return []itemWeight{
			{countryCode: "CN", countryName: "China", region: "Emerging Markets", currency: "USD", weight: 0.25},
			{countryCode: "IN", countryName: "India", region: "Emerging Markets", currency: "USD", weight: 0.20},
			{countryCode: "TW", countryName: "Taiwan", region: "Emerging Markets", currency: "USD", weight: 0.18},
			{countryCode: "KR", countryName: "South Korea", region: "Emerging Markets", currency: "USD", weight: 0.12},
			{countryCode: "BR", countryName: "Brazil", region: "Emerging Markets", currency: "USD", weight: 0.05},
			{countryCode: "OTHER", countryName: "Other EM", region: "Emerging Markets", currency: "USD", weight: 0.20},
		}
	}

	if strings.Contains(focus, "ftse mib") || strings.Contains(focus, "italy") || strings.Contains(isin, "IT") {
		return []itemWeight{
			{countryCode: "IT", countryName: "Italy", region: "Europe", currency: "EUR", weight: 1.0},
		}
	}

	if strings.Contains(focus, "gold") || strings.Contains(focus, "precious metals") || strings.Contains(focus, "commodity") {
		return []itemWeight{
			{countryCode: "OTHER", countryName: "Gold Spot", region: "Global Commodity", currency: "USD", weight: 1.0},
		}
	}

	// Fallback based on FundCurrency & AssetClass
	ccy := strings.ToUpper(inst.FundCurrency)
	if ccy == "" {
		ccy = "EUR"
	}

	if ccy == "USD" {
		return []itemWeight{
			{countryCode: "US", countryName: "United States", region: "North America", currency: "USD", weight: 1.0},
		}
	}

	return []itemWeight{
		{countryCode: "IT", countryName: "Europe / EUR Zone", region: "Europe", currency: "EUR", weight: 1.0},
	}
}
