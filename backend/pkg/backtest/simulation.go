package backtest

import (
	"errors"
	"fmt"
	"math"
)

// Run invests an initial lump sum plus the first monthly deposit at the first
// close. Subsequent deposits buy at the first calendar-day close of each month.
// Fractional index units represent reinvested distributions. No fees/tax/FX are
// added; residual allocation is zero-interest cash. Rebalancing is internal to
// each plan, after deposits; combined results never transfer money across plans.
func Run(assets []Asset, plans []Plan, options Options) (Result, error) {
	var result Result
	if len(plans) == 0 || len(plans) > 50 {
		return result, errors.New("select between 1 and 50 portfolios")
	}
	if options.Rebalance != "none" && options.Rebalance != "monthly" && options.Rebalance != "annually" {
		return result, errors.New("unknown rebalancing schedule")
	}
	if !finite(options.RiskFree) || options.RiskFree <= -1 || !finite(options.Target) || options.Target <= -1 {
		return result, errors.New("annual rates must be finite and greater than -100%")
	}
	known, used, ids := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, asset := range assets {
		known[asset.ID] = true
	}
	for _, plan := range plans {
		if plan.ID == "" || ids[plan.ID] {
			return result, errors.New("portfolio IDs must be nonempty and unique")
		}
		ids[plan.ID] = true
		if !finite(plan.Initial) || !finite(plan.Monthly) || plan.Initial < 0 || plan.Monthly < 0 || plan.Initial+plan.Monthly <= 0 || plan.Initial > 1e10 || plan.Monthly > 1e10 {
			return result, fmt.Errorf("%s needs a positive initial investment or monthly budget (maximum 10 billion each)", plan.Name)
		}
		var weight float64
		seen := map[string]bool{}
		for _, a := range plan.Allocations {
			if !known[a.AssetID] || seen[a.AssetID] || !finite(a.Weight) || a.Weight <= 0 || a.Weight > 1 {
				return result, fmt.Errorf("%s has an invalid or duplicate allocation", plan.Name)
			}
			seen[a.AssetID], used[a.AssetID] = true, true
			weight += a.Weight
		}
		if len(plan.Allocations) == 0 || weight > 1+1e-12 {
			return result, fmt.Errorf("%s allocations must total at most 100%%", plan.Name)
		}
	}
	if len(used) != len(assets) {
		return result, errors.New("history must contain exactly the allocated instruments")
	}
	h, err := JoinHistory(assets, options.Start, options.End)
	if err != nil {
		return result, err
	}
	result.History = h
	for _, plan := range plans {
		p, err := simulate(h, plan, options.Rebalance)
		if err != nil {
			return Result{}, err
		}
		result.Portfolios = append(result.Portfolios, p)
	}
	result.Combined, err = combine(result.Portfolios)
	return result, err
}

func simulate(h History, plan Plan, rebalance string) (Portfolio, error) {
	p := Portfolio{ID: plan.ID, Name: plan.Name, Days: make([]Day, len(h.Dates))}
	units := make([]float64, len(plan.Allocations))
	var cash, contributed float64
	index := 1.0
	for i, date := range h.Dates {
		value := cash
		for j, a := range plan.Allocations {
			value += units[j] * h.Levels[a.AssetID][i]
		}
		if i > 0 {
			index *= value / p.Days[i-1].Value
		}
		monthChanged := i > 0 && date.Month() != h.Dates[i-1].Month()
		deposit := 0.0
		if i == 0 {
			deposit = plan.Initial + plan.Monthly
		} else if monthChanged {
			deposit = plan.Monthly
		}
		contributed += deposit
		cash += deposit
		for j, a := range plan.Allocations {
			buy := deposit * a.Weight
			units[j] += buy / h.Levels[a.AssetID][i]
			cash -= buy
		}
		value += deposit
		if monthChanged && (rebalance == "monthly" || rebalance == "annually" && date.Year() != h.Dates[i-1].Year()) {
			cash = value
			for j, a := range plan.Allocations {
				units[j] = value * a.Weight / h.Levels[a.AssetID][i]
				cash -= value * a.Weight
			}
		}
		if !finite(value) || !finite(index) || value <= 0 || index <= 0 {
			return p, errors.New("simulation exceeded its numeric range")
		}
		if math.Abs(cash) < 1e-9 {
			cash = 0
		}
		p.Days[i] = Day{Time: date, Value: value, Contributed: contributed, Index: index}
	}
	return p, nil
}

func combine(portfolios []Portfolio) (Portfolio, error) {
	p := Portfolio{ID: "combined", Name: "Combined PACs", Days: make([]Day, len(portfolios[0].Days))}
	index := 1.0
	for i := range p.Days {
		day := Day{Time: portfolios[0].Days[i].Time}
		for _, portfolio := range portfolios {
			day.Value += portfolio.Days[i].Value
			day.Contributed += portfolio.Days[i].Contributed
		}
		if i > 0 {
			index *= (day.Value - (day.Contributed - p.Days[i-1].Contributed)) / p.Days[i-1].Value
		}
		if !finite(day.Value) || !finite(index) || index <= 0 {
			return Portfolio{}, errors.New("combined simulation exceeded its numeric range")
		}
		day.Index = index
		p.Days[i] = day
	}
	return p, nil
}
