package portfolio

import (
	"fmt"
	"strings"
	"time"

	"github.com/samber/lo"
)

type DiagnosticSeverity string

const (
	SeverityInfo    DiagnosticSeverity = "info"
	SeverityWarning DiagnosticSeverity = "warning"
	SeverityAlert   DiagnosticSeverity = "alert"
)

type Diagnostic struct {
	ID        string             `json:"id"`
	Category  string             `json:"category"` // cash, drift, cost, overlap, stale, tax
	Severity  DiagnosticSeverity `json:"severity"`
	Title     string             `json:"title"`
	Message   string             `json:"message"`
	HoldingID int64              `json:"holding_id,omitempty"`
	AccountID int64              `json:"account_id,omitempty"`
	ISIN      string             `json:"isin,omitempty"`
}

func EvaluateDiagnostics(accounts []Account, holdings []Holding, instruments []Instrument, baseCurrency string, targetCashMinor int64, now time.Time) []Diagnostic {
	var results []Diagnostic
	baseCurrency = strings.ToUpper(strings.TrimSpace(baseCurrency))

	instByISIN := lo.SliceToMap(instruments, func(inst Instrument) (string, Instrument) {
		return strings.ToUpper(inst.ISIN), inst
	})

	// 1. Emergency Reserve & Cash Diagnostic
	activeAccounts := lo.Filter(accounts, func(acc Account, _ int) bool {
		return !acc.Archived && strings.EqualFold(acc.Currency, baseCurrency)
	})
	totalCashMinor := lo.SumBy(activeAccounts, func(acc Account) int64 {
		return acc.BalanceMinor
	})
	totalHoldingMinor := lo.SumBy(holdings, func(h Holding) int64 {
		if !strings.EqualFold(h.Currency, baseCurrency) {
			return 0
		}
		return h.ValueMinor
	})
	totalAssetsMinor := totalCashMinor + totalHoldingMinor

	if targetCashMinor > 0 {
		if totalCashMinor < targetCashMinor {
			results = append(results, Diagnostic{
				ID:       "cash_below_reserve",
				Category: "cash",
				Severity: SeverityInfo,
				Title:    "Cash Below Emergency Reserve Target",
				Message: fmt.Sprintf(
					"Your liquid cash (%s %.2f) is below your configured emergency reserve target (%s %.2f). Consider allocating surplus income to build your cash buffer.",
					baseCurrency, float64(totalCashMinor)/100, baseCurrency, float64(targetCashMinor)/100,
				),
			})
		} else if totalCashMinor > targetCashMinor+500_00 { // > €500 surplus over target
			surplusMinor := totalCashMinor - targetCashMinor
			results = append(results, Diagnostic{
				ID:       "excessive_cash_reserve",
				Category: "cash",
				Severity: SeverityWarning,
				Title:    "Cash Exceeds Emergency Reserve Target",
				Message: fmt.Sprintf(
					"Your liquid cash (%s %.2f) exceeds your configured emergency reserve target (%s %.2f) by %s %.2f. Consider placing excess cash in yield accounts or investing.",
					baseCurrency, float64(totalCashMinor)/100, baseCurrency, float64(targetCashMinor)/100, baseCurrency, float64(surplusMinor)/100,
				),
			})
		}
	} else if totalAssetsMinor > 200_000 && totalCashMinor > 200_000 {
		cashPct := float64(totalCashMinor) / float64(totalAssetsMinor) * 100
		if cashPct > 35.0 {
			results = append(results, Diagnostic{
				ID:       "excessive_cash",
				Category: "cash",
				Severity: SeverityWarning,
				Title:    "High Idle Cash Ratio",
				Message: fmt.Sprintf(
					"Cash represents %.1f%% of your %s portfolio (%s %.2f cash / %s %.2f total). Consider configuring an emergency cash reserve under Settings.",
					cashPct, baseCurrency, baseCurrency, float64(totalCashMinor)/100, baseCurrency, float64(totalAssetsMinor)/100,
				),
			})
		}
	}

	// 2. Target Allocation Drift Check
	for _, h := range holdings {
		if h.PlannedBPS > 0 {
			actualBPS := h.ActualBPS
			driftBPS := actualBPS - h.PlannedBPS
			if driftBPS > 500 || driftBPS < -500 { // > 5% drift
				direction := "above"
				if driftBPS < 0 {
					direction = "below"
				}
				results = append(results, Diagnostic{
					ID:        fmt.Sprintf("target_drift_%d", h.ID),
					Category:  "drift",
					Severity:  SeverityWarning,
					Title:     "Target Allocation Drift",
					Message:   fmt.Sprintf("%s is %.1f%% %s planned target (Planned: %.1f%%, Actual: %.1f%%). Use Invest & Rebalance to realign.", h.InstrumentName, float64(absInt64(driftBPS))/100, direction, float64(h.PlannedBPS)/100, float64(actualBPS)/100),
					HoldingID: h.ID,
					ISIN:      h.InstrumentISIN,
				})
			}
		}
	}

	// 3. High TER Check
	for _, h := range holdings {
		inst, exists := instByISIN[strings.ToUpper(h.InstrumentISIN)]
		if exists && inst.TERBPS > 40 { // TER > 0.40%
			results = append(results, Diagnostic{
				ID:        fmt.Sprintf("high_ter_%s", inst.ISIN),
				Category:  "cost",
				Severity:  SeverityWarning,
				Title:     "High Expense Ratio (TER)",
				Message:   fmt.Sprintf("%s has a TER of %.2f%%. Consider searching for lower-cost ETF alternatives.", inst.Name, float64(inst.TERBPS)/100),
				HoldingID: h.ID,
				ISIN:      inst.ISIN,
			})
		}
	}

	// 4. Duplicated Index Exposure Overlap
	exposureHoldings := make(map[string][]Holding)
	for _, h := range holdings {
		inst, exists := instByISIN[strings.ToUpper(h.InstrumentISIN)]
		if exists && inst.IndexName != "" {
			idxKey := strings.ToLower(strings.TrimSpace(inst.IndexName))
			exposureHoldings[idxKey] = append(exposureHoldings[idxKey], h)
		}
	}
	for idxKey, hGroup := range exposureHoldings {
		if len(hGroup) >= 2 {
			names := make([]string, len(hGroup))
			for i, h := range hGroup {
				names[i] = h.InstrumentName
			}
			indexLabel := hGroup[0].InstrumentName
			if inst, ok := instByISIN[strings.ToUpper(hGroup[0].InstrumentISIN)]; ok && inst.IndexName != "" {
				indexLabel = inst.IndexName
			}
			results = append(results, Diagnostic{
				ID:       fmt.Sprintf("overlap_%s", idxKey),
				Category: "overlap",
				Severity: SeverityInfo,
				Title:    "Overlapping Exposure Detected",
				Message:  fmt.Sprintf("Multiple holdings (%s) track the same index exposure (%q). Consider consolidating to simplify management.", strings.Join(names, ", "), indexLabel),
			})
		}
	}

	// 5. Stale Instrument Data Check
	for _, h := range holdings {
		inst, exists := instByISIN[strings.ToUpper(h.InstrumentISIN)]
		if exists {
			if inst.DataStatus == InstrumentStatusCatalog {
				results = append(results, Diagnostic{
					ID:        fmt.Sprintf("stale_catalog_%s", inst.ISIN),
					Category:  "stale",
					Severity:  SeverityInfo,
					Title:     "Instrument Profile Not Refreshed",
					Message:   fmt.Sprintf("%s has basic catalog data. Refresh profile to retrieve TER, fund size, and tracking error metrics.", inst.Name),
					HoldingID: h.ID,
					ISIN:      inst.ISIN,
				})
			} else if inst.EnrichedAt != "" {
				if parsed, err := time.Parse(time.RFC3339, inst.EnrichedAt); err == nil {
					if now.Sub(parsed) > 30*24*time.Hour {
						results = append(results, Diagnostic{
							ID:        fmt.Sprintf("stale_days_%s", inst.ISIN),
							Category:  "stale",
							Severity:  SeverityInfo,
							Title:     "Stale Instrument Profile",
							Message:   fmt.Sprintf("%s profile was last refreshed %d days ago.", inst.Name, int(now.Sub(parsed).Hours()/24)),
							HoldingID: h.ID,
							ISIN:      inst.ISIN,
						})
					}
				}
			}
		}
	}

	return results
}

func absInt64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
