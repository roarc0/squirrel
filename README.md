# Squirrel — Stash, track & grow your wealth

Local portfolio and cash-yield dashboard. The React/TypeScript UI is embedded in a single CGo-free Go binary.

## Requirements

- Go 1.26.6+
- Node.js and npm
- [`just`](https://github.com/casey/just#installation)

On macOS with Homebrew, or Linux with APT, DNF, Pacman, APK, or Zypper, install anything missing with:

```sh
./scripts/install-tools.sh
```

`just` is a Rust program, so it cannot be installed with `go install`; the script uses a [supported native package](https://github.com/casey/just#packages). Squirrel currently needs no extra Go-installed development tools.

## Run

```sh
cd ui && npm ci && cd ..
just run
```

This installs the locked UI dependencies, builds the embedded assets, and starts Squirrel at <http://127.0.0.1:7340>. `go run` uses Go's temporary build cache and does not leave a binary in the repository. To use an explicit configuration:

```sh
cp squirrel.example.yaml squirrel.yaml
just run -config squirrel.yaml
```

## Build

```sh
just build
./bin/squirrel -config squirrel.yaml
```

Only `just build` creates a persistent binary, at `bin/squirrel`. Open <http://127.0.0.1:7340>. Financial amounts are stored as integer minor units; rates are stored in basis points.

The default database is `data/squirrel.db` inside the project. The entire `data/` directory is ignored by Git; back it up separately.

## Test

```sh
just test
```

The default suite is offline and deterministic. Run the optional live ECB and web-search probes with `SQUIRREL_INTEGRATION=1 CGO_ENABLED=0 go test ./backend/internal/ecb ./backend/internal/mcp`.

## Backups and AI safety

Settings exports a versioned, user-scoped JSON backup containing accounts, holdings, snapshots, profile preferences, chat history, and starred BTPs. The file is not encrypted; configuration, API keys, and the shared instrument catalog are excluded. Restore validates the backup and replaces that user's data in one SQLite transaction.

The AI consultant can inspect portfolio data through an explicit read-only MCP allowlist. It cannot create, update, or delete financial data. When optional Google authentication is configured, background AI tool calls retain the authenticated user identity; without auth, all local data uses the built-in local profile.

## Architecture

- `backend/cmd/squirrel`: application entrypoint and process lifecycle.
- `backend/internal/auth`: session authentication, cookie management, and Google OAuth provider.
- `backend/internal/btp`: Italian BTP bond yield calculation, duration modeling, and web scraping.
- `backend/internal/config`: YAML configuration parsing and environment overrides.
- `backend/internal/ecb`: European Central Bank reference rate synchronization and caching.
- `backend/internal/justetf`: user-triggered screener catalog sync, ticker/ISIN lookup, and profile parsing.
- `backend/internal/mcp`: read-only AI tool schema and internal Connect bridge.
- `backend/internal/portfolio`: financial calculations, instrument validation, diagnostics, and ETF ranking.
- `backend/internal/service`: Connect RPC boundary, auth-scoped orchestration, and embedded UI handler.
- `backend/internal/store`: SQLite schema, migrations, and queries. It is the only package that knows SQL.
- `ui`: React 19, TypeScript, Vite, and Mantine v7. Production assets in `ui/dist` are embedded by Go.

The bank projection applies each account's marginal interest tiers, then subtracts its configured flat tax estimate and annual fee. Different currencies remain separate until FX conversion is implemented.

ETF selection first applies hard filters such as index, distribution policy, replication, domicile, TER, size, and age. It then calculates an explainable weighted score from TER (35%), tracking difference (30%), tracking error (15%), fund size (15%), and age (5%). Missing tracking data scores zero for that component instead of being silently guessed.

Instrument records can be searched and bulk-imported from justETF, loaded directly by ticker/ISIN, or populated from the full screener. The screener is fetched in 500-row pages; at the time of implementation it reported 3,568 products, of which 3,197 valid rows explicitly identified themselves as UCITS ETFs. Catalog rows are cheap summaries and exact profile refresh is always user-triggered.

“Sync catalog” imports screener rows; it does not fetch full profiles or overwrite completed profiles. “Enrich missing” and “Refresh all” load missing profiles, including non-UCITS products, before refreshing older completed profiles. Profile status, successful refresh timestamps, and attempt times persist in SQLite. Individual failures do not stop the batch; failed profiles wait five minutes before retrying, while provider rate limits still pause requests. Optional continuous refresh follows the same queue and configured request rate, and the browser reconnects after backend restarts. Chart refreshes preserve existing observations and insert only missing dates; charts reopen from the database after restart.

The alternatives view uses two conservative peer groups: the same normalized index, or the same asset class, justETF investment focus, strategy, and currency-hedging status. It never compares equity with bonds. “Strictly better” additionally requires no TER or fund-size regression and no change in distribution or replication; other matches are shown as trade-offs rather than recommendations.

The catalog is stored as `instruments`; owned account entries are stored as `holdings`. Each holding has an instrument type, current value, optional amount invested, target allocation, actual allocation within its currency, and an asset-specific tax rate. Saving a dated snapshot copies the current cash and holding breakdown, preserving history even when accounts and holdings are updated later.

Italian tax presets live in `squirrel.example.yaml`: 26% for ordinary financial income and 12.5% for Italian/white-list government bonds. They are editable estimates, not tax advice; actual ETF taxation can depend on the fund's underlying assets and the investor's regime.
