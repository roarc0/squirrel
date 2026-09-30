package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	"github.com/roarc0/squirrel/backend/internal/auth"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	"github.com/roarc0/squirrel/backend/internal/store"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
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

func TestPerUserInstrumentStars(t *testing.T) {
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	ctxUser1 := auth.WithUser(context.Background(), auth.User{GoogleID: "user_1"})
	ctxUser2 := auth.WithUser(context.Background(), auth.User{GoogleID: "user_2"})

	inst1 := portfolio.Instrument{
		ISIN:            "IE00BK5BQT80",
		Name:            "Vanguard FTSE All-World",
		InstrumentType:  "etf",
		Distribution:    portfolio.DistributionAccumulating,
		Replication:     portfolio.ReplicationPhysicalFull,
		TERBPS:          22,
		FundSizeMillion: 10000,
		DataStatus:      portfolio.InstrumentStatusEnriched,
		FundCurrency:    "USD",
		UCITS:           true,
	}
	inst2 := portfolio.Instrument{
		ISIN:            "IE00B4L5Y983",
		Name:            "iShares Core MSCI World",
		InstrumentType:  "etf",
		Distribution:    portfolio.DistributionAccumulating,
		Replication:     portfolio.ReplicationPhysicalFull,
		TERBPS:          20,
		FundSizeMillion: 60000,
		DataStatus:      portfolio.InstrumentStatusEnriched,
		FundCurrency:    "USD",
		UCITS:           true,
	}

	if err := st.SaveInstrument(context.Background(), &inst1); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveInstrument(context.Background(), &inst2); err != nil {
		t.Fatal(err)
	}

	srv := &Server{store: st, baseCurrency: "EUR"}

	// User 1 stars inst1
	_, err = srv.StarInstrument(ctxUser1, connect.NewRequest(&portv1.StarInstrumentRequest{
		Isin:    inst1.ISIN,
		Starred: true,
	}))
	if err != nil {
		t.Fatalf("User 1 star failed: %v", err)
	}

	// User 2 stars inst2
	_, err = srv.StarInstrument(ctxUser2, connect.NewRequest(&portv1.StarInstrumentRequest{
		Isin:    inst2.ISIN,
		Starred: true,
	}))
	if err != nil {
		t.Fatalf("User 2 star failed: %v", err)
	}

	// User 1 lists instruments: inst1 is starred, inst2 is NOT starred
	res1, err := srv.ListInstruments(ctxUser1, connect.NewRequest(&portv1.ListInstrumentsRequest{}))
	if err != nil {
		t.Fatalf("ListInstruments user1: %v", err)
	}
	var u1Starred []string
	for _, inst := range res1.Msg.Instruments {
		if inst.Starred {
			u1Starred = append(u1Starred, inst.Isin)
		}
	}
	if len(u1Starred) != 1 || u1Starred[0] != inst1.ISIN {
		t.Fatalf("Expected User 1 to have [%s] starred, got %v", inst1.ISIN, u1Starred)
	}

	// User 2 lists instruments: inst2 is starred, inst1 is NOT starred
	res2, err := srv.ListInstruments(ctxUser2, connect.NewRequest(&portv1.ListInstrumentsRequest{}))
	if err != nil {
		t.Fatalf("ListInstruments user2: %v", err)
	}
	var u2Starred []string
	for _, inst := range res2.Msg.Instruments {
		if inst.Starred {
			u2Starred = append(u2Starred, inst.Isin)
		}
	}
	if len(u2Starred) != 1 || u2Starred[0] != inst2.ISIN {
		t.Fatalf("Expected User 2 to have [%s] starred, got %v", inst2.ISIN, u2Starred)
	}

	// User 1 gets profile: StarredInstruments has inst1 only
	p1, err := st.GetProfile(ctxUser1, "user_1")
	if err != nil {
		t.Fatal(err)
	}
	if len(p1.StarredInstruments) != 1 || p1.StarredInstruments[0] != inst1.ISIN {
		t.Fatalf("Expected Profile 1 to have [%s] starred, got %v", inst1.ISIN, p1.StarredInstruments)
	}
}
