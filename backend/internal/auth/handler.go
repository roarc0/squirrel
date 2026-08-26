package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"golang.org/x/oauth2"
)

// DataClaimer assigns unclaimed data (user_id=”) to the admin on first login.
type DataClaimer interface {
	ClaimAdminData(ctx context.Context, googleID string) error
}

// Handler serves the Google OAuth login, callback, and me endpoints.
type Handler struct {
	oauth         *oauth2.Config
	secret        string
	adminGoogleID string
	claimer       DataClaimer
}

// NewHandler creates a Handler. redirectURL must match the one registered in Google Cloud Console.
func NewHandler(clientID, clientSecret, redirectURL, secret, adminGoogleID string, claimer DataClaimer) *Handler {
	return &Handler{
		oauth:         newGoogleOAuthConfig(clientID, clientSecret, redirectURL),
		secret:        secret,
		adminGoogleID: adminGoogleID,
		claimer:       claimer,
	}
}

// Login redirects the browser to Google's OAuth consent screen.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	state, err := randomState()
	if err != nil {
		http.Error(w, "oauth state creation failed", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600,
	})
	http.Redirect(w, r, h.oauth.AuthCodeURL(state), http.StatusFound)
}

// Callback handles the Google redirect, creates a session, and sends the token to the SPA.
func (h *Handler) Callback(w http.ResponseWriter, r *http.Request) {
	stateCookie, err := r.Cookie("oauth_state")
	if err != nil || stateCookie.Value != r.URL.Query().Get("state") {
		http.Error(w, "invalid oauth state", http.StatusBadRequest)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "oauth_state", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1})

	info, err := googleUserInfo(r.Context(), h.oauth, r.URL.Query().Get("code"))
	if err != nil {
		slog.ErrorContext(r.Context(), "google oauth exchange failed", "error", err)
		http.Error(w, "oauth exchange failed", http.StatusInternalServerError)
		return
	}

	if h.adminGoogleID != "" && info.Sub == h.adminGoogleID {
		if err := h.claimer.ClaimAdminData(r.Context(), info.Sub); err != nil {
			slog.WarnContext(r.Context(), "claim admin data failed", "error", err)
		}
	}

	token, err := SignSession(h.secret, info.Sub, info.Email, info.Picture)
	if err != nil {
		http.Error(w, "session creation failed", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/#token="+token, http.StatusFound)
}

// Me returns the currently authenticated user's info as JSON.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(authHeader, "Bearer ")
	if !ok || token == "" {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	user, err := VerifySession(h.secret, token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	isAdmin := h.adminGoogleID != "" && user.GoogleID == h.adminGoogleID
	json.NewEncoder(w).Encode(map[string]any{
		"google_id": user.GoogleID,
		"email":     user.Email,
		"is_admin":  isAdmin,
		"picture":   user.Picture,
	})
}

func randomState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
