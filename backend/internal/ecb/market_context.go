package ecb

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
)

func (c *Client) FetchMarketContext(ctx context.Context, observationCount int) (MarketContext, error) {
	fredClient := newFREDFetcher()
	equityClient := newEquityFetcher()

	collectors := []struct {
		name string
		get  func(context.Context) (MarketContext, error)
	}{
		// 1. ECB Base Benchmarks
		{"€STR", func(ctx context.Context) (MarketContext, error) { return c.FetchESTR(ctx, observationCount) }},
		{"inflation", func(ctx context.Context) (MarketContext, error) { return c.FetchInflation(ctx, observationCount) }},
		{"deposit rates", func(ctx context.Context) (MarketContext, error) { return c.FetchDepositRates(ctx, observationCount) }},
		{"sovereign yields", func(ctx context.Context) (MarketContext, error) { return c.FetchSovereignYields(ctx, observationCount) }},
		{"euro yield curve", func(ctx context.Context) (MarketContext, error) { return c.FetchEuroYieldCurve(ctx, observationCount) }},
		{"eur/usd fx", func(ctx context.Context) (MarketContext, error) { return c.FetchEURUSD(ctx, observationCount) }},

		// 2. US Treasury Curve (FRED)
		{"US Treasury 2Y", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "YIELD_US_2Y", FREDID: "DGS2", Label: "US Treasury 2-Year Yield", Category: "yield_curves", Unit: "%"}, observationCount)
		}},
		{"US Treasury 5Y", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "YIELD_US_5Y", FREDID: "DGS5", Label: "US Treasury 5-Year Yield", Category: "yield_curves", Unit: "%"}, observationCount)
		}},
		{"US Treasury 10Y", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "YIELD_US_10Y", FREDID: "DGS10", Label: "US Treasury 10-Year Yield", Category: "yield_curves", Unit: "%"}, observationCount)
		}},
		{"US Treasury 30Y", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "YIELD_US_30Y", FREDID: "DGS30", Label: "US Treasury 30-Year Yield", Category: "yield_curves", Unit: "%"}, observationCount)
		}},
		{"US 10Y-2Y Spread", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "SPREAD_US_10Y_2Y", FREDID: "T10Y2Y", Label: "US Treasury 10Y–2Y Yield Spread", Category: "yield_curves", Unit: "%"}, observationCount)
		}},

		// 3. Inflation Expectations & Real Rates (FRED)
		{"Euro 5Y5Y Inflation Expectation", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "INFL_EXP_EUR_5Y5Y", FREDID: "T5YIFR", Label: "Euro Area 5Y5Y Inflation Expectation", Category: "inflation_expectations", Unit: "%"}, observationCount)
		}},
		{"US 5Y Breakeven Inflation", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "INFL_EXP_US_5Y", FREDID: "T5YIE", Label: "US 5-Year Breakeven Inflation Rate", Category: "inflation_expectations", Unit: "%"}, observationCount)
		}},
		{"US 10Y Breakeven Inflation", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "INFL_EXP_US_10Y", FREDID: "T10YIE", Label: "US 10-Year Breakeven Inflation Rate", Category: "inflation_expectations", Unit: "%"}, observationCount)
		}},
		{"US 10Y TIPS Real Rate", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "REAL_RATE_US_10Y", FREDID: "DFII10", Label: "US 10-Year TIPS Real Yield", Category: "real_rates", Unit: "%"}, observationCount)
		}},

		// 4. Credit Spreads (FRED / ICE BofA)
		{"US IG Credit Spread", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "CREDIT_SPREAD_US_IG", FREDID: "BAMLC0A0CM", Label: "US Investment Grade Corporate OAS", Category: "credit_spreads", Unit: "%"}, observationCount)
		}},
		{"US HY Credit Spread", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "CREDIT_SPREAD_US_HY", FREDID: "BAMLH0A0HYM2", Label: "US High Yield Corporate OAS", Category: "credit_spreads", Unit: "%"}, observationCount)
		}},
		{"EUR HY Credit Spread", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "CREDIT_SPREAD_EUR_HY", FREDID: "BAMLHE00EHYIOAS", Label: "Euro High Yield Corporate OAS", Category: "credit_spreads", Unit: "%"}, observationCount)
		}},
		{"EUR IG Credit Spread", func(ctx context.Context) (MarketContext, error) {
			mc, err := fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "CREDIT_SPREAD_EUR_IG", FREDID: "BAML0A1VUY", Label: "Euro Investment Grade Corporate OAS", Category: "credit_spreads", Unit: "%"}, observationCount)
			if err == nil {
				return mc, nil
			}
			return MarketContext{}, nil
		}},

		// 5. Volatility (FRED & Yahoo)
		{"US VIX Volatility", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "VOLATILITY_VIX", FREDID: "VIXCLS", Label: "CBOE Volatility Index (VIX)", Category: "volatility", Unit: "index"}, observationCount)
		}},
		{"European VSTOXX Volatility", func(ctx context.Context) (MarketContext, error) {
			return equityClient.FetchIndexTrend(ctx, EquityIndexConfig{Code: "VOLATILITY_VSTOXX", Symbol: "^EVZ", FallbackSymbol: "^VIX", Label: "European / Euro Volatility Index", Category: "volatility", Unit: "index"})
		}},

		// 6. Equity Markets (Yahoo Finance)
		{"S&P 500 Index", func(ctx context.Context) (MarketContext, error) {
			return equityClient.FetchIndexTrend(ctx, EquityIndexConfig{Code: "EQUITY_SP500", Symbol: "^GSPC", Label: "S&P 500 Index", Category: "equity_market", Unit: "pt"})
		}},
		{"Euro Stoxx 50 Index", func(ctx context.Context) (MarketContext, error) {
			return equityClient.FetchIndexTrend(ctx, EquityIndexConfig{Code: "EQUITY_STOXX50", Symbol: "^STOXX50E", Label: "Euro Stoxx 50 Index", Category: "equity_market", Unit: "pt"})
		}},
		{"DAX Index", func(ctx context.Context) (MarketContext, error) {
			return equityClient.FetchIndexTrend(ctx, EquityIndexConfig{Code: "EQUITY_DAX", Symbol: "^GDAXI", Label: "German DAX Index", Category: "equity_market", Unit: "pt"})
		}},
		{"FTSE MIB Index", func(ctx context.Context) (MarketContext, error) {
			return equityClient.FetchIndexTrend(ctx, EquityIndexConfig{Code: "EQUITY_FTSEMIB", Symbol: "FTSEMIB.MI", Label: "FTSE MIB Index", Category: "equity_market", Unit: "pt"})
		}},

		// 7. Economic Cycle & Financial Conditions (FRED & RecessionDashboard)
		{"Recession Dashboard", func(ctx context.Context) (MarketContext, error) {
			return c.FetchRecessionDashboard(ctx, observationCount)
		}},
		{"US Unemployment Rate", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "UNEMPLOYMENT_US", FREDID: "UNRATE", Label: "US Civilian Unemployment Rate", Category: "economic_cycle", Unit: "%"}, observationCount)
		}},
		{"Euro Area Unemployment Rate", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "UNEMPLOYMENT_EA", FREDID: "LRHUTTTTEZM156S", Label: "Euro Area Unemployment Rate", Category: "economic_cycle", Unit: "%"}, observationCount)
		}},
		{"US Industrial Production", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "IND_PROD_US", FREDID: "INDPRO", Label: "US Industrial Production Index", Category: "economic_cycle", Unit: "index"}, observationCount)
		}},
		{"Chicago Fed Financial Conditions Index", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "FIN_COND_US_ANFCI", FREDID: "ANFCI", Label: "Chicago Fed Adjusted Financial Conditions", Category: "financial_conditions", Unit: "index"}, observationCount)
		}},
		{"St. Louis Fed Financial Stress Index", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "FIN_STRESS_US_STLFSI", FREDID: "STLFSI4", Label: "St. Louis Fed Financial Stress Index", Category: "financial_conditions", Unit: "index"}, observationCount)
		}},

		// 8. Commodities & FX (Yahoo & FRED)
		{"Gold Spot Price", func(ctx context.Context) (MarketContext, error) {
			return equityClient.FetchIndexTrend(ctx, EquityIndexConfig{Code: "COMMODITY_GOLD", Symbol: "GC=F", Label: "Gold Spot Price", Category: "commodities_fx", Unit: "USD/oz"})
		}},
		{"Brent Crude Oil", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "COMMODITY_BRENT", FREDID: "DCOILBRENTEU", Label: "Brent Crude Oil Price", Category: "commodities_fx", Unit: "USD/bbl"}, observationCount)
		}},
		{"Global Commodity Index", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "COMMODITY_BROAD", FREDID: "PALLFNFINDEXM", Label: "Global Price Index of All Commodities", Category: "commodities_fx", Unit: "index"}, observationCount)
		}},
		{"Euro Effective Exchange Rate", func(ctx context.Context) (MarketContext, error) {
			return fredClient.FetchSeries(ctx, FREDSeriesConfig{Code: "FX_EUR_EER", FREDID: "RBXMBIS", Label: "Euro Effective Exchange Rate (BIS)", Category: "commodities_fx", Unit: "index"}, observationCount)
		}},
	}

	results := make([]MarketContext, len(collectors))
	errs := make([]error, len(collectors))
	var group sync.WaitGroup
	for i, collector := range collectors {
		i := i
		collector := collector
		group.Add(1)
		go func() {
			defer group.Done()
			results[i], errs[i] = collector.get(ctx)
		}()
	}
	group.Wait()

	var result MarketContext
	metricMap := make(map[string]Metric)

	for i, collected := range results {
		result.Observations = append(result.Observations, collected.Observations...)
		for _, m := range collected.Metrics {
			metricMap[m.Code] = m
			result.Metrics = append(result.Metrics, m)
		}
		if errs[i] != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", collectors[i].name, errs[i]))
		}
	}

	// Derived Metric: EUR 10Y Real Rate
	de10Y, okDE := metricMap["YIELD_10Y_DE"]
	eaInfl, okInfl := metricMap["INFL_EXP_EUR_5Y5Y"]
	if okDE && okInfl {
		realYield := de10Y.Value - eaInfl.Value
		result.Metrics = append(result.Metrics, Metric{
			Code:       "REAL_RATE_EUR_10Y",
			Label:      "Euro 10-Year Real Yield (Bund − 5Y5Y)",
			Category:   "real_rates",
			Value:      realYield,
			Unit:       "%",
			ObservedOn: de10Y.ObservedOn,
			SourceURL:  de10Y.SourceURL,
		})
	}

	// Derived Metric: Risk Sentiment Dashboard Score (0-100)
	vix, okVIX := metricMap["VOLATILITY_VIX"]
	hySpread, okHY := metricMap["CREDIT_SPREAD_US_HY"]
	sp500, okSP := metricMap["EQUITY_SP500"]

	if okVIX && okHY && okSP {
		vixScore := math.Max(0, math.Min(100, 100-(vix.Value-12)*2.5))
		hyScore := math.Max(0, math.Min(100, 100-(hySpread.Value-2.5)*15))
		drawdown := 0.0
		if sp500.Distance52WHigh != nil {
			drawdown = *sp500.Distance52WHigh
		}
		ddScore := math.Max(0, math.Min(100, 100+drawdown*2.5))

		compositeScore := math.Round((vixScore*0.4 + hyScore*0.4 + ddScore*0.2)*10) / 10
		result.Metrics = append(result.Metrics, Metric{
			Code:       "RISK_SENTIMENT_SCORE",
			Label:      "Global Market Risk Sentiment Index",
			Category:   "risk_sentiment",
			Value:      compositeScore,
			Unit:       "/100",
			ObservedOn: vix.ObservedOn,
			SourceURL:  "https://fred.stlouisfed.org",
		})
	}

	if len(result.Metrics) == 0 {
		return result, errors.Join(errs...)
	}
	return result, nil
}
