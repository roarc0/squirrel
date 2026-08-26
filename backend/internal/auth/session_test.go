package auth

import (
	"strings"
	"testing"
)

func TestSessionRejectsWeakInputsAndAlteredHeaders(t *testing.T) {
	if _, err := SignSession("short", "user", "", ""); err == nil {
		t.Fatal("weak session secret accepted")
	}
	token, err := SignSession("12345678901234567890123456789012", "user", "user@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	parts[0] = "eyJhbGciOiJub25lIn0"
	if _, err := VerifySession("12345678901234567890123456789012", strings.Join(parts, ".")); err == nil {
		t.Fatal("altered JWT header accepted")
	}
	if user, err := VerifySession("12345678901234567890123456789012", token); err != nil || user.GoogleID != "user" {
		t.Fatalf("valid session failed: user=%+v err=%v", user, err)
	}
}
