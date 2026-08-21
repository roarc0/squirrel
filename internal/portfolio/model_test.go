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
	catalog := Instrument{Name: "Vanguard Global Government Bond UCITS ETF", InstrumentType: InstrumentTypeETF}
	ClassifyInstrument(&catalog)
	if catalog.AssetClass != "bond" {
		t.Fatalf("catalog bond classified as %q", catalog.AssetClass)
	}
}
