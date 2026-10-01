# Historical risk metrics

Import `github.com/roarc0/squirrel/backend/pkg/riskmetrics`. This public Go
package uses only the standard library; it knows nothing about instruments,
providers, databases, protobuf, or HTTP.

```go
metrics, err := riskmetrics.Calculate(history, riskmetrics.Options{
    PeriodsPerYear: 365.25, // calendar-day observations, including weekends
    RiskFreeRate:   0.02,   // effective annual 2%; zero is also a valid assumption
    TargetReturn:  0,      // annual minimum acceptable return for Sortino
})
```

`history` is `[]riskmetrics.Point`, each containing a `time.Time` and positive
price or total-return index level. Supply sorted, regularly sampled data,
adjusted for splits and distributions when measuring total return. The package
rejects invalid prices, duplicate/out-of-order timestamps, invalid annual rates,
and fewer than three observations; it neither fills gaps nor guesses sampling.
For trading-day data use the matching trading frequency (often 252), or 12 for
monthly observations. Timestamps determine elapsed time for CAGR; the supplied
frequency determines annualization of period-return statistics.

For `n` simple returns `r[i] = price[i]/price[i-1] - 1` and `k` periods per year:

| Metric | Convention |
| --- | --- |
| Total return | Last level / first level − 1 |
| CAGR | `(last / first)^(1 / elapsedYears) − 1`, ACT/365.25 |
| Volatility | Sample standard deviation of returns (`n−1`) × `sqrt(k)` |
| Sharpe | `(mean(r) − periodRiskFreeRate) / sampleStdDev(r) × sqrt(k)` |
| Downside deviation | `sqrt(sum(min(0, r[i] − periodTarget)^2) / n) × sqrt(k)` |
| Sortino | `(mean(r) − periodTarget) / periodDownsideDeviation × sqrt(k)` |
| Maximum drawdown | Largest `1 − level / runningPeak` in the supplied window |
| Calmar | CAGR / maximum drawdown over the same supplied window |
| Ulcer index | RMS of drawdowns across all levels, including the initial zero |

Effective annual rates are converted with `(1 + rate)^(1/k) − 1`.
All return/risk quantities are fractions (`0.15 = 15%`), with positive drawdown
magnitudes. Ratios are dimensionless. Ulcer index is not annualized. Undefined
ratios (zero risk denominator) and non-finite CAGR/ratios are `nil`, never infinity
or a misleading zero. Other numerical overflow is an error.

These are historical sample estimates. Square-root annualization is a convention
that does not model serial correlation or the full distribution of annual
downside outcomes. Calmar traditionally uses three years; this package explicitly
uses the caller's window. Compare instruments over matching windows, sampling,
currency and rate assumptions.

The instrument API (`v1.InstrumentService/GetInstrumentRiskMetrics`) accepts ISIN,
inclusive date bounds, and optional annual rate assumptions (both default 0%).
It reuses the performance cache and fetches history on first use. The current
justETF source is cumulative EUR performance requested with dividends included,
rounded to basis points. The adapter reconstructs index levels with
`1 + change_bps/10000`, checks consecutive calendar days and uses 365.25 periods
per year, retaining unchanged weekends. It requires at least 30 daily returns
and suppresses CAGR/Calmar below one ACT/365.25 year. These are UI quality thresholds,
not mathematical requirements. Missing, invalid or short history produces a
human-readable `note`; zero-denominator ratios are absent optional protobuf fields.
All calculations run on demand; nothing derived is persisted.

References for the conventions: [Sharpe's original explanation](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm),
[CFA Institute on Sortino and its limitations](https://rpc.cfainstitute.org/-/media/documents/code/gips/the-sortino-ratio.pdf),
[Peter Martin's Ulcer Index definition](https://www.tangotools.com/ui/ui.htm), and
[PerformanceAnalytics' Calmar definition](https://github.com/braverock/PerformanceAnalytics/blob/master/R/CalmarRatio.R).

Run the calculation and API checks from the repository root:

```sh
go test ./backend/pkg/riskmetrics ./backend/internal/service
```
