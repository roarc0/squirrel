package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// GoogleUserInfo holds the fields we extract from Google's userinfo endpoint.
type GoogleUserInfo struct {
	Sub     string `json:"sub"`
	Email   string `json:"email"`
	Picture string `json:"picture"`
}

func newGoogleOAuthConfig(clientID, clientSecret, redirectURL string) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		Scopes:       []string{"openid", "email", "profile"},
		Endpoint:     google.Endpoint,
	}
}

func googleUserInfo(ctx context.Context, cfg *oauth2.Config, code string) (GoogleUserInfo, error) {
	token, err := cfg.Exchange(ctx, code)
	if err != nil {
		return GoogleUserInfo{}, fmt.Errorf("exchange oauth code: %w", err)
	}
	client := cfg.Client(ctx, token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v3/userinfo")
	if err != nil {
		return GoogleUserInfo{}, fmt.Errorf("fetch user info: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return GoogleUserInfo{}, fmt.Errorf("userinfo status %d", resp.StatusCode)
	}
	var info GoogleUserInfo
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&info); err != nil {
		return GoogleUserInfo{}, fmt.Errorf("decode user info: %w", err)
	}
	if info.Sub == "" || info.Email == "" {
		return GoogleUserInfo{}, fmt.Errorf("userinfo response is missing identity fields")
	}
	return info, nil
}
