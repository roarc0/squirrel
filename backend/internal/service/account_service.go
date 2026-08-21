package service

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"connectrpc.com/connect"

	"loot/backend/internal/portfolio"
	portv1 "loot/proto/gen/go/v1"
)

func (s *Server) accountsWithRevenue(ctx context.Context) ([]portfolio.Account, error) {
	rates, err := s.store.ListReferenceRates(ctx)
	if err != nil {
		return nil, err
	}
	references := make(map[string]int64, len(rates))
	for _, rate := range rates {
		references[rate.Code] = rate.RateBPS
	}
	accounts, err := s.store.ListAccounts(ctx)
	if err != nil {
		return nil, err
	}
	holdings, err := s.store.ListHoldings(ctx)
	if err != nil {
		return nil, err
	}
	byAccount := make(map[int64]*portfolio.Account, len(accounts))
	for i := range accounts {
		byAccount[accounts[i].ID] = &accounts[i]
	}
	for _, holding := range holdings {
		if account := byAccount[holding.AccountID]; account != nil {
			account.HoldingCount++
			account.HoldingsValueMinor += holding.ValueMinor
		}
	}
	for i := range accounts {
		accounts[i].TotalAssetsMinor = accounts[i].BalanceMinor + accounts[i].HoldingsValueMinor
		if accounts[i].Archived {
			continue
		}
		revenue, resolvedTiers, err := portfolio.CalculateRevenue(accounts[i], references)
		if err != nil {
			return nil, fmt.Errorf("calculate revenue for %s: %w", accounts[i].Name, err)
		}
		accounts[i].Tiers = resolvedTiers
		accounts[i].GrossRevenueMinor = revenue.GrossMinor
		accounts[i].TaxMinor = revenue.TaxMinor
		accounts[i].NetRevenueMinor = revenue.NetMinor
	}
	return accounts, nil
}

func (s *Server) ListAccounts(ctx context.Context, req *connect.Request[portv1.ListAccountsRequest]) (*connect.Response[portv1.ListAccountsResponse], error) {
	accounts, err := s.accountsWithRevenue(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	sortField := ""
	if req.Msg.Sort != nil {
		sortField = *req.Msg.Sort
	}

	if sortField == "" {
		slices.SortStableFunc(accounts, func(a, b portfolio.Account) int {
			if order := cmp.Compare(boolInt(a.Archived), boolInt(b.Archived)); order != 0 {
				return order
			}
			if order := cmp.Compare(b.TotalAssetsMinor, a.TotalAssetsMinor); order != 0 {
				return order
			}
			return cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
		})
	} else {
		columns := map[string]func(portfolio.Account, portfolio.Account) int{
			"name":      func(a, b portfolio.Account) int { return cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)) },
			"type":      func(a, b portfolio.Account) int { return cmp.Compare(a.Type, b.Type) },
			"cash":      func(a, b portfolio.Account) int { return cmp.Compare(a.BalanceMinor, b.BalanceMinor) },
			"holdings":  func(a, b portfolio.Account) int { return cmp.Compare(a.HoldingsValueMinor, b.HoldingsValueMinor) },
			"total":     func(a, b portfolio.Account) int { return cmp.Compare(a.TotalAssetsMinor, b.TotalAssetsMinor) },
			"gross":     func(a, b portfolio.Account) int { return cmp.Compare(a.GrossRevenueMinor, b.GrossRevenueMinor) },
			"per_day":   func(a, b portfolio.Account) int { return cmp.Compare(a.GrossRevenueMinor, b.GrossRevenueMinor) },
			"per_month": func(a, b portfolio.Account) int { return cmp.Compare(a.GrossRevenueMinor, b.GrossRevenueMinor) },
			"per_year":  func(a, b portfolio.Account) int { return cmp.Compare(a.GrossRevenueMinor, b.GrossRevenueMinor) },
			"net":       func(a, b portfolio.Account) int { return cmp.Compare(a.NetRevenueMinor, b.NetRevenueMinor) },
		}
		if err := sortSlice(sortField, accounts, columns); err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
	}

	pbAccounts := make([]*portv1.Account, len(accounts))
	for i, a := range accounts {
		pbAccounts[i] = accountToProto(a)
	}
	return connect.NewResponse(&portv1.ListAccountsResponse{Accounts: pbAccounts}), nil
}

func (s *Server) CreateAccount(ctx context.Context, req *connect.Request[portv1.CreateAccountRequest]) (*connect.Response[portv1.CreateAccountResponse], error) {
	if req.Msg.Account == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("account is required"))
	}
	account := accountFromProto(req.Msg.Account)
	account.ID = 0
	if err := s.store.SaveAccount(ctx, &account); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.CreateAccountResponse{Account: accountToProto(account)}), nil
}

func (s *Server) UpdateAccount(ctx context.Context, req *connect.Request[portv1.UpdateAccountRequest]) (*connect.Response[portv1.UpdateAccountResponse], error) {
	if req.Msg.Account == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("account is required"))
	}
	account := accountFromProto(req.Msg.Account)
	account.ID = req.Msg.Id
	if err := s.store.SaveAccount(ctx, &account); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.UpdateAccountResponse{Account: accountToProto(account)}), nil
}

func (s *Server) DeleteAccount(ctx context.Context, req *connect.Request[portv1.DeleteAccountRequest]) (*connect.Response[portv1.DeleteAccountResponse], error) {
	if err := s.store.DeleteAccount(ctx, req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.DeleteAccountResponse{}), nil
}
