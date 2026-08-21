# LOOT — Know what you own

Local portfolio and cash-yield dashboard. The React/TypeScript UI is embedded in a single CGo-free Go binary.

## Requirements

- Go 1.26+
- Node.js and npm
- [`just`](https://github.com/casey/just#installation)

On macOS with Homebrew, install anything missing with:

```sh
./scripts/install-tools.sh
```

`just` is a Rust program, so it cannot be installed with `go install`; the script uses its supported Homebrew package. LOOT currently needs no extra Go-installed development tools.

## Run

```sh
just run
```

This installs the locked UI dependencies, builds the embedded assets, and starts LOOT at <http://127.0.0.1:7340>. `go run` uses Go's temporary build cache and does not leave a binary in the repository. To use an explicit configuration:

```sh
cp loot.example.yaml loot.yaml
just run -config loot.yaml
```

## Build

```sh
just build
./bin/loot -config loot.yaml
```

Only `just build` creates a persistent binary, at `bin/loot`. Open <http://127.0.0.1:7340>. Financial amounts are stored as integer minor units; rates are stored in basis points.

## Test

```sh
just test
```

## Architecture

- `internal/portfolio`: dependency-free financial calculations, instrument validation, and ETF ranking.
- `internal/justetf`: user-triggered screener catalog sync, ticker/ISIN lookup, and profile parsing.
- `internal/store`: SQLite schema and queries. It is the only package that knows SQL.
- `internal/httpapi`: small JSON/HTTP boundary and embedded UI handler.
- `ui`: React, TypeScript, Vite, and Mantine. Production assets in `ui/dist` are embedded by Go.

The bank projection applies each account's marginal interest tiers, then subtracts its configured flat tax estimate and annual fee. Different currencies remain separate until FX conversion is implemented.

ETF selection first applies hard filters such as index, distribution policy, replication, domicile, TER, size, and age. It then calculates an explainable weighted score from TER (35%), tracking difference (30%), tracking error (15%), fund size (15%), and age (5%). Missing tracking data scores zero for that component instead of being silently guessed.

Instrument records can be searched and bulk-imported from justETF, loaded directly by ticker/ISIN, or populated from the full screener. The screener is fetched in 500-row pages; at the time of implementation it reported 3,568 products, of which 3,197 valid rows explicitly identified themselves as UCITS ETFs. Catalog rows are cheap summaries and exact profile refresh is always user-triggered.

“Discover remaining” profile-checks screener rows that were not imported by the conservative label filter, saves confirmed UCITS ETFs, and remembers non-UCITS exclusions. Exact ticker/ISIN lookup may still add a non-UCITS product explicitly. “Refresh all” first streams missing profiles at the configured rate limit; later runs start with the oldest successful refresh, so stopping and restarting naturally continues a round. Catalog-list and profile-refresh times are stored separately, and catalog sync never downgrades refreshed data or its timestamp. There is no background scraping or browser impersonation.

The alternatives view uses two conservative peer groups: the same normalized index, or the same asset class, justETF investment focus, strategy, and currency-hedging status. It never compares equity with bonds. “Strictly better” additionally requires no TER or fund-size regression and no change in distribution or replication; other matches are shown as trade-offs rather than recommendations.

The catalog is stored as `instruments`; owned account entries are stored as `holdings`. Each holding has an instrument type, current value, optional amount invested, target allocation, actual allocation within its currency, and an asset-specific tax rate. Saving a dated snapshot copies the current cash and holding breakdown, preserving history even when accounts and holdings are updated later.

Italian tax presets live in `loot.example.yaml`: 26% for ordinary financial income and 12.5% for Italian/white-list government bonds. They are editable estimates, not tax advice; actual ETF taxation can depend on the fund's underlying assets and the investor's regime.
