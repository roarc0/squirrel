package service

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

func (s *Server) ListReferenceRates(ctx context.Context, req *connect.Request[portv1.ListReferenceRatesRequest]) (*connect.Response[portv1.ListReferenceRatesResponse], error) {
	rates, err := s.store.ListReferenceRates(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	pbRates := make([]*portv1.ReferenceRate, len(rates))
	for i, r := range rates {
		pbRates[i] = referenceRateToProto(r)
	}
	return connect.NewResponse(&portv1.ListReferenceRatesResponse{Rates: pbRates}), nil
}

func (s *Server) UpdateReferenceRate(ctx context.Context, req *connect.Request[portv1.UpdateReferenceRateRequest]) (*connect.Response[portv1.UpdateReferenceRateResponse], error) {
	if err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	if req.Msg.Rate == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("rate is required"))
	}
	rate := referenceRateFromProto(req.Msg.Rate)
	if err := s.store.SaveReferenceRate(ctx, rate); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&portv1.UpdateReferenceRateResponse{}), nil
}

func (s *Server) RefreshReferenceRates(ctx context.Context, _ *connect.Request[portv1.RefreshReferenceRatesRequest]) (*connect.Response[portv1.RefreshReferenceRatesResponse], error) {
	if err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	rates, err := s.ecb.FetchPolicyRates(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, err)
	}
	for _, rate := range rates {
		if err := s.store.SaveReferenceRate(ctx, rate); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	rates, err = s.store.ListReferenceRates(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	pbRates := make([]*portv1.ReferenceRate, len(rates))
	for i, rate := range rates {
		pbRates[i] = referenceRateToProto(rate)
	}
	return connect.NewResponse(&portv1.RefreshReferenceRatesResponse{Rates: pbRates}), nil
}

func (s *Server) ListTaxRates(ctx context.Context, req *connect.Request[portv1.ListTaxRatesRequest]) (*connect.Response[portv1.ListTaxRatesResponse], error) {
	pbRates := make([]*portv1.TaxRate, len(s.taxRates))
	for i, r := range s.taxRates {
		pbRates[i] = taxRateToProto(r)
	}
	return connect.NewResponse(&portv1.ListTaxRatesResponse{Rates: pbRates}), nil
}
