package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const sessionDuration = 30 * 24 * time.Hour

type sessionClaims struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Exp   int64  `json:"exp"`
	Iat   int64  `json:"iat"`
}

var jwtHeader = base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))

// SignSession creates a signed HS256 JWT for the given Google identity.
func SignSession(secret, googleID, email string) (string, error) {
	claims := sessionClaims{
		Sub:   googleID,
		Email: email,
		Exp:   time.Now().Add(sessionDuration).Unix(),
		Iat:   time.Now().Unix(),
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	sigInput := jwtHeader + "." + encodedPayload
	return sigInput + "." + hmacSHA256(secret, sigInput), nil
}

// VerifySession validates an HS256 JWT and returns the User it encodes.
func VerifySession(secret, token string) (User, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return User{}, errors.New("malformed token")
	}
	expected := hmacSHA256(secret, parts[0]+"."+parts[1])
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return User{}, errors.New("invalid token signature")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return User{}, errors.New("invalid token encoding")
	}
	var claims sessionClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return User{}, errors.New("invalid token claims")
	}
	if time.Now().Unix() > claims.Exp {
		return User{}, errors.New("token expired")
	}
	return User{GoogleID: claims.Sub, Email: claims.Email}, nil
}

func hmacSHA256(secret, data string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(data))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
