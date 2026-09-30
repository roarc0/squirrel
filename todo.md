# Squirrel improvement plan

Reviewed 2026-09-04 across the Go services/store/domain, protobuf and Connect boundary, auth/MCP/AI flows, React state/routes/styles, migrations, build/test setup, and documentation. Priority and order run top to bottom: protect data first, then make the current product dependable, then add capability.

## P0 — Security and data integrity

- [x] **Make holding updates genuinely partial.** Presence-aware patch fields preserve every omitted value while still allowing explicit zero/false updates; regression-covered.
- [x] **Enforce chat ownership end to end.** Active jobs are keyed by user plus session, status/stop/stream attachment are scoped, and saved-session collisions cannot replace another user's messages; two-user paths are covered.
- [x] **Carry authenticated identity into AI tool calls.** Detached background jobs retain the authenticated identity in context without exposing bearer tokens to the model.
- [x] **Make AI tools read-only by default.** An explicit method allowlist exposes only read operations, and the system prompt no longer advertises mutations.

## P1 — Bug fixes and reliability

- [x] **Fix profile persistence in the default no-auth setup.** The built-in local profile now saves under the same stable empty-user identity as other local data, and UI save failures are reported.
- [x] **Use one complete, presence-aware profile contract.** Partial updates preserve untouched fields; active tab, theme/accent, sanitized AI settings, and draft portfolios sync through the profile while API keys remain session-local.
- [x] **Derive cash diagnostics from the stored profile.** Summary computes the target server-side from monthly expenses and reserve months; obsolete localStorage inputs are gone.
- [x] **Make backup round trips exhaustive and versioned.** `user_description`, chat history, and starred BTPs now round-trip in v2; configuration and API keys stay excluded. README documents the transactional JSON format.
- [x] **Make “Update situation + snapshot” one transaction.** Snapshot failure now rolls back account and holding changes; trigger-backed regression-covered.
- [x] **Use local calendar dates in snapshot forms.** Both snapshot screens share a tested local `YYYY-MM-DD` helper instead of UTC conversion.
- [x] **Reuse cached market data in Geo Radar.** Stored EUR/USD data is reused, a live request occurs only on cache miss, and the UI shows observation date/source without a hard-coded rate.
- [x] **Return actionable AI errors and bound chat input.** Typed stream errors reach the UI; IDs, provider settings, titles, roles, counts, messages, histories, tool payloads, and portfolio context are bounded and validated.

## P1 — UI and accessibility

- [x] **Build a real narrow-screen navigation.** Phone layouts now use a labelled Mantine burger/drawer around the existing sidebar; navigation closes the drawer and desktop collapse remains independently persisted.
- [x] **Make invisible controls keyboard-visible.** Table actions reveal on `:focus-within`, icon-only controls have accessible names, decorative SVGs are hidden from assistive technology, and reduced-motion preferences are honored.
- [x] **Show persistence and recovery states.** Replace best-effort silent saves with saving/saved/error feedback; add Retry to initial-load errors and keep the last usable data on refresh failures.
- [x] **Apply display preferences consistently.** Restore theme/accent from the profile, use the selected currency symbol instead of hard-coded `€` in Settings, and explain when figures remain in their original currency.

## P1 — Tests and delivery

- [x] **Make the default test suite hermetic.** ECB and MCP defaults use local fixtures/`httptest`, live probes require `SQUIRREL_INTEGRATION=1`, and `just test` no longer regenerates or builds as a side effect.
- [x] **Add CI for the existing quality gates.** GitHub Actions checks protobuf generation drift, Go test/vet/race, TypeScript, UI tests, and the production build.
- [ ] **Add financial golden cases.** Lock down tiered interest/tax rounding, allocation totals, BTP yield/duration/scoring boundaries, matured/zero-coupon bonds, multi-currency separation, and backup/restore fidelity.
- [ ] **Add a few high-value UI flow tests.** Cover update-situation, destructive confirmation, profile save failure, backup restore, and AI tool confirmation; avoid broad snapshot testing.

## P2 — Doable features

- [ ] **Show “what changed” between snapshots.** Add per-currency deltas, biggest movers, data age, and an optional short note; reuse the existing snapshot data rather than adding transaction tracking.
- [ ] **Add preview-first CSV import.** Support accounts and holdings with column mapping, validation, duplicate detection, and an all-or-nothing commit; reuse existing domain validators and backup before import.
- [ ] **Offer an optional consolidated base-currency view.** Enable it only for multi-currency portfolios, display the FX rate/timestamp, and always retain original-currency totals.
- [ ] **Surface reference rates only in context.** Hide the standalone noise by default and show the rate, spread, effective yield, source, and freshness beside accounts that actually use a linked tier.
- [ ] **Version ranking rules.** Display the BTP/instrument scoring version and factor weights so old recommendations remain explainable after tuning.

## P2 — Refactoring and performance

- [x] **Retire the legacy `api(path, init)` facade.** Removed backwards-compatible regex router and dual-casing mappings; all 9 Connect-RPC clients are strictly typed and called directly.
- [x] **Modernize Mantine theming & CSS cleanup.** Replaced manual DOM mutations with native `CSSVariablesResolver` and consolidated CSS accent rules.
- [x] **Extract UI modals & route-based code splitting.** Extracted `InstrumentModal` and `FilterPresetsModal`; lazy-loaded all routes in `App.tsx` dropping bundle size from 1.12 MB to 424 kB.
- [x] **Backend structured logging and globals cleanup.** Converted BTP package to `log/slog` and eliminated package-level globals (`globalChatJobs`, `activeDownloads`) on `Server`.
- [x] **Delete verified dead UI code and break the `App.tsx` import cycle.** Remove unused `SettingsModal`, `DraftPortfoliosModal`, alias views, dead types/wrappers, and obsolete panels; move only actually shared table/chart helpers out of `App.tsx` (roughly 700+ removable lines before CSS cleanup).
- [x] **Remove `samber/lo`.** Replaced with standard idiomatic Go loops in diagnostics; dropped third-party dependency from `go.mod`.
- [x] **Query instruments directly by ID/ISIN.** Replaced full-table catalog scans in `GetInstrumentByID` and `GetInstrumentByISIN` with direct indexed SQL queries and shared `scanInstrument` row scanner.
- [ ] **Decompose `InvestmentsView.tsx` subtabs.** Extract `HoldingsSubtab`, `PACSubtab`, `RadarSubtab`, and `SandboxSubtab` out of the 1,300-line monolithic view.
- [ ] **Stop full-app reloads after every mutation.** Update the affected account/holding/snapshot slice and cache the shared instrument catalog; do not refetch thousands of instruments for an unrelated edit.
- [ ] **Bring docs back to the code.** Update the architecture map (`internal/service`, not `internal/httpapi`), backup format, AI mutation policy, auth behavior, and offline/integration test commands.

## Later / evidence required

- Saved filters only after repeated use shows the current filters are painful.
- Full transaction/order/dividend/PAC history, broker sync, automatic trading, tax returns, personalized financial advice, and unattended scraping remain out of scope.
- Do not add a state framework, repository layer, plugin system, or background queue unless measured complexity or scale requires one.

Recommended next slices:
1. **Remove `samber/lo` & query instruments directly by ID/ISIN** — immediate backend performance and dependency hygiene.
2. **Decompose `InvestmentsView.tsx` subtabs** — finish decoupling the largest remaining frontend component.

