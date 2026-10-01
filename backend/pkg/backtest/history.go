package backtest

import (
	"errors"
	"fmt"
	"sort"
	"time"
)

// JoinHistory clips to the intersection of real histories and requested bounds.
// Input must be sorted, unique, positive UTC-midnight levels. Missing calendar
// days INSIDE the effective window are errors: no forward-fill or proxy splice.
func JoinHistory(assets []Asset, start, end time.Time) (History, error) {
	h := History{Levels: make(map[string][]float64)}
	if len(assets) == 0 || len(assets) > 50 {
		return h, errors.New("select between 1 and 50 instruments")
	}
	for _, bound := range []time.Time{start, end} {
		if !bound.IsZero() && !bound.Equal(bound.UTC().Truncate(24*time.Hour)) {
			return h, errors.New("bounds must be UTC dates")
		}
	}
	if !start.IsZero() && !end.IsZero() && start.After(end) {
		return h, errors.New("start date must not follow end date")
	}
	seen := map[string]bool{}
	for _, asset := range assets {
		if asset.ID == "" || seen[asset.ID] {
			return h, errors.New("instrument IDs must be nonempty and unique")
		}
		seen[asset.ID] = true
		if len(asset.Points) < 2 {
			return h, fmt.Errorf("%s needs at least two observations", asset.ID)
		}
		for i, p := range asset.Points {
			if p.Time.IsZero() || !p.Time.Equal(p.Time.UTC().Truncate(24*time.Hour)) || !finite(p.Price) || p.Price <= 0 {
				return h, fmt.Errorf("%s has an invalid observation", asset.ID)
			}
			if i > 0 && !p.Time.After(asset.Points[i-1].Time) {
				return h, fmt.Errorf("%s dates must be unique and increasing", asset.ID)
			}
		}
		first, last := asset.Points[0].Time, asset.Points[len(asset.Points)-1].Time
		h.Coverage = append(h.Coverage, Coverage{ID: asset.ID, Name: asset.Name, Start: first, End: last})
		if start.IsZero() || first.After(start) {
			start = first
		}
		if end.IsZero() || last.Before(end) {
			end = last
		}
	}
	if !end.After(start) {
		return h, errors.New("the instruments have no shared history in this date range")
	}
	days := int(end.Sub(start).Hours()/24) + 1
	if days > 36525 {
		return h, errors.New("backtests support at most 100 years")
	}
	h.Dates = make([]time.Time, days)
	for i := range h.Dates {
		h.Dates[i] = start.AddDate(0, 0, i)
	}
	for _, asset := range assets {
		from := sort.Search(len(asset.Points), func(i int) bool { return !asset.Points[i].Time.Before(start) })
		prices := make([]float64, days)
		for i, date := range h.Dates {
			if from+i >= len(asset.Points) || !asset.Points[from+i].Time.Equal(date) {
				return h, fmt.Errorf("%s has missing history on %s; refresh it or choose another period", asset.ID, date.Format(time.DateOnly))
			}
			prices[i] = asset.Points[from+i].Price
		}
		h.Levels[asset.ID] = prices
	}
	return h, nil
}
