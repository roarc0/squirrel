package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/roarc0/squirrel/backend/internal/auth"
	"github.com/roarc0/squirrel/backend/internal/portfolio"
	"github.com/roarc0/squirrel/backend/internal/store"
	"github.com/roarc0/squirrel/backend/pkg/backtest"
	"github.com/roarc0/squirrel/backend/pkg/riskmetrics"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

func (s *Server) RunBacktest(ctx context.Context, req *connect.Request[portv1.RunBacktestRequest]) (*connect.Response[portv1.RunBacktestResponse], error) {
	r := req.Msg
	invalid := func(err error) (*connect.Response[portv1.RunBacktestResponse], error) {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	options := backtest.Options{Rebalance: r.Rebalance, RiskFree: r.RiskFreeRate, Target: r.TargetReturn}
	if options.Rebalance == "" {
		options.Rebalance = "none"
	}
	if options.Rebalance != "none" && options.Rebalance != "monthly" && options.Rebalance != "annually" {
		return invalid(errors.New("invalid rebalancing schedule"))
	}
	for _, rate := range []float64{r.RiskFreeRate, r.TargetReturn} {
		if math.IsNaN(rate) || math.IsInf(rate, 0) || rate <= -1 {
			return invalid(errors.New("annual rates must be finite and greater than -100%"))
		}
	}
	for _, bound := range []struct {
		text  string
		value *time.Time
	}{{r.StartDate, &options.Start}, {r.EndDate, &options.End}} {
		if bound.text == "" {
			continue
		}
		date, err := time.Parse(time.DateOnly, bound.text)
		if err != nil {
			return invalid(errors.New("dates must use YYYY-MM-DD"))
		}
		if date.After(time.Now().UTC()) {
			return invalid(errors.New("backtest dates cannot be in the future"))
		}
		*bound.value = date
	}
	if !options.Start.IsZero() && !options.End.IsZero() && options.Start.After(options.End) {
		return invalid(errors.New("start date must not follow end date"))
	}
	if r.InitialMinor < 0 || r.MonthlyMinor < 0 || r.InitialMinor > 1e12 || r.MonthlyMinor > 1e12 {
		return invalid(errors.New("investment amounts must be between zero and 10 billion EUR"))
	}
	if len(r.AccountIds) > 50 || len(r.Allocations) > 50 || (len(r.AccountIds) == 0) == (len(r.Allocations) == 0) {
		return invalid(errors.New("select PAC accounts or provide a custom allocation (maximum 50 each)"))
	}
	plans, err := s.backtestPlans(ctx, r)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var isins []string
	for _, plan := range plans {
		var total float64
		allocations := map[string]bool{}
		for _, a := range plan.Allocations {
			if !portfolio.ValidISIN(a.AssetID) || a.Weight <= 0 || a.Weight > 1 || allocations[a.AssetID] {
				return invalid(errors.New("allocations need unique valid ISINs and positive weights"))
			}
			allocations[a.AssetID] = true
			total += a.Weight
			if !seen[a.AssetID] {
				isins = append(isins, a.AssetID)
				seen[a.AssetID] = true
			}
		}
		if len(plan.Allocations) == 0 || total > 1+1e-12 {
			return invalid(fmt.Errorf("%s needs allocations totaling at most 100%%", plan.Name))
		}
	}
	if len(isins) > 50 {
		return invalid(errors.New("a backtest supports at most 50 distinct instruments"))
	}
	// Validate the complete request and catalog membership before fetching history.
	assets := make([]backtest.Asset, len(isins))
	for i, isin := range isins {
		inst, err := s.store.GetInstrumentByISIN(ctx, isin)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if err != nil {
			return invalid(fmt.Errorf("instrument %s must be imported before backtesting", isin))
		}
		assets[i] = backtest.Asset{ID: isin, Name: inst.Name}
	}
	fetched := map[string]string{}
	for i := range assets {
		history, err := s.GetInstrumentPerformance(ctx, connect.NewRequest(&portv1.GetInstrumentPerformanceRequest{Isin: assets[i].ID}))
		if err != nil {
			return nil, connect.NewError(connect.CodeOf(err), fmt.Errorf("history for %s: %w", assets[i].Name, err))
		}
		fetched[assets[i].ID] = history.Msg.FetchedAt
		for _, p := range history.Msg.Series {
			date, err := time.Parse(time.DateOnly, p.Date)
			if err != nil {
				return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("invalid history date for %s", assets[i].ID))
			}
			assets[i].Points = append(assets[i].Points, riskmetrics.Point{Time: date, Price: 1 + float64(p.ChangeBps)/10000})
		}
	}
	result, err := backtest.Run(assets, plans, options)
	if err != nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, err)
	}
	response, err := backtestToProto(result, plans, options, fetched)
	if err != nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, err)
	}
	return connect.NewResponse(response), nil
}

func (s *Server) backtestPlans(ctx context.Context, r *portv1.RunBacktestRequest) ([]backtest.Plan, error) {
	invalid := func(message string) ([]backtest.Plan, error) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New(message))
	}
	if len(r.Allocations) > 0 {
		if r.InitialMinor+r.MonthlyMinor == 0 {
			return invalid("enter an initial investment or monthly contribution")
		}
		plan := backtest.Plan{ID: "custom", Name: "Custom portfolio", Initial: float64(r.InitialMinor) / 100, Monthly: float64(r.MonthlyMinor) / 100}
		for _, a := range r.Allocations {
			plan.Allocations = append(plan.Allocations, backtest.Allocation{AssetID: strings.ToUpper(strings.TrimSpace(a.Isin)), Weight: float64(a.WeightBps) / 10000})
		}
		return []backtest.Plan{plan}, nil
	}
	if r.MonthlyMinor != 0 {
		return invalid("PAC backtests use saved account monthly budgets")
	}
	userID := auth.UserIDOrEmpty(ctx)
	accounts, err := s.store.ListAccounts(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	holdings, err := s.store.ListHoldings(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	owned := map[int64]portfolio.Account{}
	for _, a := range accounts {
		if !a.Archived {
			owned[a.ID] = a
		}
	}
	var plans []backtest.Plan
	seen := map[int64]bool{}
	var budget float64
	for _, id := range r.AccountIds {
		account, ok := owned[id]
		if !ok {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("PAC account not found"))
		}
		if seen[id] {
			return invalid("duplicate PAC account")
		}
		seen[id] = true
		if account.Currency != "EUR" {
			return invalid("backtesting currently supports EUR accounts; historical FX conversion is unavailable")
		}
		if account.PACAmountMinor <= 0 || account.PACAmountMinor > 1e12 {
			return invalid("selected PAC accounts need a positive supported monthly budget")
		}
		plan := backtest.Plan{ID: strconv.FormatInt(id, 10), Name: account.Name, Monthly: float64(account.PACAmountMinor) / 100}
		for _, h := range holdings {
			if h.AccountID != id || h.PACBPS <= 0 {
				continue
			}
			if h.PACFrequency != "" && h.PACFrequency != "monthly" {
				return invalid("this version supports monthly PAC contributions only")
			}
			plan.Allocations = append(plan.Allocations, backtest.Allocation{AssetID: h.InstrumentISIN, Weight: float64(h.PACBPS) / 10000})
		}
		budget += plan.Monthly
		plans = append(plans, plan)
	}
	for i := range plans {
		plans[i].Initial = float64(r.InitialMinor) / 100 * (plans[i].Monthly / budget)
	}
	return plans, nil
}
