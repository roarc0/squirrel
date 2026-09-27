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

func CalculateGeoRadar(accounts []Account, holdings []Holding, eurUsdRate float64, includeCash bool) GeoRadarResult {
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
		// Fund denomination, name and ISIN cannot establish underlying asset weights
		// or the hedge currency. Keep unknown exposure visible until sourced data exists.
		addUnknownGeo(value)
		addCurrency(currencyMap, "UNKNOWN", false, value)
		unknown += value
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
			if item.Currency == "USD" {
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
		result.Diagnostics = append(result.Diagnostics, Diagnostic{ID: "geo-coverage", Category: "allocation", Severity: SeverityInfo, Title: "Geographic exposure unavailable", Message: "The catalog has no sourced underlying country weights or account institution countries. Geographic exposure is shown as unknown."})
	}
	if unknown > 0 {
		result.Diagnostics = append(result.Diagnostics, Diagnostic{ID: "fx-coverage", Category: "allocation", Severity: SeverityInfo, Title: "Investment FX exposure unavailable", Message: "Underlying currency and hedge-currency data are missing for investments. FX scenarios cover known cash exposure only."})
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
