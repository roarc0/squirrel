package auth

import "errors"

// User is the authenticated identity attached to a request context.
type User struct {
	GoogleID string
	Email    string
}

var ErrUnauthenticated = errors.New("unauthenticated")
