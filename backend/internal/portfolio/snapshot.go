package portfolio

import (
	"errors"
	"strings"
	"time"
)

type Snapshot struct {
	ID             int64  `json:"id"`
	ObservedOn     string `json:"observed_on"`
	Currency       string `json:"currency"`
	CashMinor      int64  `json:"cash_minor"`
	InvestedMinor  int64  `json:"invested_minor"`
	PortfolioMinor int64  `json:"portfolio_minor"`
	TotalMinor     int64  `json:"total_minor"`
}

func ValidateSnapshot(snapshot Snapshot) error {
	if _, err := time.Parse(time.DateOnly, snapshot.ObservedOn); err != nil {
		return errors.New("snapshot date must use YYYY-MM-DD")
	}
	if len(strings.TrimSpace(snapshot.Currency)) != 3 {
		return errors.New("snapshot currency must be a three-letter code")
	}
	if snapshot.CashMinor < 0 || snapshot.InvestedMinor < 0 || snapshot.PortfolioMinor < 0 || snapshot.CashMinor > 1_000_000_000_000 || snapshot.InvestedMinor > 1_000_000_000_000 || snapshot.PortfolioMinor > 1_000_000_000_000 {
		return errors.New("snapshot values are outside the supported range")
	}
	return nil
}
