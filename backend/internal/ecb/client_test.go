package ecb

import (
	"context"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCollectors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var csv string
		switch strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")[0] {
		case "FM":
			csv = "PROVIDER_FM_ID,TIME_PERIOD,OBS_VALUE\nDFR,2026-06-17,2.25\nMLFR,2026-06-17,2.65\nMRR_FR,2026-06-17,2.4\n"
		case "EST":
			csv = "BENCHMARK_ITEM,DATA_TYPE_EST,TIME_PERIOD,OBS_VALUE\nEU000A2X2A25,WT,2026-08-25,2.189\nEU000A2QQF24,CR,2026-08-26,2.18846\nEU000A2QQF32,CR,2026-08-26,2.12949\n"
		case "HICP":
			if r.URL.Query().Get("lastNObservations") != "60" {
				t.Errorf("inflation requested %s observations", r.URL.Query().Get("lastNObservations"))
			}
			csv = "REF_AREA,TIME_PERIOD,OBS_VALUE\nU2,1996-12,\nIT,2026-07,2.9\nU2,2026-07,2.9\n"
		case "MIR":
			csv = "BS_ITEM,MATURITY_NOT_IRATE,TIME_PERIOD,OBS_VALUE\nL21,A,2026-06,0.19\nL22,F,2026-06,2.22\n"
		case "IRS":
			csv = "REF_AREA,TIME_PERIOD,OBS_VALUE\nDE,2026-07,3.07\nIT,2026-07,3.881\n"
		case "YC":
			csv = "KEY,TIME_PERIOD,OBS_VALUE\nSR_2Y,2026-07,2.50\nSR_10Y,2026-07,3.00\n"
		case "EXR":
			csv = "TIME_PERIOD,OBS_VALUE\n2026-07,1.08\n"
		default:
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(csv))
	}))
	defer server.Close()

	client := newClient(server.URL, server.Client())
	rates, err := client.FetchPolicyRates(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(rates) != 3 || rates[0].Code != "DFR" || rates[1].Code != "MRR_FR" || rates[1].RateBPS != 240 {
		t.Fatalf("unexpected policy rates: %+v", rates)
	}
	market, err := client.FetchSovereignYields(context.Background(), 60)
	if err != nil {
		t.Fatal(err)
	}
	if len(market.Metrics) != 3 || len(market.Observations) != 3 {
		t.Fatalf("unexpected sovereign yields: %+v", market)
	}
	spread := market.Metrics[len(market.Metrics)-1]
	if spread.Code != "SPREAD_IT_DE_10Y" || math.Abs(spread.Value-81.1) > 0.001 {
		t.Fatalf("unexpected sovereign spread: %+v", spread)
	}
}

func TestLiveFetchMarketContext(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live market fetch in short mode")
	}
	client := New()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	mc, err := client.FetchMarketContext(ctx, 10)
	if err != nil {
		t.Fatalf("live market fetch failed: %v", err)
	}
	t.Logf("Fetched %d metrics, %d observations, warnings: %v", len(mc.Metrics), len(mc.Observations), mc.Warnings)
	if len(mc.Warnings) > 0 {
		t.Fatalf("Live market context fetch had warnings: %v", mc.Warnings)
	}
}
