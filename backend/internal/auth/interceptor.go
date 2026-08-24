package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"connectrpc.com/connect"
)

// Interceptor is a ConnectRPC server interceptor that validates session tokens.
type Interceptor struct {
	secret string
}

// NewInterceptor creates an Interceptor using the given HMAC secret.
func NewInterceptor(secret string) *Interceptor {
	return &Interceptor{secret: secret}
}

func (i *Interceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		ctx, err := i.authenticate(ctx, req.Header())
		if err != nil {
			return nil, err
		}
		return next(ctx, req)
	}
}

func (i *Interceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

func (i *Interceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		ctx, err := i.authenticate(ctx, conn.RequestHeader())
		if err != nil {
			return err
		}
		return next(ctx, conn)
	}
}

func (i *Interceptor) authenticate(ctx context.Context, h http.Header) (context.Context, error) {
	authHeader := h.Get("Authorization")
	if authHeader == "" {
		return ctx, connect.NewError(connect.CodeUnauthenticated, ErrUnauthenticated)
	}
	token, ok := strings.CutPrefix(authHeader, "Bearer ")
	if !ok {
		return ctx, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid authorization header"))
	}
	user, err := VerifySession(i.secret, token)
	if err != nil {
		return ctx, connect.NewError(connect.CodeUnauthenticated, err)
	}
	return WithUser(ctx, user), nil
}
