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
	Currency          string  `json:"currency"`
	IsHedged          bool    `json:"is_hedged"`
	ValueMinor        int64   `json:"value_minor"`
	Percentage        float64 `json:"percentage"`
	FXImpact5PctMinor int64   `json:"fx_impact_5pct_minor"`
}

type GeoRadarResult struct {
	Regions           []GeoExposureItem      `json:"regions"`
	Countries         []GeoExposureItem      `json:"countries"`
	Currencies        []CurrencyExposureItem `json:"currencies"`
	Diagnostics       []Diagnostic           `json:"diagnostics"`
	CurrentEURUSDRate float64                `json:"current_eur_usd_rate"`
}

type itemWeight struct {
	countryCode string
	countryName string
	region      string
	currency    string
	weight      float64 // 0.0 to 1.0
}

func CalculateGeoRadar(accounts []Account, holdings []Holding, instruments map[int64]Instrument, eurUsdRate float64, includeCash bool) GeoRadarResult {
	var result GeoRadarResult
	if eurUsdRate > 0 && !math.IsNaN(eurUsdRate) && !math.IsInf(eurUsdRate, 0) {
		result.CurrentEURUSDRate = eurUsdRate
	}
	accountsByID := make(map[int64]Account, len(accounts))
	for _, account := range accounts {
		accountsByID[account.ID] = account
	}
	countryMap := make(map[string]*GeoExposureItem)
	regionMap := make(map[string]*GeoExposureItem)
	currencyMap := make(map[string]*CurrencyExposureItem)
	excluded := make(map[string]bool)
	var total, unknown int64
	toEUR := func(value int64, currency string) (int64, bool) {
		switch strings.ToUpper(currency) {
		case "EUR":
			return value, true
		case "USD":
			if result.CurrentEURUSDRate > 0 {
				return int64(math.Round(float64(value) / result.CurrentEURUSDRate)), true
			}
		}
		excluded[currency] = true
		return 0, false
	}
	addUnknownGeo := func(value int64) {
		addExposure(countryMap, "UNKNOWN", "Unknown", "Unknown", value)
		addRegion(regionMap, "Unknown", value)
	}
	if includeCash {
		for _, account := range accounts {
			if account.Archived || account.BalanceMinor <= 0 {
				continue
			}
			value, ok := toEUR(account.BalanceMinor, account.Currency)
			if !ok {
				continue
			}
			total += value
			// Account currency identifies FX exposure, not the bank's country.
			addUnknownGeo(value)
			addCurrency(currencyMap, strings.ToUpper(account.Currency), false, value)
		}
	}
	for _, holding := range holdings {
		account, ok := accountsByID[holding.AccountID]
		if !ok || account.Archived || holding.ValueMinor <= 0 {
			continue
		}
		currency := holding.Currency
		if currency == "" {
			currency = account.Currency
		}
		value, ok := toEUR(holding.ValueMinor, currency)
		if !ok {
			continue
		}
		total += value
		inst := instruments[holding.InstrumentID]
		weights := resolveWeights(inst)
		remaining := value
		for i, w := range weights {
			portion := int64(math.Round(float64(value) * w.weight))
			if i == len(weights)-1 {
				portion = remaining
			}
			remaining -= portion
			addExposure(countryMap, w.countryCode, w.countryName, w.region, portion)
			addRegion(regionMap, w.region, portion)
			currency := w.currency
			// A hedge flag alone does not identify the hedge currency.
			if inst.CurrencyHedged {
				currency = "UNKNOWN"
			}
			addCurrency(currencyMap, currency, inst.CurrencyHedged, portion)
			if w.countryCode == "UNKNOWN" {
				unknown += portion
			}
		}
	}
	if total > 0 {
		for _, item := range countryMap {
			item.Percentage = float64(item.ValueMinor) / float64(total) * 100
			result.Countries = append(result.Countries, *item)
		}
		for _, item := range regionMap {
			item.Percentage = float64(item.ValueMinor) / float64(total) * 100
			result.Regions = append(result.Regions, *item)
		}
		for _, item := range currencyMap {
			item.Percentage = float64(item.ValueMinor) / float64(total) * 100
			if item.Currency != "EUR" && item.Currency != "UNKNOWN" && !item.IsHedged {
				item.FXImpact5PctMinor = int64(math.Round(float64(item.ValueMinor) * 0.05))
			}
			result.Currencies = append(result.Currencies, *item)
		}
	}
	sort.Slice(result.Countries, func(i, j int) bool { return result.Countries[i].ValueMinor > result.Countries[j].ValueMinor })
	sort.Slice(result.Regions, func(i, j int) bool { return result.Regions[i].ValueMinor > result.Regions[j].ValueMinor })
	sort.Slice(result.Currencies, func(i, j int) bool {
		if result.Currencies[i].ValueMinor == result.Currencies[j].ValueMinor {
			return result.Currencies[i].Currency < result.Currencies[j].Currency
		}
		return result.Currencies[i].ValueMinor > result.Currencies[j].ValueMinor
	})
	if total > 0 {
		result.Diagnostics = append(result.Diagnostics, Diagnostic{ID: "geo-coverage", Category: "allocation", Severity: SeverityInfo, Title: "Estimated geographic and FX exposure", Message: "Investment breakdowns use static index proxies, not current fund holdings. Currency weights approximate market exposure, not company revenues. Cash geography and unrecognized or hedged investment currencies remain unknown."})
	}
	if unknown > 0 {
		result.Diagnostics = append(result.Diagnostics, Diagnostic{ID: "fx-coverage", Category: "allocation", Severity: SeverityInfo, Title: "Partial exposure coverage", Message: "Some investments have no recognized index proxy. Their values remain in the totals as unknown exposure."})
	}
	currencies := make([]string, 0, len(excluded))
	for currency := range excluded {
		currencies = append(currencies, currency)
	}
	sort.Strings(currencies)
	for _, currency := range currencies {
		result.Diagnostics = append(result.Diagnostics, Diagnostic{ID: "fx-excluded-" + currency, Category: "allocation", Severity: SeverityWarning, Title: "Incomplete valuation", Message: fmt.Sprintf("%s positions are excluded because no valid EUR conversion rate is available. Percentages refer only to included assets.", currency)})
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

	// ponytail: static index proxies restore estimated look-through; replace with sourced holdings when available.
	if inst.AssetClass != "bond" && !strings.Contains(focus, "ex ") && !strings.Contains(focus, "sector") && (strings.Contains(isin, "IE00B4L5Y983") || strings.Contains(isin, "IE00BK5BQT35") || strings.Contains(isin, "LU1781541179") || strings.Contains(focus, "msci world") || strings.Contains(focus, "ftse all-world") || strings.Contains(focus, "acwi")) {
		return []itemWeight{
			{countryCode: "US", countryName: "United States", region: "North America", currency: "USD", weight: 0.66},
			{countryCode: "JP", countryName: "Japan", region: "Developed Asia", currency: "JPY", weight: 0.06},
			{countryCode: "GB", countryName: "United Kingdom", region: "Europe", currency: "GBP", weight: 0.04},
			{countryCode: "FR", countryName: "France", region: "Europe", currency: "EUR", weight: 0.03},
			{countryCode: "DE", countryName: "Germany", region: "Europe", currency: "EUR", weight: 0.03},
			{countryCode: "CH", countryName: "Switzerland", region: "Europe", currency: "CHF", weight: 0.03},
			{countryCode: "CA", countryName: "Canada", region: "North America", currency: "CAD", weight: 0.03},
			{countryCode: "OTHER", countryName: "Other Global", region: "Other", currency: "UNKNOWN", weight: 0.12},
		}
	}

	if strings.Contains(focus, "s&p 500") || strings.Contains(focus, "sp500") || strings.Contains(focus, "nasdaq") || strings.Contains(focus, "us equity") || strings.Contains(focus, "usa") {
		return []itemWeight{
			{countryCode: "US", countryName: "United States", region: "North America", currency: "USD", weight: 1.0},
		}
	}

	if strings.Contains(focus, "msci europe") || strings.Contains(focus, "stoxx 600") || strings.Contains(focus, "europe") {
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
			{countryCode: "CN", countryName: "China", region: "Emerging Markets", currency: "CNY", weight: 0.25},
			{countryCode: "IN", countryName: "India", region: "Emerging Markets", currency: "INR", weight: 0.20},
			{countryCode: "TW", countryName: "Taiwan", region: "Emerging Markets", currency: "TWD", weight: 0.18},
			{countryCode: "KR", countryName: "South Korea", region: "Emerging Markets", currency: "KRW", weight: 0.12},
			{countryCode: "BR", countryName: "Brazil", region: "Emerging Markets", currency: "BRL", weight: 0.05},
			{countryCode: "OTHER", countryName: "Other EM", region: "Emerging Markets", currency: "UNKNOWN", weight: 0.20},
		}
	}

	if strings.Contains(focus, "ftse mib") || strings.Contains(focus, "italy") || (inst.InstrumentType == InstrumentTypeBond && strings.HasPrefix(isin, "IT")) {
		return []itemWeight{
			{countryCode: "IT", countryName: "Italy", region: "Europe", currency: "EUR", weight: 1.0},
		}
	}

	if strings.Contains(focus, "gold") || strings.Contains(focus, "precious metals") || strings.Contains(focus, "commodity") {
		return []itemWeight{
			{countryCode: "OTHER", countryName: "Gold Spot", region: "Global Commodity", currency: "USD", weight: 1.0},
		}
	}

	return []itemWeight{{countryCode: "UNKNOWN", countryName: "Unknown", region: "Unknown", currency: "UNKNOWN", weight: 1}}
}
