package auth

import (
	"context"
	"errors"

	"connectrpc.com/connect"
)

type contextKey struct{}

// WithUser attaches a User to the context.
func WithUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, contextKey{}, u)
}

// UserFromContext extracts the User from context, returns false if absent.
func UserFromContext(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(contextKey{}).(User)
	return u, ok
}

// RequireUser returns the authenticated User or a connect Unauthenticated error.
func RequireUser(ctx context.Context) (User, error) {
	u, ok := UserFromContext(ctx)
	if !ok {
		return User{}, connect.NewError(connect.CodeUnauthenticated, ErrUnauthenticated)
	}
	return u, nil
}

// UserIDOrEmpty returns the authenticated user's Google ID, or "" if auth is not active.
func UserIDOrEmpty(ctx context.Context) string {
	u, ok := UserFromContext(ctx)
	if !ok {
		return ""
	}
	return u.GoogleID
}

// RequireAdmin returns a PermissionDenied error if the user is not the configured admin.
// If adminGoogleID is empty, all admin operations are blocked.
func RequireAdmin(ctx context.Context, adminGoogleID string) error {
	u, err := RequireUser(ctx)
	if err != nil {
		return err
	}
	if adminGoogleID == "" || u.GoogleID != adminGoogleID {
		return connect.NewError(connect.CodePermissionDenied, errors.New("admin only"))
	}
	return nil
}
