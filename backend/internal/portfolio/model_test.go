package portfolio

import (
	"testing"
	"time"
)

func TestCalculateRevenueAcrossTiers(t *testing.T) {
	limit := int64(5_000_000)
	fixed := int64(300)
	account := Account{
		Name: "Cash", Currency: "EUR", BalanceMinor: 7_000_000,
		TaxBPS: 2500, AnnualFeeMinor: 1200,
		Tiers: []InterestTier{
			{UpToMinor: &limit, FixedRateBPS: &fixed},
			{ReferenceCode: "ECB_DFR"},
		},
	}
	revenue, tiers, err := CalculateRevenue(account, map[string]int64{"ECB_DFR": 200})
	if err != nil {
		t.Fatal(err)
	}
	if revenue.GrossMinor != 190_000 || revenue.TaxMinor != 47_500 || revenue.NetMinor != 141_300 {
		t.Fatalf("unexpected revenue: %+v", revenue)
	}
	if tiers[1].ResolvedRateBPS != 200 {
		t.Fatalf("reference rate was not resolved: %+v", tiers[1])
	}
}

func TestRankInstrumentsFiltersAndExplainsScore(t *testing.T) {
	tdA, teA, tdB, teB := int64(-5), int64(8), int64(-20), int64(25)
	instruments := []Instrument{
		{ISIN: "IE0000000001", Name: "Lean", Distribution: DistributionAccumulating, Replication: ReplicationPhysicalFull, FundCurrency: "EUR", Domicile: "IE", TERBPS: 12, FundSizeMillion: 2_000, InceptionDate: "2015-01-01", TrackingDifferenceBPS: &tdA, TrackingErrorBPS: &teA, UCITS: true, DataStatus: InstrumentStatusEnriched},
		{ISIN: "LU0000000002", Name: "Costly", Distribution: DistributionAccumulating, Replication: ReplicationPhysicalFull, FundCurrency: "EUR", Domicile: "LU", TERBPS: 30, FundSizeMillion: 500, InceptionDate: "2020-01-01", TrackingDifferenceBPS: &tdB, TrackingErrorBPS: &teB, UCITS: true, DataStatus: InstrumentStatusEnriched},
		{ISIN: "IE0000000003", Name: "Synthetic", Distribution: DistributionAccumulating, Replication: ReplicationSynthetic, FundCurrency: "EUR", Domicile: "IE", TERBPS: 5, FundSizeMillion: 5_000, InceptionDate: "2010-01-01", UCITS: true, DataStatus: InstrumentStatusEnriched},
	}
	maxTER := int64(40)
	ranked, err := RankInstruments(instruments, RankCriteria{Distribution: DistributionAccumulating, Replications: []string{ReplicationPhysicalFull}, MaxTERBPS: &maxTER, MinFundSizeMillion: 100, MinAgeYears: 3}, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(ranked) != 2 || ranked[0].Instrument.Name != "Lean" || ranked[0].Total <= ranked[1].Total {
		t.Fatalf("unexpected ranking: %+v", ranked)
	}
}

func TestRankInstrumentsWithAssetClassAndDistributions(t *testing.T) {
	instruments := []Instrument{
		{ISIN: "IE0000000001", Name: "World Acc", AssetClass: "equity", Distribution: DistributionAccumulating, Replication: ReplicationPhysicalFull, FundCurrency: "EUR", Domicile: "IE", TERBPS: 15, FundSizeMillion: 2000, InceptionDate: "2015-01-01", UCITS: true, DataStatus: InstrumentStatusEnriched},
		{ISIN: "IE0000000002", Name: "World Dist", AssetClass: "equity", Distribution: DistributionDistributing, Replication: ReplicationPhysicalFull, FundCurrency: "EUR", Domicile: "IE", TERBPS: 15, FundSizeMillion: 1500, InceptionDate: "2015-01-01", UCITS: true, DataStatus: InstrumentStatusEnriched},
		{ISIN: "LU0000000003", Name: "Euro Bond Acc", AssetClass: "bond", Distribution: DistributionAccumulating, Replication: ReplicationPhysicalFull, FundCurrency: "EUR", Domicile: "LU", TERBPS: 10, FundSizeMillion: 1000, InceptionDate: "2018-01-01", UCITS: true, DataStatus: InstrumentStatusEnriched},
	}

	// 1. Exclude Dist by selecting only Accumulating
	ranked, err := RankInstruments(instruments, RankCriteria{Distributions: []string{DistributionAccumulating}}, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(ranked) != 2 {
		t.Fatalf("expected 2 accumulating instruments, got %d", len(ranked))
	}
	for _, r := range ranked {
		if r.Instrument.Distribution != DistributionAccumulating {
			t.Fatalf("expected only accumulating, got %s", r.Instrument.Distribution)
		}
	}

	// 2. Filter by Asset Class = "bond"
	rankedBond, err := RankInstruments(instruments, RankCriteria{AssetClasses: []string{"bond"}}, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(rankedBond) != 1 || rankedBond[0].Instrument.Name != "Euro Bond Acc" {
		t.Fatalf("expected only Euro Bond Acc, got %+v", rankedBond)
	}
}

func TestValidateInstrumentChecksISIN(t *testing.T) {
	instrument := Instrument{ISIN: "IE00B4L5Y983", Name: "World", Distribution: DistributionAccumulating, Replication: ReplicationSampling, FundCurrency: "USD"}
	if err := ValidateInstrument(instrument); err != nil {
		t.Fatal(err)
	}
	instrument.ISIN = "IE00B4L5Y984"
	if err := ValidateInstrument(instrument); err == nil {
		t.Fatal("expected invalid check digit")
	}
}

func TestFindInstrumentAlternativesKeepsComparableExposure(t *testing.T) {
	selected := Instrument{ID: 1, ISIN: "IE00BK5BQT80", Name: "Vanguard FTSE All-World", IndexName: "FTSE All-World", InvestmentFocus: "Equity, World", AssetClass: "equity", Strategy: "broad", Distribution: DistributionAccumulating, Replication: ReplicationSampling, TERBPS: 22, FundSizeMillion: 10_000, InceptionDate: "2019-01-01", UCITS: true, DataStatus: InstrumentStatusEnriched}
	instruments := []Instrument{
		selected,
		{ID: 2, ISIN: "IE00B3RBWM25", Name: "Same index", IndexName: "FTSE All World", InvestmentFocus: "Equity, World", AssetClass: "equity", Strategy: "broad", Distribution: DistributionAccumulating, Replication: ReplicationSampling, TERBPS: 20, FundSizeMillion: 15_000, InceptionDate: "2012-01-01", UCITS: true, DataStatus: InstrumentStatusEnriched},
		{ID: 3, ISIN: "IE00B6R52259", Name: "Similar exposure", IndexName: "MSCI ACWI", InvestmentFocus: "Equity, World", AssetClass: "equity", Strategy: "broad", Distribution: DistributionAccumulating, Replication: ReplicationSampling, TERBPS: 18, FundSizeMillion: 5_000, InceptionDate: "2011-01-01", UCITS: true, DataStatus: InstrumentStatusEnriched},
		{ID: 4, Name: "FTSE 100", IndexName: "FTSE 100", InvestmentFocus: "Equity, United Kingdom", AssetClass: "equity", Strategy: "broad", UCITS: true, DataStatus: InstrumentStatusEnriched},
		{ID: 5, Name: "Global bonds", IndexName: "Bloomberg Global Aggregate", InvestmentFocus: "Bonds, World, Aggregate", AssetClass: "bond", Strategy: "broad", UCITS: true, DataStatus: InstrumentStatusEnriched},
	}
	got := FindInstrumentAlternatives(selected, instruments, time.Date(2026, 8, 21, 0, 0, 0, 0, time.UTC))
	if len(got) != 2 || got[0].Instrument.ID != 2 || got[0].Match != "exact_index" || !got[0].Better || got[1].Instrument.ID != 3 || got[1].Match != "same_exposure" {
		t.Fatalf("unexpected alternatives: %+v", got)
	}
}

func TestClassifyInstrument(t *testing.T) {
	instrument := Instrument{Name: "Global Aggregate Bond EUR Hedged", IndexName: "Bloomberg Global Aggregate", InvestmentFocus: "Bonds, World, Aggregate, All maturities", CurrencyHedged: true}
	ClassifyInstrument(&instrument)
	if instrument.AssetClass != "bond" || instrument.Strategy != "broad" {
		t.Fatalf("unexpected classification: %+v", instrument)
	}
	activeInst := Instrument{Name: "JPMorgan Active Global Aggregate Bond UCITS ETF", InstrumentType: InstrumentTypeETF}
	ClassifyInstrument(&activeInst)
	if activeInst.Strategy != "active" {
		t.Fatalf("active ETF classified as %q, expected 'active'", activeInst.Strategy)
	}
	catalog := Instrument{Name: "Vanguard Global Government Bond UCITS ETF", InstrumentType: InstrumentTypeETF}
	ClassifyInstrument(&catalog)
	if catalog.AssetClass != "bond" {
		t.Fatalf("catalog bond classified as %q", catalog.AssetClass)
	}

	// Solactive index passive fund must NOT be falsely classified as active
	solactiveInst := Instrument{Name: "UBS Solactive Global Pure Gold Miners UCITS ETF USD dis", InstrumentType: InstrumentTypeETF}
	ClassifyInstrument(&solactiveInst)
	if solactiveInst.Strategy == "active" {
		t.Fatalf("Solactive index fund incorrectly classified as active: strategy=%q", solactiveInst.Strategy)
	}

	// Avantis fund must have Provider "Avantis" and Strategy "active" even if scraper saw "American Century"
	avantisInst := Instrument{
		Name:           "Avantis Global Small Cap Value UCITS ETF USD Acc",
		Provider:       "American Century",
		InstrumentType: InstrumentTypeETF,
	}
	ClassifyInstrument(&avantisInst)
	if avantisInst.Provider != "Avantis" {
		t.Fatalf("expected provider 'Avantis', got %q", avantisInst.Provider)
	}
	if avantisInst.Strategy != "active" {
		t.Fatalf("expected strategy 'active' for Avantis fund, got %q", avantisInst.Strategy)
	}

	// Provider inference from name when provider is empty
	isharesInst := Instrument{Name: "iShares Core MSCI World UCITS ETF", InstrumentType: InstrumentTypeETF}
	ClassifyInstrument(&isharesInst)
	if isharesInst.Provider != "iShares" {
		t.Fatalf("expected inferred provider 'iShares', got %q", isharesInst.Provider)
	}
}

func TestAlternativesRespectHedgingForSameIndex(t *testing.T) {
	selected := Instrument{ID: 1, ISIN: "IE00B4L5Y983", Name: "World", InstrumentType: "etf", DataStatus: "enriched", UCITS: true, AssetClass: "equity", IndexName: "World", Distribution: "accumulating", Replication: "physical_full", TERBPS: 20, FundSizeMillion: 100}
	candidate := selected
	candidate.ID, candidate.ISIN, candidate.TERBPS, candidate.CurrencyHedged = 2, "IE00B579F325", 10, true
	if got := FindInstrumentAlternatives(selected, []Instrument{candidate}, time.Now()); len(got) != 0 {
		t.Fatalf("different hedge classified as a strict peer: %+v", got)
	}
}

func TestAlternativeScoreDiminishingReturns(t *testing.T) {
	asOf := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	selected := Instrument{
		ID:              1,
		ISIN:            "IE00B4L5Y983",
		Name:            "World Baseline",
		InstrumentType:  "etf",
		DataStatus:      "enriched",
		UCITS:           true,
		Distribution:    DistributionAccumulating,
		Replication:     ReplicationPhysicalFull,
		TERBPS:          20,
		FundSizeMillion: 20_000,      // €20B
		InceptionDate:   "2016-01-01", // 10 years old
	}
	// Candidate 1: €20B, 10y old
	cand1 := selected
	cand1.ID, cand1.ISIN = 2, "IE00B2222222"

	// Candidate 2: €50B, 20y old (both size and age well past the established saturation thresholds)
	cand2 := selected
	cand2.ID, cand2.ISIN = 3, "IE00B3333333"
	cand2.FundSizeMillion = 50_000 // €50B
	cand2.InceptionDate = "2006-01-01" // 20 years old

	score1 := alternativeScore(selected, cand1, asOf)
	score2 := alternativeScore(selected, cand2, asOf)

	if score1 != score2 {
		t.Fatalf("expected identical score for 20B/10y and 50B/20y due to diminishing returns, got score1=%.1f, score2=%.1f", score1, score2)
	}
}
