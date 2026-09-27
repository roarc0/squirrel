# Instrument Detail Page — Requirements

**Date:** 2026-09-20  
**Status:** Ready for planning

---

## Problem

The app has profile data for thousands of ETFs but no dedicated page to view a single instrument in depth. Users cannot see historical performance, compare time periods, or get a professional all-in-one view of an ETF.

## Goal

A dedicated, professional-grade instrument detail page at `/instruments/{isin}` that:
1. Displays everything known about the instrument
2. Shows an interactive historical performance chart (daily, from inception)
3. Fetches and caches performance data on demand from justETF
4. Allows full data refresh

---

## Scope

### In scope
- New route `/instruments/{isin}` within the existing routing system
- Backend: new `instrument_performance` table (separate from `instruments`)
- Backend: new justETF chart API integration (`/api/etfs/{isin}/performance-chart`)
- Backend: new Connect RPC service for performance data (new proto file)
- Frontend: `InstrumentDetailView` component
- Frontend: Interactive performance chart with period selector
- Lazy fetch: if performance data is missing → pull from justETF → store → serve (RPC: `GetInstrumentPerformance`)
- Manual refresh: button to re-pull all performance data for the instrument (RPC: `RefreshInstrumentPerformance`)

### Out of scope (for now)
- PAC backtest simulation
- Multi-currency performance (EUR only)
- Correlation between instruments
- Portfolio aggregate performance
- Export/download of data

---

## Data Source

**API:** `GET https://www.justetf.com/api/etfs/{isin}/performance-chart`

**Params:**
- `valuesType=RELATIVE_CHANGE`
- `currency=EUR`
- `reduceData=false`
- `includeDividends=true`

**Response structure:**
```json
{
  "latestQuote": { "raw": 127.06 },
  "latestQuoteDate": "2026-09-18",
  "performance": { "raw": 659.47 },
  "series": [
    { "date": "2009-09-25", "value": { "raw": 0.0 } },
    { "date": "2009-09-26", "value": { "raw": 0.0 } }
  ]
}
```

**Note:** `value` is a nested object — the cumulative % is at `series[i].value.raw`, not `series[i].value`. Store as `change_bps = math.Round(value.raw * 100)` (e.g., `raw=659.47` → `65947`).

**Scale:** IWDA (17y old) → 6,203 points. Avg ETF ~2,500 points. ~200MB for all 4,000 ETFs.

**Currency:** EUR only (standard for European investors, enables fair comparison).

---

## Storage

New SQLite table (separate from `instruments`, keyed by ISIN):

```sql
-- instrument_performance: daily cumulative % change from inception
-- change_bps = math.Round(value.raw * 100), e.g. 659.47% → 65947
CREATE TABLE instrument_performance (
    isin TEXT NOT NULL,
    date TEXT NOT NULL,
    change_bps INTEGER NOT NULL,
    PRIMARY KEY (isin, date),
    FOREIGN KEY (isin) REFERENCES instruments(isin) ON DELETE CASCADE
);

-- metadata: when was this ISIN's series last fetched (acts as commit flag)
CREATE TABLE instrument_performance_meta (
    isin TEXT PRIMARY KEY REFERENCES instruments(isin) ON DELETE CASCADE,
    fetched_at TEXT NOT NULL,
    point_count INTEGER NOT NULL
);
```

SQLite is sufficient. 4,000 ETFs × 2,500 avg points = 10M rows ≈ 200–400MB with index.

---

## Backend Design

### New files
- `backend/internal/store/migrations/00010_instrument_performance.sql`
- `backend/internal/justetf/performance.go` — `FetchPerformance(ctx, isin)` + `waitForChart` on existing `Client`
- `backend/internal/store/performance_store.go` — SQLite queries as methods on `store.Store`
- `backend/internal/service/performance_service.go` — two new RPC handlers added to existing `Server`
- `ui/src/views/InstrumentDetailView.tsx`

### Minimal patches to existing files
- `proto/v1/instrument.proto` — add 2 new RPCs + request/response messages
- `proto/gen/go/v1/` and `ui/src/pb/v1/` — regenerated (run `just generate` in `proto/`)
- `backend/internal/portfolio/instrument.go` — add `PerformancePoint`, `PerformanceMeta` structs
- `backend/internal/justetf/client.go` — add `chartMu`, `nextChart`, `chartInterval` fields
- `ui/src/visual.ts` — add `'ytd'` to `ChartRange`, generic date-field adapter
- `ui/src/App.tsx` — conditional render in instruments panel (2 lines)
- `ui/src/views/InstrumentFinderView.tsx` — make instrument name a clickable link

### RPC methods
Add two new RPCs to the **existing `InstrumentService`** in `proto/v1/instrument.proto` (do not create a new proto file — saves generated packages and a new client in `api.ts`).

```
rpc GetInstrumentPerformance(isin) → { series, fetched_at, point_count }
  - If meta row exists → serve from DB (no staleness TTL in v1; user manages via Refresh)
  - If missing → fetch from justETF → store → return

rpc RefreshInstrumentPerformance(isin) → { series, fetched_at, point_count }
  - Always fetch fresh from justETF
  - Delete and re-insert data for this ISIN **in a single SQLite transaction**
  - Meta row updated only after all data rows committed
  - Return new series
```

**Transaction requirement (both RPCs):** all writes for a given ISIN must be wrapped in a single transaction. A context cancellation or write error must roll back completely — never leave a partially-written series.

**Struct placement:** `PerformancePoint` and `PerformanceMeta` live in `backend/internal/portfolio/` alongside `Instrument`. Store methods live in a new `backend/internal/store/performance_store.go` as methods on `store.Store` — matching the existing `instrument_store.go` pattern.

