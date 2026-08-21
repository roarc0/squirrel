package portfolio

import (
	"errors"
	"fmt"
	"strings"
)

const (
	AccountTypeBank   = "bank"
	AccountTypeBroker = "broker"
	AccountTypeOther  = "other"
)

type InterestTier struct {
	ID              int64  `json:"id,omitempty"`
	UpToMinor       *int64 `json:"up_to_minor"`
	FixedRateBPS    *int64 `json:"fixed_rate_bps"`
	ReferenceCode   string `json:"reference_code,omitempty"`
	SpreadBPS       int64  `json:"spread_bps"`
	ResolvedRateBPS int64  `json:"resolved_rate_bps,omitempty"`
}

type Account struct {
	ID                 int64          `json:"id,omitempty"`
	Name               string         `json:"name"`
	Institution        string         `json:"institution"`
	Type               string         `json:"type"`
	Preferred          bool           `json:"preferred"`
	Archived           bool           `json:"archived"`
	Currency           string         `json:"currency"`
	BalanceMinor       int64          `json:"balance_minor"`
	TaxBPS             int64          `json:"tax_bps"`
	AnnualFeeMinor     int64          `json:"annual_fee_minor"`
	Tiers              []InterestTier `json:"tiers"`
	GrossRevenueMinor  int64          `json:"gross_revenue_minor"`
	TaxMinor           int64          `json:"tax_minor"`
	NetRevenueMinor    int64          `json:"net_revenue_minor"`
	HoldingCount       int64          `json:"holding_count"`
	HoldingsValueMinor int64          `json:"holdings_value_minor"`
	TotalAssetsMinor   int64          `json:"total_assets_minor"`
}

type Revenue struct {
	GrossMinor int64 `json:"gross_minor"`
	TaxMinor   int64 `json:"tax_minor"`
	FeesMinor  int64 `json:"fees_minor"`
	NetMinor   int64 `json:"net_minor"`
}

func CalculateRevenue(account Account, references map[string]int64) (Revenue, []InterestTier, error) {
	if err := ValidateAccount(account); err != nil {
		return Revenue{}, nil, err
	}
	resolved := append([]InterestTier(nil), account.Tiers...)
	var numerator, lower int64
	for i := range resolved {
		tier := &resolved[i]
		rate := tier.SpreadBPS
		if tier.FixedRateBPS != nil {
			rate += *tier.FixedRateBPS
		} else {
			var ok bool
			rate, ok = references[strings.ToUpper(tier.ReferenceCode)]
			if !ok {
				return Revenue{}, nil, fmt.Errorf("reference rate %q is not configured", tier.ReferenceCode)
			}
			rate += tier.SpreadBPS
		}
		tier.ResolvedRateBPS = rate

		upper := account.BalanceMinor
		if tier.UpToMinor != nil && *tier.UpToMinor < upper {
			upper = *tier.UpToMinor
		}
		if upper > lower {
			numerator += (upper - lower) * rate
		}
		lower = upper
		if lower >= account.BalanceMinor {
			break
		}
	}
	gross := roundDiv(numerator, 10_000)
	tax := int64(0)
	if gross > 0 {
		tax = roundDiv(gross*account.TaxBPS, 10_000)
	}
	return Revenue{
		GrossMinor: gross,
		TaxMinor:   tax,
		FeesMinor:  account.AnnualFeeMinor,
		NetMinor:   gross - tax - account.AnnualFeeMinor,
	}, resolved, nil
}

func ValidateAccount(account Account) error {
	account.Name = strings.TrimSpace(account.Name)
	account.Currency = strings.ToUpper(strings.TrimSpace(account.Currency))
	if account.Name == "" {
		return errors.New("account name is required")
	}
	if len(account.Currency) != 3 {
		return errors.New("account currency must be a three-letter code")
	}
	if account.Type != "" && account.Type != AccountTypeBank && account.Type != AccountTypeBroker && account.Type != AccountTypeOther {
		return errors.New("account type must be bank, broker, or other")
	}
	if account.BalanceMinor < 0 || account.BalanceMinor > 1_000_000_000_000 {
		return errors.New("account balance is outside the supported range")
	}
	if account.TaxBPS < 0 || account.TaxBPS > 10_000 {
		return errors.New("tax rate must be between 0% and 100%")
	}
	if account.AnnualFeeMinor < 0 {
		return errors.New("annual fee cannot be negative")
	}
	var previous int64
	for i, tier := range account.Tiers {
		if tier.FixedRateBPS == nil && strings.TrimSpace(tier.ReferenceCode) == "" {
			return fmt.Errorf("tier %d requires a fixed or reference rate", i+1)
		}
		if tier.FixedRateBPS != nil && strings.TrimSpace(tier.ReferenceCode) != "" {
			return fmt.Errorf("tier %d cannot have both fixed and reference rates", i+1)
		}
		if tier.FixedRateBPS != nil && (*tier.FixedRateBPS < -10_000 || *tier.FixedRateBPS > 100_000) {
			return fmt.Errorf("tier %d fixed rate is outside the supported range", i+1)
		}
		if tier.SpreadBPS < -10_000 || tier.SpreadBPS > 100_000 {
			return fmt.Errorf("tier %d spread is outside the supported range", i+1)
		}
		if tier.UpToMinor == nil {
			if i != len(account.Tiers)-1 {
				return errors.New("only the last tier can have no upper limit")
			}
			continue
		}
		if *tier.UpToMinor <= previous {
			return errors.New("tier limits must be positive and increasing")
		}
		previous = *tier.UpToMinor
	}
	return nil
}

func roundDiv(value, divisor int64) int64 {
	if value < 0 {
		return -((-value + divisor/2) / divisor)
	}
	return (value + divisor/2) / divisor
}
