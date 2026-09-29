# Squirrel: financial theory and product plan

2026-09-28 · Planning only · Source baseline: `409a56d` plus the existing working-tree changes.

**Recommendation: organize Squirrel around goals, liquidity and portfolio policy, then use product research to implement that policy.** The highest-value changes are better defaults and decision rules; they do not require an optimization engine or architectural rewrite.

This plan extends [the financial correctness review](finance-review-plan.md). It does not reopen completed fixes listed there. Findings below were checked against current source, including the summary/diagnostic flow, ETF alternatives/ranking, BTP scoring, portfolio presets, reserve/FIRE cards, market context and AI context. No personal financial data was inspected, and no application code or tests were changed or executed for this planning task. Financial principles and product design choices are distinguished below; theory does not establish one universally correct allocation, score or withdrawal rate.

**1. Start with an investment policy and explicit goals — highest product priority**

Allocation should reflect the purpose of the money, time horizon and ability to bear losses. Diversification concerns combined portfolio exposures, not the number of products owned. These are the relevant lessons from [Markowitz's portfolio theory](https://www.nobelprize.org/uploads/2018/06/markowitz-lecture.pdf) and [the SEC's allocation guidance](https://www.investor.gov/additional-resources/general-resources/publications-research/info-sheets/beginners-guide-asset).

Today, `proto/v1/profile.proto` stores expenses, reserve preferences and a free-text investor description, while `holding.go` stores targets on individual holdings. Add a small structured plan:

- Goal amount, currency, due date and whether spending can be delayed; start with one long-term investment goal plus reserve and near-term earmarks.
- Essential expenses, reserve months, optional explicit reserve override, recurring investment budget and relevant debt commitments.
- Risk willingness and financial capacity recorded separately. A willingness to accept volatility does not make next year's house deposit suitable for a risky allocation.
- User-selected asset-class targets and review bands, with their scope stated explicitly. Keep product selection and recurring contribution shares separate from strategic weights.

The policy is the source for dashboard status, drift checks, contribution previews and AI context. Extend the existing profile and portfolio code; add goal records only when they have a screen and calculation that consume them. Keep free text for context, not as the only place essential financial inputs exist. Do not require sex/gender to unlock analysis; the current default AI prompt does.

**Acceptance:** a goal due next year and a retirement goal can have different liquidity requirements; changing PAC shares cannot change strategic targets; a policy remains intelligible when a user replaces an ETF. Missing policy inputs produce an incomplete-plan state, not a suitability claim.

**2. Make liquidity and the balance sheet consistent — first functional release**

`OverviewView.tsx` uses the explicit reserve goal and FIRE expenses; `summary_service.go` derives the diagnostic target from monthly expenses × reserve months. `diagnostics.go` suggests investing cash above the target plus 500 currency units, without knowing forthcoming expenditure or restrictions.

Use one reserve calculation everywhere: explicit override when present, otherwise essential monthly expenses × reserve months. Give expenses and goals explicit currencies. Show reserve-eligible accessible cash separately from earmarked and restricted cash. A fixed-term deposit is not automatically emergency liquidity; a bond fund is not a guaranteed deposit.

Calculate available surplus only after reserve, earmarks and known near-term obligations, with each commitment counted once. Let the user identify unallocated cash instead of treating all cash above a fixed threshold as a problem. Keep cash-yield projections labelled as annualized estimates at current rates; they are not contracted future income for variable-rate accounts.

Add optional manually entered liabilities when introducing a net-worth view. Until then, call the total tracked assets. Show contractual debt costs alongside estimated investment outcomes without equating a risky expected return with a certain borrowing cost. Keep deposit-coverage work from the earlier review as a subsequent account enhancement, contingent on verified institution and ownership metadata.

**Acceptance:** all reserve views agree; earmarking money for a purchase removes it from investable surplus; restricted cash does not fully fund the reserve; changing display currency does not silently reinterpret a goal's nominal amount; debt payments are not subtracted twice.

**3. Correct the model portfolios and make exposure visible — immediate correction**

`DraftPortfoliosView.tsx` currently offers:

| Current preset | Problem | Proposed change |
| --- | --- | --- |
| “Classic Core 70 / 30 World & EM” | It is 100% equities with a deliberate 30% EM allocation; “classic” can imply a neutral default. | Name the equity risk and EM tilt explicitly. Offer broad global equity exposure as an educational starting point, with the overall equity weight selected separately. |
| “Boglehead 3-Fund Global Portfolio” | 60% All-World + 20% EM + 20% bonds includes EM inside both equity funds. | Rename it as an EM-tilted example, or use a global equity sleeve plus a defensive sleeve. Do not silently change saved user portfolios. |
| “All-Weather Inflation Balanced” | The name overstates what these arbitrary capital weights establish; the long Treasury sleeve also needs duration and currency-risk explanation. | Call it an illustrative multi-asset allocation and show its assumptions. Do not label it risk parity or inflation protection without supporting analysis. |

The All-World overlap is directly verifiable: Vanguard says the index contains developed and emerging markets. Exact combined EM exposure requires dated weights and consistent country classifications; it is more than the standalone 20%, not exactly 20%. [Vanguard fund objective](https://www.vanguard.co.uk/professional/product/etf/equity/9679/ftse-all-world-ucits).

Stop embedding apparently current TERs and refresh dates in preset definitions. Resolve available metadata from the catalog and show its observation date. `DraftPortfoliosModal.tsx` also contains duplicate presets but has no caller in the inspected source: remove it if still unused when implementing, rather than maintaining two definitions.

Extend Geo & FX Radar incrementally: first separate measured, proxy and unknown exposure; later ingest dated issuer holdings for country, sector, issuer and cross-fund overlap. Preserve explicit unknown coverage. A fund's domicile, trading currency, valuation currency and underlying currency exposure are separate concepts. Track actual hedge currency when available; a boolean hedge flag is insufficient.

**Acceptance:** All-World plus EM is visibly described as extra EM exposure; holding two funds tracking the same index does not imply twice the diversification; unknown look-through weights do not appear as zero risk. Exact overlap analytics wait for actual holdings data.

**4. Change ETF and bond ranking into constrained comparison — immediate and incremental**

The fixed 35/30/15/15/5 ETF weights in `instrument.go` are a product heuristic, not a result of financial theory. Missing tracking metrics currently receive zero points. Alternatives can be labelled better on TER/fund size even when other relevant properties differ.

Default to selecting the required exposure, then comparing comparable products side by side. Keep an optional explainable preference score, clearly separated from data completeness and expected return. Missing data should be “unknown”; it should neither masquerade as poor performance nor acquire a high score through silent reweighting. Replace “strictly better” with the actual supported statement, such as “lower TER; larger fund.”

Define tracking difference consistently, preferably fund total return minus benchmark total return, with matching dates, currency and gross/net benchmark treatment. Show tracking error separately. TER contributes to realized tracking difference, so do not add both as independent realized costs. Include trading spread, commissions, tax estimates and intended holding period before suggesting a switch. [Vanguard on tracking and costs](https://www.vanguard.co.uk/professional/vanguard-365/investment-knowledge/etf-knowledge/what-affects-index-tracking).

For example, a 0.10 percentage-point annual fee reduction on €10,000 saves approximately €10/year at unchanged value; €100 of switching costs takes roughly ten years to recover before compounding and tax-timing effects. Show “insufficient information” when those costs are unknown. Prefer directing new contributions to the chosen product when selling is unnecessary.

For BTPs, `scoring.go` rewards prices below par in `scoreF`, favors certain durations without a user goal in `scoreD`, approximates liquidity from bond type/maturity in `scoreL`, and calls a quadratic fitted net-YTM curve a fair yield. None establishes universal investment quality. Price below par alone does not establish cheapness; yield depends on all cash flows and price. [FINRA on bond yield and return](https://www.finra.org/investors/insights/bond-yield-return).

Replace the default S–F league table with goal-date filters and sortable yield, maturity, duration and cost columns. Keep any curve residual as a descriptive fitted comparison, not fair value or alpha. Restrict comparisons to suitable structures and comparable quote times. Preserve current supported fixed/zero-coupon estimates and their limitations; complete verified settlement, accrued interest and issue-specific schedules before presenting executable yields. Show issuer concentration: many BTP maturities remain exposure to one sovereign. Matching maturity to spending helps plan cash flows but does not eliminate credit, inflation or early-sale risk.

**Acceptance:** crossing par does not earn an automatic quality bonus; missing liquidity data remains unknown; a lower TER alone cannot trigger a switch recommendation; unsupported bond terms cannot enter precise yield comparisons.

**5. Rebalance from contributions, within a policy — after steps 1–2**

Use new contributions to reduce target shortfalls before previewing sales. This is a recognized rebalancing method; fees and taxes matter. [SEC rebalancing guidance](https://www.investor.gov/additional-resources/general-resources/publications-research/info-sheets/beginners-guide-asset).

Start with a deterministic preview using the existing holdings and PAC fields. Compute targets against the post-contribution total, allocate within underweight sleeves, then respect tradable increments and show residual cash. If quantities/prices are missing, provide currency-budget suggestions only. Keep per-account funding constraints explicit. Distinguish external new money from cash already inside the investment scope, which must not increase its total twice.

Replace the universal five-percentage-point alert with explicit policy bands. Make “no action needed” a normal outcome. Show before/after weights and costs. Sales remain an optional preview requiring reliable cost-basis/tax inputs, not an automatic action. A new ETF in the same sleeve should not force a strategic policy change.

**Acceptance:** a €10,000 70/30 portfolio targeting 60/40 receives €1,000 of external money: allocating the full €1,000 to bonds gives €7,000/€4,000, or approximately 63.6/36.4, without claiming the target is fully restored. No recommendation spends the reserve or exceeds a funding account's budget.

**6. Add cash-flow-aware performance — separate, larger milestone**

`App.tsx:PerformanceResult` calculates `(value − invested) / invested`. Label it “change versus entered invested amount” until the meaning of invested amount is reconciled; do not call it annualized or total investment return. Deposits, withdrawals, distributions and sales prevent it from measuring full performance reliably.

Add a minimal dated activity ledger for external contributions/withdrawals, linked internal transfers, buys/sells, distributions, fees and taxes. Record currency, source and reconciliation status; add fractional quantities and prices where needed using decimal-safe storage rather than rounding units to money cents. Preserve existing manual valuations and snapshots.

Support an opening valuation on a chosen tracking start date. Do not infer historical purchases or tax cost basis from snapshots. A change in valuation is not automatically a cash flow, and a reconciliation adjustment must be explicit. Start with wealth change, net contributions and money-weighted return/XIRR. Add time-weighted returns only when valuations at external flows or a clearly labelled approximation are available. Benchmark comparisons must use matching currency, dates, total-return treatment and return methodology. [GIPS methodology](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/) supports these distinctions; this is not a GIPS compliance project.

**Acceptance:** depositing €1,000 into a €10,000 portfolio with no market movement gives €11,000 wealth and zero investment gain; moving money between tracked accounts is not a portfolio contribution; reinvested distributions count once; missing history and undefined/ambiguous IRR results are explained. Previewable imports must detect duplicates and reconcile before committing.

**7. Replace FIRE certainty and market signals with explicit scenarios — staged**

`OverviewView.tsx` currently labels 4% of all tracked wealth as “Safe Income” and 25× expenses as a reached FIRE target. Immediately rename these as withdrawal assumptions. Later expose horizon, spendable investment assets, pensions/other income, taxes, fees, inflation and spending flexibility. Distinguish an initial withdrawal increased with inflation from withdrawing a fixed percentage of the changing balance: these are different policies.

Start with user-editable scenarios and a bad-early-returns sequence, not an uncalibrated probability of success. Retirement outcomes depend on sequence risk and spending rules; no fixed rate is universally safe. [Morningstar's original retirement-income research](https://www.morningstar.com/content/cs-assets/v3/assets/blt9415ea4cc4157833/bltb73b87c5d0c70ead/692f43f57737a31596684522/working_file_11.19_FINAL_REVISE.pdf). Use `(1 + nominal return) / (1 + inflation) − 1` for matched-period real return; never subtract costs again from a return already net of those costs. Earmarked assets must not fund two goals simultaneously.

Keep Market Context under research. `MarketContextView.tsx` defaults a missing recession score to 66 and missing drawdown to “Near Peak”; replace such fallbacks with unavailable states immediately. A published indicator score is not a calibrated probability, and a macro indicator is not itself a tradable signal. The difficulty of short-term forecasting supports requiring evidence before using these indicators to alter allocation. [Nobel scientific background on asset-price predictability](https://www.nobelprize.org/uploads/2013/10/advanced-economicsciences2013.pdf).

Have the AI explain the saved policy, sources, missing data and scenario assumptions using deterministic backend calculations. Preserve its read-only tools. Do not let prose convert a comparison score into a claim of expected outperformance; explain the status quo before suggesting action. Treat prompt changes as guidance, with missing-data checks enforced in the underlying tools.

**Acceptance:** missing market data never becomes a numeric signal; identical return sequences in different orders can produce different withdrawal outcomes; the UI cannot claim retirement is safe from assets/expenses alone; AI and UI use the same scope and figures.

**Proposed navigation**

Reuse existing screens and routes where possible; preserve old deep links when grouping them.

| Area | Contents | Existing screens reused |
| --- | --- | --- |
| Overview | Tracked assets, liquidity, goal progress, data quality, policy exceptions | Overview and diagnostics |
| Plan | Goals, reserve, policy, contributions, rebalance preview, withdrawal scenarios | Settings finance fields, Allocation Strategy, Sandbox, FIRE card |
| Portfolio | Accounts, holdings, exposure; activity/performance once available | Accounts, Investments, Geo & FX Radar |
| Research | ETF comparison, bond comparison, market context | Instruments, BTP Rank, Market Context |
| Assistant | Explain the portfolio and plan with evidence | Portfolio Advisor |

This arrangement is a product recommendation, not a requirement of financial theory. Keep Settings for application preferences, data management and provider setup. Avoid blank new navigation sections before their content ships.

**Delivery order and completion gates**

| Release | Scope | Dependencies | Relative effort | Completion gate |
| --- | --- | --- | --- | --- |
| A — trustworthy defaults | Rename FIRE and performance outputs; explicit preset tilts; honest missing-data states; expose score limitations and remove par-price bonus | None beyond current code | Small–medium | Regression checks for each changed rule; synthetic missing-data/preset review; no saved allocations changed |
| B — one financial plan | Canonical reserve/currency, earmarks and optional debt; structured goal/policy; contribution preview; group existing navigation | A; decide portfolio scope before migrations | Medium | Reserve and target invariants; budget conservation; profile/backup round trip; old links and manual workflow preserved |
| C — evidence behind comparisons | Comparable ETF metrics and costs; verified bond terms; dated exposure coverage and look-through where a usable source exists | A; reliable provider data, B for suitability | Medium–large, split by data source | No precision beyond source quality; bond repricing/duration checks; unknown coverage visible |
| D — measured outcomes | Activity ledger, reconciliation, money-weighted returns, compatible benchmark; extend withdrawal scenarios | B plus dated flows/valuations for performance | Large, separate milestone | Transfer/deposit/distribution invariants; ambiguous IRR handling; transactional import and backup round trip |

Steps C and D are independent once their inputs exist. Scenarios can ship after B using explicitly hypothetical returns; they need not wait for a complete ledger. Implement each calculation once in the existing Go domain package and expose it through existing RPC/MCP paths. Keep SQLite, the single binary, manual entry and current UI stack.

Use the existing test infrastructure: one focused regression per new financial rule, migration/backup checks for persisted changes, then `just test` and the affected UI build/manual checks. This plan does not claim those checks have run.

Defer Monte Carlo infrastructure, automatic trading, broad broker integrations, a full Italian tax engine, efficient-frontier optimization and forecast-driven allocation. Revisit only with a concrete user need, suitable data and validation against simpler approaches. Start with release A, then the reserve/policy/contribution path in B: those improve actual decisions before adding analytical complexity.
