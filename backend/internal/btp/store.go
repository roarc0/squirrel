package btp

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) SaveBtpsCache(ctx context.Context, btps []BTP) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM btp_cache`); err != nil {
		return fmt.Errorf("delete old btp_cache: %w", err)
	}

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO btp_cache (
			isin, name, bond_type, price, coupon, expiry_date, maturity_years,
			duration_mac, duration_mod, rate_hike_impact, simple_yield_net,
			simple_yield_gross, ytm_gross, ytm_net, total_return_net,
			total_return_gross, score, tier_rank, is_traded, scraped_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare insert btp_cache: %w", err)
	}
	defer stmt.Close()

	for _, b := range btps {
		isTraded := 0
		if b.IsTraded {
			isTraded = 1
		}
		_, err := stmt.ExecContext(ctx,
			b.ISIN, b.Name, string(b.BondType), b.Price, b.Coupon, b.ExpiryDate, b.MaturityYears,
			b.DurationMac, b.DurationMod, b.RateHikeImpact, b.SimpleYieldNet,
			b.SimpleYieldGross, b.YTMGross, b.YTMNet, b.TotalReturnNet,
			b.TotalReturnGross, b.Score, b.TierRank, isTraded, b.ScrapedAt,
		)
		if err != nil {
			return fmt.Errorf("insert btp %s: %w", b.ISIN, err)
		}
	}

	return tx.Commit()
}

func (s *Store) GetBtps(ctx context.Context, userID string) ([]BTP, string, error) {
	starredSet := make(map[string]bool)
	rowsStarred, err := s.db.QueryContext(ctx, `SELECT isin FROM btp_starred WHERE user_id = ?`, userID)
	if err == nil {
		defer rowsStarred.Close()
		for rowsStarred.Next() {
			var isin string
			if err := rowsStarred.Scan(&isin); err == nil {
				starredSet[isin] = true
			}
		}
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT isin, name, bond_type, price, coupon, expiry_date, maturity_years,
		       duration_mac, duration_mod, rate_hike_impact, simple_yield_net,
		       simple_yield_gross, ytm_gross, ytm_net, total_return_net,
		       total_return_gross, score, tier_rank, is_traded, scraped_at
		FROM btp_cache
		ORDER BY score DESC
	`)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	var result []BTP
	lastUpdated := ""

	for rows.Next() {
		var b BTP
		var bondTypeStr string
		var isTradedInt int
		err := rows.Scan(
			&b.ISIN, &b.Name, &bondTypeStr, &b.Price, &b.Coupon, &b.ExpiryDate, &b.MaturityYears,
			&b.DurationMac, &b.DurationMod, &b.RateHikeImpact, &b.SimpleYieldNet,
			&b.SimpleYieldGross, &b.YTMGross, &b.YTMNet, &b.TotalReturnNet,
			&b.TotalReturnGross, &b.Score, &b.TierRank, &isTradedInt, &b.ScrapedAt,
		)
		if err != nil {
			return nil, "", err
		}
		b.BondType = BondType(bondTypeStr)
		b.IsTraded = isTradedInt == 1
		b.IsStarred = starredSet[b.ISIN]
		if b.ScrapedAt > lastUpdated {
			lastUpdated = b.ScrapedAt
		}
		result = append(result, b)
	}

	return result, lastUpdated, nil
}

func (s *Store) ToggleStar(ctx context.Context, userID string, isin string, starred bool) (bool, error) {
	nowStr := time.Now().Format("2006-01-02 15:04:05")
	if starred {
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO btp_starred (user_id, isin, created_at) VALUES (?, ?, ?)
			ON CONFLICT(user_id, isin) DO NOTHING
		`, userID, isin, nowStr)
		if err != nil {
			return false, err
		}
		return true, nil
	}

	_, err := s.db.ExecContext(ctx, `DELETE FROM btp_starred WHERE user_id = ? AND isin = ?`, userID, isin)
	if err != nil {
		return false, err
	}
	return false, nil
}