**Profile data in InstrumentDetailView:** the component receives `instruments: Instrument[]` as a prop (same as `InstrumentFinder`). It looks up the instrument client-side: `instruments.find(i => i.isin === isin)`. No new GetInstrument RPC needed.

**ISIN not in catalog:** if `instruments.find(...)` returns `undefined`, show: "This instrument is not in your catalog. [Add it →]" (links to the finder with the ISIN pre-filled). Performance chart is not shown.

### Rate limiting
- **Separate rate limiter** for chart API — do NOT share `waitForProfile` (sharing would queue chart fetches behind bulk enrichment loops, potentially hours of wait)
- Add `chartMu sync.Mutex` + `nextChart time.Time` + `chartInterval time.Duration` (1s) to `Client` struct
- New `waitForChart(ctx context.Context) error` method, called before each chart HTTP request
- Chart 429/403 responses trigger backoff on `nextChart` (same pattern as `backOffProfiles`)

---

## Frontend Design

### Route
- `/instruments/{isin}` — `parseRoute` already returns `{ section: 'instruments', subtab: 'IE00...' }` for this URL (no change to `parseRoute` needed)
- Inside the instruments `Tabs.Panel`: if `route.subtab` matches `/^[A-Z]{2}[A-Z0-9]{10}$/`, render `<InstrumentDetailView isin={route.subtab} instrument={data.instruments.find(i => i.isin === route.subtab)} />`; else render `<InstrumentFinder />`
- Entry point from finder: clicking the instrument name cell navigates via `handleSubtabChange('instruments', isin)`
- Back button: `handleSubtabChange('instruments', '')` returns to the finder
- ISIN not in catalog: show "not in your catalog" message + link to finder with ISIN pre-filled; do not render chart

### InstrumentDetailView layout

```
┌─────────────────────────────────────────────────────────────┐
│ ← Back   [VWCE] Vanguard FTSE All-World UCITS ETF   [★] [↻]│
│          IE00BK5BQT80 · ETF · UCITS · Accumulating          │
├─────────────────────────────────────────────────────────────┤
│ TER: 0.22%  │  Size: €18,234m  │  Currency: USD             │
│ Since: Jul 2019  │  Domicile: Ireland  │  Sampling          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [1M] [3M] [6M] [YTD] [1Y] [3Y] [5Y] [MAX]                │
│                                                             │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                       │
│  (interactive area chart — performance % from period start) │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Returns:  1M: +2.3%  3M: +5.1%  1Y: +18.4%  MAX: +82.1%  │
├─────────────────────────────────────────────────────────────┤
│  Fund details (index, provider, focus, strategy, ESG, etc.) │
│  Links: justETF profile ↗                                   │
└─────────────────────────────────────────────────────────────┘
```

### Chart behavior
- **Period selector:** 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, MAX
- **Y-axis:** % return relative to start of selected period (not inception)
  - Math: `normalized[t] = (raw[t] - raw[start]) / (100 + raw[start]) * 100` where `raw` values are percentages (divide stored `change_bps` by 100 first)
  - Guard: if `100 + raw[start] === 0`, display "N/A" rather than Infinity
- **Period boundary resolution:** for each period, find the last series point whose `date ≤ period start date` (today minus N months, or Dec 31 of previous year for YTD). If no such point exists, disable that period button.
- **Area chart** with gradient fill below the line
- **Tooltip:** date + return % on hover/crosshair
- **Loading state:** skeleton while fetching
- **Error state:** "Could not load performance data — [Retry]" (distinct from missing-data state)
- **Missing data state:** "No performance data — [Load data]" button

### Charting library
**Extend the existing custom SVG chart system — no new library.**

The app already has a custom SVG chart in `ui/src/views/OverviewView.tsx` (`WealthChart`) backed by `ui/src/visual.ts` (`chartGeometry`, `filterChartRange`, `ChartRange`). The `PerformanceChart` component reuses this:

- `chartGeometry()` maps any number array to SVG coordinates — works at 6,000 points (single `<polyline>`)
- `filterChartRange()` handles all period windows — needs a thin adapter for `date` field instead of `observed_on`, and `'ytd'` added to `ChartRange`
- Gradient area fill: add `<defs><linearGradient>` + a `<polygon>` closing to the baseline (5 SVG lines)
- **No per-point `<circle>` elements** — skip them at 6k (WealthChart renders them for ~100 snapshots only)
- Y-axis: `%` formatting with `+/-` prefix instead of currency

Changes to `visual.ts`:
- Add `'ytd'` to `ChartRange` type
- Extend `filterChartRange` to accept a `dateField` param (or create `filterRangeByDate` generic variant)

Result: consistent visual language with the overview chart, zero new dependencies.

### Returns table
Compute from stored series in frontend:
- Take last point in each period window
- Apply normalization formula above
- Display as colored badges (green/red)

---

## Success Criteria

### Backend & Data
1. Navigating to `/instruments/IE00B4L5Y983` shows the detail page
2. First visit: data fetched from justETF, stored, chart renders
3. Subsequent visits: data served from SQLite cache (refreshed only on manual refresh)

### Frontend & Rendering
4. Period selector updates chart without network request
5. Period buttons unavailable due to insufficient data are disabled (greyed out)

### Refresh & Correctness
6. Refresh button shows loading state, re-fetches, updates chart; shows error message on failure
7. Returns for 1M/3M/6M/1Y/MAX display "—" when period exceeds available data

---

## Non-Goals / Constraints

- Do not modify `backend/internal/justetf/catalog.go`, `search.go`, `profile.go` or `instrument_service.go`
- Do not add performance data to the existing `instruments` table
- No multi-currency support in v1
- No automatic background fetch for all instruments (on-demand only)
