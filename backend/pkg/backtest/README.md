# Portfolio backtesting

Pure Go calculations with no network, database, protobuf, or UI dependency. The
service supplies histories and saved PAC settings; this package simulates and
analyzes them. Instrument and portfolio risk calculations share `../riskmetrics`.

## Entry points

```go
result, err := backtest.Run(assets, plans, backtest.Options{
    Rebalance: "annually", RiskFree: 0.02, Target: 0,
})
// Check err before using result.
analysis, err := backtest.Analyze(result.Combined.Days, backtest.Options{
    RiskFree: 0.02, Target: 0,
})
```

`Asset.Points` contains strictly positive adjusted prices or total-return index
levels on consecutive UTC calendar dates. Prices can have arbitrary starting
scales. Plans contain initial/monthly currency amounts and fractional weights
(0.6 = 60%). Rates and results are fractions, not percentage points. Undefined
statistics are nil, never a fabricated zero.

| File | Responsibility |
| --- | --- |
| `history.go` | Validate and join common dates; report original coverage |
| `simulation.go` | Deposits, purchases, cash, rebalancing, combined accounts |
| `analysis.go` | Validate portfolio observations and compose analyses |
| `heatmap.go` | Geometric calendar month/year returns and partial periods |
| `rolling.go` | Trailing 1/3/5-year annualized returns |
| `holding_period.go` | Worst total return and nonnegative share by horizon |
| `drawdown.go` | Drawdown series, average, depth and duration |
| `correlation.go` | Paired daily-return Pearson correlations |
| `var.go` | Complete-month positive share and historical VaR |
| `xirr.go` | Money-weighted annual return from dated contributions |

`../riskmetrics` keeps CAGR, volatility, Sharpe, Sortino, Calmar, drawdown and
Ulcer Index in separate calculation files. `Calculate` remains its public entry
point for both instruments and portfolios.

## Simulation conventions

- Start is the **latest first observation** among allocated assets, clipped to
  the requested start. End is the earliest last observation, clipped to the
  requested end. Missing internal dates fail validation. No proxies or earlier
  prices are invented. All accounts in one run share this window.
- Initial capital plus the first monthly deposit buys at the first close.
  Subsequent deposits buy at the first calendar-day close each month. This is
  a daily index simulation, including unchanged weekends, not an execution or
  exchange-calendar simulator.
- Fractional units are permitted. Unallocated weight stays in zero-interest
  cash. Each deposit follows the saved target weights. Optional rebalancing
  happens after deposits, monthly or on 1 January, within each account.
- With end-of-day deposit `C[t]` and post-deposit value `V[t]`, the strategy
  return is `(V[t] - C[t]) / V[t-1] - 1`. Geometrically linking these returns
  creates the unitized index used by all strategy/risk analyses. Deposits do
  not count as gains or hide drawdowns.
- Combined accounts sum values and cash flows **before** calculating returns.
  Ratios are recalculated from the combined index, never averaged. The API
  splits an initial lump sum across PACs in proportion to their monthly budgets.
- XIRR uses negative dated deposits and the positive final valuation, solving
  their discounted cash-flow equation on ACT/365.25. Only contributions are
  supported; withdrawals would require revisiting validation and root finding.

## Statistical conventions

Daily simple returns use 365.25 periods/year. Volatility is sample standard
deviation (`n-1`) times `sqrt(365.25)`. Effective annual risk-free/target rates
are converted to daily rates. Sharpe uses the arithmetic mean excess return;
Sortino uses squared shortfalls averaged over **all** daily returns. Both use
square-root annualization. These estimates depend on the sampling convention.

CAGR uses elapsed ACT/365.25 time; Calmar divides it by the selected window's
maximum drawdown. Ulcer Index is the RMS of drawdowns over all observations,
including the first zero. Drawdown magnitudes are positive in the API; the chart
plots their negatives. Average drawdown includes zero-drawdown dates. Duration
is calendar days from the last peak to recovery, or the end for an open episode.

Annualized risk metrics need 30 daily returns. CAGR, Calmar and XIRR need at least
365.25 elapsed days. Zero volatility/downside/drawdown yields an undefined ratio.
Rolling windows use calendar anniversaries (29 February clamps to 28 February).
Holding-period results use overlapping daily windows and are descriptive, not
independent samples or forecasts of success probability.

Calendar returns use the preceding period-end index. The initial bucket and
unfinished final bucket are marked partial. Monthly statistics exclude partial
months. VaR requires at least 12 complete months and uses linearly interpolated
empirical 5th/1st percentiles, expressed as nonnegative losses. This minimum does
not make sparse tail estimates precise. Positive months means strictly above 0.
Correlations require 30 daily returns and the entire requested 1/3/5-year
lookback; constant-return series are undefined. Full-window correlations are
also available. These are trailing-window coefficients, not rolling averages.

## Application boundary

`BacktestService.RunBacktest` accepts owned active PAC account IDs, custom
catalog ISIN/weight allocations, or independent unsaved draft plans. Monetary request fields are EUR cents;
response values are EUR. Current supported PAC frequency is monthly. Cached
justETF EUR total-return history is reused through the existing instrument
service, including its basis-point rounding. Histories fetched over 24 hours ago
are refreshed before use; explicit refresh always fetches immediately. The editor
rechecks coverage when the browser tab regains focus. Histories model reinvested
distributions; do not substitute raw unadjusted prices for total-return analysis.
No historical FX, inflation, additional trading fees, or personal taxes are
modeled. There is no factor dataset, proxy backfill or factor regression.

The API authenticates through the existing Connect middleware and checks account
ownership when resolving saved accounts. Runs do not save portfolios or
alter allocations. No schema migration or background worker is required.

The UI always shows an editable table for one or more selected PACs, or an empty
custom portfolio. Each PAC keeps its own monthly budget and allocation weights;
adding another PAC preserves edits to those already selected. Instrument
replacement preserves its weight and uses the replacement's real history for
the whole simulation. Draft plans run separately and together through the same
endpoint, never account/holding update APIs. They are temporary and are not saved
when leaving the page. Initial capital is split by monthly budgets, or equally
when all budgets are zero.

Run deterministic calculation and boundary tests with:

```sh
go test ./backend/pkg/backtest ./backend/pkg/riskmetrics ./backend/internal/service
```

Formula references: [Sharpe's original discussion](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm),
[CFA Institute's Sortino note](https://rpc.cfainstitute.org/-/media/documents/code/gips/the-sortino-ratio.pdf),
[Ulcer Index definition](https://www.tangotools.com/ui/ui.htm), and
[GIPS performance calculation guidance](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/).
