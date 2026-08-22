# LOOT backlog

LOOT is local-first and optimized for occasional rough updates. Prefer explainable calculations over transaction-level tracking, automatic trading, or features that require constant maintenance.

## Now — protect data and simplify updates

- [x] Add a compact **Update situation** screen: edit account cash and current holding values in one place, then optionally save a dated snapshot.
- [x] Add **backup and restore** under Settings.
  - Export a timestamped `.tar.gz` containing the SQLite database and configuration.
  - Validate an archive before restore and create an automatic rollback backup first.
- [x] Add **Hide balances** to the header and remember it as a local UI preference. Do not rewrite the startup YAML from the browser.
- [x] Add a **target drift** summary & **Invest €X** helper that allocates a new contribution toward underweight holdings without tracking individual PAC purchases.
- [x] Consolidate all migrations use a better tool like goose
- [ ] Analyze home workspaces/console for more modern go/ts patterns but don't copy the whole documentation part. just the nice technologies and dependencies in go/ts that are clearly better than the ones we have.

## Next — improve instrument analysis

- [x] Make comparison cohorts explicit and conservative: same asset class first, then same normalized index or equivalent exposure. Never compare bonds with equity.
- [x] Add a side-by-side comparison for 2–5 selected instruments using the existing instrument columns.
- [x] Explain every alternative result: peer-group match, TER difference, size difference, replication/policy changes, and missing data.
- [x] Add catalog health indicators: total discovered, refreshed, stale, failed, excluded, and oldest refresh date.
- [ ] Add saved instrument filters only if the current issuer/type/asset-class filters become repetitive in real use.
- [ ] Version the ranking weights so a score remains understandable after the algorithm changes.

## Next — diagnostics without AI

- [x] Add deterministic warnings for:
  - excessive idle cash relative to planned allocation;
  - target-allocation drift;
  - unusually high TER or account fees;
  - duplicated index/exposure across holdings;
  - stale instrument data;
  - missing or ambiguous tax classification.
- [ ] Keep reference rates hidden by default. Surface them inline only when an account uses a reference-linked interest tier.
- [ ] Add base-currency conversion only when multiple currencies are actually used; keep original-currency totals visible.

## Architecture and maintainability

- [x] Audit the repository after the quick-update flow lands. Consolidate only repeated table, filter, form, money, and confirmation patterns.
- [x] Replace the handwritten JSON API contract with protobuf-generated Go and TypeScript types.
  1. Define and review the schema and money/rate conventions.
  2. Add reproducible code generation and compatibility checks.
  3. Migrate endpoints incrementally.
  4. Remove handwritten API types only after the last endpoint moves.
- [x] Review the workspace/console project for useful patterns, then write a LOOT-specific adoption plan before copying any architecture.
- [ ] Expand focused tests around backup/restore, snapshots, money, taxes, ranking cohorts, and destructive operations.

## Later — optional intelligence

- [ ] Add an opt-in analysis export that previews exactly what portfolio data will leave the machine.
- [ ] Let an AI explain deterministic warnings and summarize trade-offs; it must not trade, mutate data, or silently upload financial details.
- [ ] Consider a local model first. Add a hosted provider only if its explanations are materially better.

## Deliberately out of scope

- Transaction, order, dividend, and monthly PAC history.
- Live broker synchronization or automatic trading.
- Tax-return calculation or personalized financial advice.
- Background scraping that runs without an explicit user action.
