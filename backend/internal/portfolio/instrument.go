package portfolio

import (
	"cmp"
	"errors"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	DistributionAccumulating = "accumulating"
	DistributionDistributing = "distributing"
	ReplicationPhysicalFull  = "physical_full"
	ReplicationSampling      = "physical_sampling"
	ReplicationSynthetic     = "synthetic"
	InstrumentStatusCatalog  = "catalog"
	InstrumentStatusEnriched = "enriched"
	InstrumentTypeETF        = "etf"
	InstrumentTypeETP        = "etp"
	InstrumentTypeETC        = "etc"
	InstrumentTypeETN        = "etn"
	InstrumentTypeFund       = "fund"
	InstrumentTypeStock      = "stock"
	InstrumentTypeBond       = "bond"
	InstrumentTypeCrypto     = "crypto"
	InstrumentTypeCommodity  = "commodity"
	InstrumentTypeRealEstate = "real_estate"
	InstrumentTypeOther      = "other"
)

type Instrument struct {
	ID                    int64  `json:"id,omitempty"`
	ISIN                  string `json:"isin"`
	Name                  string `json:"name"`
	Ticker                string `json:"ticker,omitempty"`
	InstrumentType        string `json:"instrument_type"`
	Provider              string `json:"provider,omitempty"`
	IndexName             string `json:"index_name,omitempty"`
	InvestmentFocus       string `json:"investment_focus,omitempty"`
	AssetClass            string `json:"asset_class,omitempty"`
	Strategy              string `json:"strategy,omitempty"`
	CurrencyHedged        bool   `json:"currency_hedged"`
	Starred               bool   `json:"starred"`
	DataStatus            string `json:"data_status"`
	Distribution          string `json:"distribution"`
	Replication           string `json:"replication"`
	Domicile              string `json:"domicile,omitempty"`
	FundCurrency          string `json:"fund_currency"`
	TERBPS                int64  `json:"ter_bps"`
	FundSizeMillion       int64  `json:"fund_size_million"`
	InceptionDate         string `json:"inception_date,omitempty"`
	TrackingDifferenceBPS *int64 `json:"tracking_difference_bps"`
	TrackingErrorBPS      *int64 `json:"tracking_error_bps"`
	UCITS                 bool   `json:"ucits"`
	SourceURL             string `json:"source_url,omitempty"`
	RefreshedAt           string `json:"refreshed_at,omitempty"`
}

func ValidateInstrument(instrument Instrument) error {
	instrument.ISIN = strings.ToUpper(strings.TrimSpace(instrument.ISIN))
	if !ValidISIN(instrument.ISIN) {
		return errors.New("ISIN is invalid")
	}
	if strings.TrimSpace(instrument.Name) == "" {
		return errors.New("instrument name is required")
	}
	if instrument.InstrumentType != "" && !slices.Contains([]string{
		InstrumentTypeETF, InstrumentTypeETC, InstrumentTypeETN, InstrumentTypeETP, InstrumentTypeFund,
		InstrumentTypeStock, InstrumentTypeBond, InstrumentTypeCrypto, InstrumentTypeCommodity,
		InstrumentTypeRealEstate, InstrumentTypeOther,
	}, instrument.InstrumentType) {
		return errors.New("unsupported instrument type")
	}
	if instrument.DataStatus != "" && !slices.Contains([]string{InstrumentStatusCatalog, InstrumentStatusEnriched}, instrument.DataStatus) {
		return errors.New("instrument data status must be catalog or enriched")
	}
	if !slices.Contains([]string{DistributionAccumulating, DistributionDistributing}, instrument.Distribution) {
		return errors.New("distribution must be accumulating or distributing")
	}
	if !slices.Contains([]string{ReplicationPhysicalFull, ReplicationSampling, ReplicationSynthetic}, instrument.Replication) {
		return errors.New("unsupported replication method")
	}
	if len(strings.TrimSpace(instrument.FundCurrency)) != 3 {
		return errors.New("fund currency must be a three-letter code")
	}
	if instrument.Domicile != "" && len(strings.TrimSpace(instrument.Domicile)) != 2 {
		return errors.New("domicile must be a two-letter country code")
	}
	if instrument.TERBPS < 0 || instrument.TERBPS > 1_000 {
		return errors.New("TER must be between 0% and 10%")
	}
	if instrument.FundSizeMillion < 0 {
		return errors.New("fund size cannot be negative")
	}
	if instrument.InceptionDate != "" {
		if _, err := time.Parse(time.DateOnly, instrument.InceptionDate); err != nil {
			return errors.New("inception date must use YYYY-MM-DD")
		}
	}
	if instrument.RefreshedAt != "" {
		if _, err := time.Parse(time.RFC3339, instrument.RefreshedAt); err != nil {
			return errors.New("refreshed_at must use RFC3339")
		}
	}

	if instrument.SourceURL != "" {
		source, err := url.Parse(instrument.SourceURL)
		if err != nil || (source.Scheme != "http" && source.Scheme != "https") || source.Host == "" {
			return errors.New("source URL must be an absolute HTTP or HTTPS URL")
		}
	}
	return nil
}

