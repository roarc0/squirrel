// Package backtest simulates funded portfolios and analyzes their time-weighted
// return histories. It has no database, network, protobuf or UI dependencies.
package backtest

import (
	"math"
	"time"

	"github.com/roarc0/squirrel/backend/pkg/riskmetrics"
)

type Asset struct {
	ID     string
	Name   string
	Points []riskmetrics.Point
}

type Allocation struct {
	AssetID string
	Weight  float64 // fraction of each deposit; unused weight stays in cash
}

type Plan struct {
	ID, Name         string
	Initial, Monthly float64 // currency units, not cents
	Allocations      []Allocation
}

type Options struct {
	Start, End       time.Time // optional inclusive UTC dates
	Rebalance        string    // none, monthly or annually (calendar boundaries)
	RiskFree, Target float64   // effective annual fractions
}

type Day struct {
	Time                      time.Time
	Value, Contributed, Index float64 // Index is a unitized, cash-flow-neutral level
}

type Portfolio struct {
	ID, Name string
	Days     []Day
}

type Coverage struct {
	ID, Name   string
	Start, End time.Time
}

type History struct {
	Dates    []time.Time
	Levels   map[string][]float64
	Coverage []Coverage
}

type Result struct {
	History    History
	Combined   Portfolio
	Portfolios []Portfolio
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func number(v float64) *float64 {
	if !finite(v) {
		return nil
	}
	return &v
}

func levels(days []Day) []riskmetrics.Point {
	points := make([]riskmetrics.Point, len(days))
	for i, day := range days {
		points[i] = riskmetrics.Point{Time: day.Time, Price: day.Index}
	}
	return points
}
