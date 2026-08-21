package portfolio

type ReferenceRate struct {
	Code       string `json:"code"`
	Label      string `json:"label"`
	RateBPS    int64  `json:"rate_bps"`
	ObservedOn string `json:"observed_on"`
	UpdatedAt  string `json:"updated_at,omitempty"`
}

type TaxRate struct {
	Code    string `json:"code" yaml:"code"`
	Label   string `json:"label" yaml:"label"`
	RateBPS int64  `json:"rate_bps" yaml:"rate_bps"`
}