// ClassifyInstrument derives a deliberately small set of comparison fields from catalog data.
func ClassifyInstrument(instrument *Instrument) {
	instrument.InstrumentType = ResolveInstrumentType(instrument.Name, instrument.InstrumentType)
	instrument.Provider = ResolveProvider(instrument.Name, instrument.Provider)
	focus := strings.TrimSpace(instrument.InvestmentFocus)
	text := strings.ToLower(strings.Join([]string{instrument.Name, instrument.IndexName, focus}, " "))
	first, _, _ := strings.Cut(focus, ",")
	switch strings.ToLower(strings.TrimSpace(first)) {
	case "equity", "stocks":
		instrument.AssetClass = "equity"
	case "bond", "bonds":
		instrument.AssetClass = "bond"
	case "money market":
		instrument.AssetClass = "monetary"
	case "commodity", "commodities", "precious metals":
		instrument.AssetClass = "commodity"
	case "real estate", "property":
		instrument.AssetClass = "real_estate"
	case "crypto", "cryptocurrency":
		instrument.AssetClass = "crypto"
	case "mixed", "multi asset", "multi-asset":
		instrument.AssetClass = "mixed"
	default:
		switch {
		case instrument.InstrumentType == InstrumentTypeBond || containsAny(text, " bond", "bonds", "treasury", "fixed income"):
			instrument.AssetClass = "bond"
		case instrument.InstrumentType == InstrumentTypeStock:
			instrument.AssetClass = "equity"
		case instrument.InstrumentType == InstrumentTypeCommodity || instrument.InstrumentType == InstrumentTypeETC || containsAny(text, "gold", "silver", "commodity"):
			instrument.AssetClass = "commodity"
		case containsAny(text, "money market"):
			instrument.AssetClass = "monetary"
		default:
			instrument.AssetClass = "other"
		}
	}

	nameLower := strings.ToLower(instrument.Name)
	switch {
	case containsWord(text, "active", "actively", "actively managed") || strings.HasPrefix(nameLower, "avantis"):
		instrument.Strategy = "active"
	case containsAny(text, "esg", "sri", "climate", "paris-aligned", "screened", "sustainable", "low carbon"):
		instrument.Strategy = "esg"
	case containsAny(text, "dividend", "income"):
		instrument.Strategy = "dividend"
	case containsAny(text, "momentum", "quality", "minimum volatility", "min volatility", "equal weight", "multi-factor", "multifactor", "value factor"):
		instrument.Strategy = "factor"
	default:
		instrument.Strategy = "broad"
	}
}

