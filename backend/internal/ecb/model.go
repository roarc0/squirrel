package ecb

type Metric struct {
	Code            string
	Label           string
	Category        string
	Value           float64
	Unit            string
	ObservedOn      string
	SourceURL       string
	Change1Y        *float64
	Distance52WHigh *float64
	SMA200          *float64
}

type Observation struct {
	Code       string
	ObservedOn string
	Value      float64
}

type MarketContext struct {
	Metrics      []Metric
	Observations []Observation
	Warnings     []string
}
