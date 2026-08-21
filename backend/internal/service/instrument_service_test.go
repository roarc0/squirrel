package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	"loot/backend/internal/portfolio"
	"loot/backend/internal/store"
	portv1 "loot/proto/gen/go/v1"
)

func TestListInstrumentsSorting(t *testing.T) {
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	ctx := context.Background()

	inst1 := portfolio.Instrument{
		ISIN:            "US0378331005",
		Name:            "Apple Inc",
		InstrumentType:  "etf",
		Distribution:    portfolio.DistributionAccumulating,
		Replication:     portfolio.ReplicationPhysicalFull,
		TERBPS:          20,
		FundSizeMillion: 50000,
		DataStatus:      portfolio.InstrumentStatusEnriched,
		FundCurrency:    "EUR",
		UCITS:           true,
	}
	inst2 := portfolio.Instrument{
		ISIN:            "DE0005140008",
		Name:            "Deutsche Bank AG",
		InstrumentType:  "etf",
		Distribution:    portfolio.DistributionAccumulating,
		Replication:     portfolio.ReplicationPhysicalFull,
		TERBPS:          22,
		FundSizeMillion: 20000,
		DataStatus:      portfolio.InstrumentStatusEnriched,
		FundCurrency:    "USD",
		UCITS:           true,
	}

	if err := st.SaveInstrument(ctx, &inst1); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveInstrument(ctx, &inst2); err != nil {
		t.Fatal(err)
	}

	srv := &Server{store: st, baseCurrency: "EUR", taxRates: nil}

	// Test sort by TER asc
	sortParam := "ter:asc"
	res, err := srv.ListInstruments(ctx, connect.NewRequest(&portv1.ListInstrumentsRequest{Sort: &sortParam}))
	if err != nil {
		t.Fatalf("ListInstruments ter:asc: %v", err)
	}
	if len(res.Msg.Instruments) != 2 || res.Msg.Instruments[0].Isin != "US0378331005" {
		t.Fatalf("Expected US0378331005 first for ter:asc, got: %s", res.Msg.Instruments[0].Isin)
	}

	// Test sort by TER desc
	sortParamDesc := "ter:desc"
	resDesc, err := srv.ListInstruments(ctx, connect.NewRequest(&portv1.ListInstrumentsRequest{Sort: &sortParamDesc}))
	if err != nil {
		t.Fatalf("ListInstruments ter:desc: %v", err)
	}
	if len(resDesc.Msg.Instruments) != 2 || resDesc.Msg.Instruments[0].Isin != "DE0005140008" {
		t.Fatalf("Expected DE0005140008 first for ter:desc, got: %s", resDesc.Msg.Instruments[0].Isin)
	}

	// Test sort by assetClass alias
	sortAsset := "assetClass:asc"
	_, errAsset := srv.ListInstruments(ctx, connect.NewRequest(&portv1.ListInstrumentsRequest{Sort: &sortAsset}))
	if errAsset != nil {
		t.Fatalf("ListInstruments assetClass:asc should succeed, got: %v", errAsset)
	}
}