// ResolveProvider normalizes provider names and infers known issuers from security names.
func ResolveProvider(name, current string) string {
	nameLower := strings.ToLower(strings.TrimSpace(name))
	currentTrimmed := strings.TrimSpace(current)
	currentLower := strings.ToLower(currentTrimmed)

	// Avantis ETFs are managed under American Century Investments; normalize to Avantis for search & filters.
	if strings.HasPrefix(nameLower, "avantis") || currentLower == "american century" || strings.Contains(nameLower, "avantis ") {
		return "Avantis"
	}
	if currentTrimmed != "" {
		return currentTrimmed
	}

	prefixes := []struct {
		prefix   string
		provider string
	}{
		{"avantis", "Avantis"},
		{"ishares", "iShares"},
		{"vanguard", "Vanguard"},
		{"xtrackers", "Xtrackers"},
		{"amundi", "Amundi ETF"},
		{"invesco", "Invesco"},
		{"spdr", "State Street"},
		{"state street", "State Street"},
		{"wisdomtree", "WisdomTree"},
		{"vaneck", "VanEck"},
		{"global x", "Global X"},
		{"franklin", "Franklin Templeton"},
		{"bnp paribas", "BNP Paribas Easy"},
		{"hsbc", "HSBC ETF"},
		{"ubs", "UBS ETF"},
		{"deka", "Deka ETFs"},
		{"fidelity", "Fidelity ETF"},
		{"first trust", "First Trust"},
		{"jpmorgan", "J.P. Morgan"},
		{"j.p. morgan", "J.P. Morgan"},
		{"pimco", "PIMCO"},
		{"dimensional", "Dimensional"},
		{"coinshares", "CoinShares"},
		{"janus henderson", "Janus Henderson"},
		{"pictet", "Pictet"},
		{"calamos", "Calamos"},
		{"erste", "ERSTE ETF"},
		{"leonteq", "Leonteq"},
		{"21shares", "21shares"},
		{"bitwise", "Bitwise"},
		{"robeco", "Robeco"},
		{"schroder", "Schroder"},
		{"ossiam", "Ossiam"},
		{"kraneshares", "KraneShares"},
		{"goldman sachs", "Goldman Sachs"},
		{"hanetf", "HANetf"},
		{"legal & general", "Legal & General (LGIM)"},
		{"lgim", "Legal & General (LGIM)"},
		{"leverage shares", "Leverage Shares"},
	}

	for _, p := range prefixes {
		if strings.HasPrefix(nameLower, p.prefix) {
			return p.provider
		}
	}
	return currentTrimmed
}

// ResolveInstrumentType corrects legacy ETF defaults and generic ETP labels,
// while preserving explicitly supplied narrower types and other asset wrappers.
func ResolveInstrumentType(name, current string) string {
	inferred := InferInstrumentType(name)
	if current == "" || current == InstrumentTypeETF && inferred != InstrumentTypeETF || current == InstrumentTypeETP && (inferred == InstrumentTypeETC || inferred == InstrumentTypeETN) {
		return inferred
	}
	return current
}

func InferInstrumentType(name string) string {
	words := strings.FieldsFunc(strings.ToUpper(name), func(r rune) bool { return r < 'A' || r > 'Z' })
	if slices.Contains(words, "ETC") {
		return InstrumentTypeETC
	}
	if slices.Contains(words, "ETN") {
		return InstrumentTypeETN
	}
	if slices.Contains(words, "ETP") && !slices.Contains(words, "ETF") {
		return InstrumentTypeETP
	}
	return InstrumentTypeETF
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func containsWord(text string, targets ...string) bool {
	for _, target := range targets {
		target = strings.ToLower(target)
		idx := 0
		for {
			pos := strings.Index(text[idx:], target)
			if pos == -1 {
				break
			}
			start := idx + pos
			end := start + len(target)
			leftOk := (start == 0 || !isAlphaNum(rune(text[start-1])))
			rightOk := (end == len(text) || !isAlphaNum(rune(text[end])))
			if leftOk && rightOk {
				return true
			}
			idx = start + 1
		}
	}
	return false
}

func isAlphaNum(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
}

type InstrumentAlternative struct {
	Instrument Instrument `json:"instrument"`
	Match      string     `json:"match"`
	Better     bool       `json:"better"`
	Score      float64    `json:"score"`
	Reasons    []string   `json:"reasons"`
}

func FindInstrumentAlternatives(selected Instrument, instruments []Instrument, asOf time.Time) []InstrumentAlternative {
	if !isETF(selected) || selected.DataStatus != InstrumentStatusEnriched || !selected.UCITS || selected.AssetClass == "" || selected.AssetClass == "other" {
		return nil
	}
	selectedIndex, selectedFocus := comparisonKey(selected.IndexName), comparisonKey(selected.InvestmentFocus)
	var alternatives []InstrumentAlternative
	for _, candidate := range instruments {
		if !isETF(candidate) || candidate.ID == selected.ID || candidate.ISIN == selected.ISIN || candidate.DataStatus != InstrumentStatusEnriched || !candidate.UCITS || candidate.AssetClass != selected.AssetClass {
			continue
		}
		match := ""
		if selectedIndex != "" && comparisonKey(candidate.IndexName) == selectedIndex && candidate.CurrencyHedged == selected.CurrencyHedged {
			match = "exact_index"
		} else if selectedFocus != "" && comparisonKey(candidate.InvestmentFocus) == selectedFocus && candidate.Strategy == selected.Strategy && candidate.CurrencyHedged == selected.CurrencyHedged {
			match = "same_exposure"
		}
		if match == "" {
			continue
		}
		var reasons []string
		if match == "exact_index" {
			reasons = append(reasons, fmt.Sprintf("Tracks same index (%s)", candidate.IndexName))
		} else {
			reasons = append(reasons, fmt.Sprintf("Same exposure (%s · %s)", candidate.InvestmentFocus, candidate.AssetClass))
		}

		terDiff := float64(selected.TERBPS-candidate.TERBPS) / 100.0
		if terDiff > 0 {
			yearlySavings := terDiff * 100.0 // € saved per €10k invested
			reasons = append(reasons, fmt.Sprintf("Saves €%.0f/yr per €10k (TER %.2f%% vs %.2f%%)", yearlySavings, float64(candidate.TERBPS)/100, float64(selected.TERBPS)/100))
		} else if terDiff < 0 {
			reasons = append(reasons, fmt.Sprintf("Higher TER (%.2f%% vs %.2f%%)", float64(candidate.TERBPS)/100, float64(selected.TERBPS)/100))
		} else {
			reasons = append(reasons, fmt.Sprintf("Identical TER (%.2f%%)", float64(candidate.TERBPS)/100))
		}

		if selected.FundSizeMillion > 0 && candidate.FundSizeMillion >= int64(float64(selected.FundSizeMillion)*1.5) {
			ratio := float64(candidate.FundSizeMillion) / float64(selected.FundSizeMillion)
			reasons = append(reasons, fmt.Sprintf("%.1fx larger fund (€%dm vs €%dm)", ratio, candidate.FundSizeMillion, selected.FundSizeMillion))
		} else {
			reasons = append(reasons, fmt.Sprintf("Fund size €%dm vs €%dm", candidate.FundSizeMillion, selected.FundSizeMillion))
		}

		if candidate.TrackingDifferenceBPS != nil && selected.TrackingDifferenceBPS != nil {
			candTD := float64(*candidate.TrackingDifferenceBPS) / 100.0
			selTD := float64(*selected.TrackingDifferenceBPS) / 100.0
			if candTD < selTD {
				reasons = append(reasons, fmt.Sprintf("Lower tracking diff (%.2f%% vs %.2f%%)", candTD, selTD))
			}
		}

		if candidate.Distribution != selected.Distribution {
			reasons = append(reasons, fmt.Sprintf("Distribution: %s (vs %s)", candidate.Distribution, selected.Distribution))
		}
		if candidate.Replication != selected.Replication {
			reasons = append(reasons, fmt.Sprintf("Replication: %s (vs %s)", candidate.Replication, selected.Replication))
		}

		better := candidate.TERBPS <= selected.TERBPS && candidate.FundSizeMillion >= selected.FundSizeMillion && (candidate.TERBPS < selected.TERBPS || candidate.FundSizeMillion > selected.FundSizeMillion) && candidate.Distribution == selected.Distribution && candidate.Replication == selected.Replication
		alternatives = append(alternatives, InstrumentAlternative{Instrument: candidate, Match: match, Better: better, Score: alternativeScore(selected, candidate, asOf), Reasons: reasons})
	}
	slices.SortFunc(alternatives, func(a, b InstrumentAlternative) int {
		if a.Match != b.Match {
			if a.Match == "exact_index" {
				return -1
			}
			return 1
		}
		if a.Better != b.Better {
			if a.Better {
				return -1
			}
			return 1
		}
		if a.Score != b.Score {
			if a.Score > b.Score {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Instrument.ISIN, b.Instrument.ISIN)
	})
	return alternatives
}

func comparisonKey(value string) string {
	return strings.Join(strings.FieldsFunc(strings.ToLower(strings.TrimSpace(value)), func(char rune) bool {
		return !((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9'))
	}), " ")
}

func alternativeScore(selected, candidate Instrument, asOf time.Time) float64 {
	score := 50 + float64(selected.TERBPS-candidate.TERBPS)

	// Fund size score difference with diminishing returns capped at €3B (so €20B vs €50B gives 0 bonus)
	candSize := math.Log10(float64(max(min(candidate.FundSizeMillion, 3000), 1)))
	selSize := math.Log10(float64(max(min(selected.FundSizeMillion, 3000), 1)))
	score += 10 * (candSize - selSize)

	// Age score difference with diminishing returns capped at 10 years (so 10y vs 20y gives 0 bonus)
	candAge := math.Log10(1 + min(max(ageYears(candidate.InceptionDate, asOf), 0), 10.0))
	selAge := math.Log10(1 + min(max(ageYears(selected.InceptionDate, asOf), 0), 10.0))
	score += 5 * (candAge - selAge)

	if candidate.Distribution == selected.Distribution {
		score += 3
	} else {
		score -= 3
	}
	if candidate.Replication == selected.Replication {
		score += 2
	} else {
		score -= 2
	}
	return math.Round(score*10) / 10
}

type RankWeights struct {
	Cost               float64 `json:"cost"`
	TrackingDifference float64 `json:"tracking_difference"`
	TrackingError      float64 `json:"tracking_error"`
	Size               float64 `json:"size"`
	Age                float64 `json:"age"`
}

type RankCriteria struct {
	IndexQuery         string      `json:"index_query,omitempty"`
	Distribution       string      `json:"distribution,omitempty"`
	Distributions      []string    `json:"distributions,omitempty"`
	Replications       []string    `json:"replications,omitempty"`
	Domiciles          []string    `json:"domiciles,omitempty"`
	AssetClasses       []string    `json:"asset_classes,omitempty"`
	FundCurrencies     []string    `json:"fund_currencies,omitempty"`
	Providers          []string    `json:"providers,omitempty"`
	CurrencyHedged     *bool       `json:"currency_hedged,omitempty"`
	MaxTERBPS          *int64      `json:"max_ter_bps"`
	MinFundSizeMillion int64       `json:"min_fund_size_million"`
	MinAgeYears        int         `json:"min_age_years"`
	Weights            RankWeights `json:"weights"`
}

type Score struct {
	Instrument         Instrument `json:"instrument"`
	Total              float64    `json:"total"`
	Cost               float64    `json:"cost"`
	TrackingDifference float64    `json:"tracking_difference"`
	TrackingError      float64    `json:"tracking_error"`
	Size               float64    `json:"size"`
	Age                float64    `json:"age"`
}

func RankInstruments(instruments []Instrument, criteria RankCriteria, asOf time.Time) ([]Score, error) {
	if criteria.Distribution != "" && !slices.Contains([]string{DistributionAccumulating, DistributionDistributing}, criteria.Distribution) {
		return nil, errors.New("unsupported distribution policy")
	}
	for _, dist := range criteria.Distributions {
		if !slices.Contains([]string{DistributionAccumulating, DistributionDistributing}, dist) {
			return nil, errors.New("unsupported distribution policy")
		}
	}
	for _, replication := range criteria.Replications {
		if !slices.Contains([]string{ReplicationPhysicalFull, ReplicationSampling, ReplicationSynthetic}, replication) {
			return nil, errors.New("unsupported replication method")
		}
	}
	if criteria.MinFundSizeMillion < 0 || criteria.MinAgeYears < 0 {
		return nil, errors.New("minimum size and age cannot be negative")
	}
	if criteria.MaxTERBPS != nil && (*criteria.MaxTERBPS < 0 || *criteria.MaxTERBPS > 1_000) {
		return nil, errors.New("maximum TER must be between 0% and 10%")
	}
	weights := criteria.Weights
	if weights == (RankWeights{}) {
		weights = RankWeights{Cost: 35, TrackingDifference: 30, TrackingError: 15, Size: 15, Age: 5}
	}
	totalWeight := weights.Cost + weights.TrackingDifference + weights.TrackingError + weights.Size + weights.Age
	if totalWeight <= 0 || weights.Cost < 0 || weights.TrackingDifference < 0 || weights.TrackingError < 0 || weights.Size < 0 || weights.Age < 0 {
		return nil, errors.New("ranking weights must be non-negative and total more than zero")
	}

	var ranked []Score
	for _, instrument := range instruments {
		if !matches(instrument, criteria, asOf) {
			continue
		}
		age := ageYears(instrument.InceptionDate, asOf)
		score := Score{
			Instrument: instrument,
			Cost:       clamp01(1 - float64(instrument.TERBPS)/100),
			Size:       clamp01(math.Log10(float64(max(instrument.FundSizeMillion, 1))) / 3.5),
			Age:        clamp01(math.Log10(1+min(max(age, 0), 10.0)) / math.Log10(11)),
		}
		if instrument.TrackingDifferenceBPS != nil {
			tdBps := float64(*instrument.TrackingDifferenceBPS)
			if tdBps <= 0 {
				score.TrackingDifference = clamp01(1 - max(0, -tdBps-30)/100)
			} else {
				score.TrackingDifference = clamp01(1 - tdBps/100)
			}
		}
		if instrument.TrackingErrorBPS != nil {
			score.TrackingError = clamp01(1 - math.Abs(float64(*instrument.TrackingErrorBPS))/100)
		}
		score.Total = 100 * (score.Cost*weights.Cost + score.TrackingDifference*weights.TrackingDifference + score.TrackingError*weights.TrackingError + score.Size*weights.Size + score.Age*weights.Age) / totalWeight
		ranked = append(ranked, score)
	}
	slices.SortFunc(ranked, func(a, b Score) int {
		if a.Total != b.Total {
			if a.Total > b.Total {
				return -1
			}
			return 1
		}
		if a.Instrument.TERBPS != b.Instrument.TERBPS {
			return cmp.Compare(a.Instrument.TERBPS, b.Instrument.TERBPS)
		}
		if a.Instrument.FundSizeMillion != b.Instrument.FundSizeMillion {
			return cmp.Compare(b.Instrument.FundSizeMillion, a.Instrument.FundSizeMillion)
		}
		return strings.Compare(a.Instrument.ISIN, b.Instrument.ISIN)
	})
	return ranked, nil
}

func matches(instrument Instrument, criteria RankCriteria, asOf time.Time) bool {
	if !isETF(instrument) || !instrument.UCITS || instrument.DataStatus == InstrumentStatusCatalog {
		return false
	}
	if criteria.IndexQuery != "" {
		iq := strings.ToLower(strings.TrimSpace(criteria.IndexQuery))
		if !strings.Contains(strings.ToLower(instrument.IndexName), iq) &&
			!strings.Contains(strings.ToLower(instrument.InvestmentFocus), iq) &&
			!strings.Contains(strings.ToLower(instrument.Name), iq) &&
			!strings.Contains(strings.ToLower(instrument.Ticker), iq) {
			return false
		}
	}
	if len(criteria.Distributions) > 0 {
		if !slices.Contains(criteria.Distributions, instrument.Distribution) {
			return false
		}
	} else if criteria.Distribution != "" && instrument.Distribution != criteria.Distribution {
		return false
	}
	if len(criteria.Replications) > 0 && !slices.Contains(criteria.Replications, instrument.Replication) {
		return false
	}
	if len(criteria.AssetClasses) > 0 {
		match := false
		for _, ac := range criteria.AssetClasses {
			if strings.EqualFold(ac, instrument.AssetClass) {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}
	if len(criteria.FundCurrencies) > 0 {
		match := false
		for _, c := range criteria.FundCurrencies {
			if strings.EqualFold(c, instrument.FundCurrency) {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}
	if len(criteria.Providers) > 0 {
		match := false
		for _, p := range criteria.Providers {
			if strings.EqualFold(p, instrument.Provider) {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}
	if criteria.CurrencyHedged != nil && instrument.CurrencyHedged != *criteria.CurrencyHedged {
		return false
	}
	if len(criteria.Domiciles) > 0 {
		found := false
		for _, domicile := range criteria.Domiciles {
			if strings.EqualFold(domicile, instrument.Domicile) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if criteria.MaxTERBPS != nil && instrument.TERBPS > *criteria.MaxTERBPS {
		return false
	}
	if instrument.FundSizeMillion < criteria.MinFundSizeMillion {
		return false
	}
	return ageYears(instrument.InceptionDate, asOf) >= float64(criteria.MinAgeYears)
}

func isETF(instrument Instrument) bool {
	return instrument.InstrumentType == "" || instrument.InstrumentType == InstrumentTypeETF
}

func ageYears(date string, asOf time.Time) float64 {
	if date == "" {
		return 0
	}
	started, err := time.Parse(time.DateOnly, date)
	if err != nil || started.After(asOf) {
		return 0
	}
	return asOf.Sub(started).Hours() / 24 / 365.2425
}

func clamp01(value float64) float64 { return min(max(value, 0), 1) }

func ValidISIN(isin string) bool {
	if len(isin) != 12 {
		return false
	}
	if isin[0] < 'A' || isin[0] > 'Z' || isin[1] < 'A' || isin[1] > 'Z' || isin[11] < '0' || isin[11] > '9' {
		return false
	}
	var digits strings.Builder
	for i, char := range isin {
		switch {
		case char >= '0' && char <= '9' && i >= 2:
			digits.WriteRune(char)
		case char >= 'A' && char <= 'Z':
			digits.WriteString(strconv.Itoa(int(char-'A') + 10))
		default:
			return false
		}
	}
	expanded := digits.String()
	var sum int
	for i, position := len(expanded)-1, 0; i >= 0; i, position = i-1, position+1 {
		digit := int(expanded[i] - '0')
		if position%2 == 1 {
			digit *= 2
		}
		sum += digit/10 + digit%10
	}
	return sum%10 == 0
}

type PerformancePoint struct {
	Date      string
	ChangeBPS int64
}

type PerformanceMeta struct {
	ISIN       string
	FetchedAt  string
	PointCount int
}
