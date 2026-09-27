package portfolio

import "testing"

func TestExchangeTradedProductTypes(t *testing.T) {
	for _, tc := range []struct{ name, current, want string }{
		{"21shares Aave ETP", "", InstrumentTypeETP},
		{"21shares Algorand ETP", InstrumentTypeETF, InstrumentTypeETP},
		{"Product (etp)", InstrumentTypeETF, InstrumentTypeETP},
		{"Physical Gold ETC", InstrumentTypeETF, InstrumentTypeETC},
		{"Crypto ETN", InstrumentTypeETF, InstrumentTypeETN},
		{"ETP: Gold ETC", InstrumentTypeETP, InstrumentTypeETC},
		{"ETP: Bitcoin ETN", InstrumentTypeETP, InstrumentTypeETN},
		{"World UCITS ETF", "", InstrumentTypeETF},
		{"METPLAN World ETF", "", InstrumentTypeETF},
		{"Issuer ETP", InstrumentTypeETN, InstrumentTypeETN},
		{"Issuer ETP", InstrumentTypeStock, InstrumentTypeStock},
	} {
		t.Run(tc.name+tc.current, func(t *testing.T) {
			if got := ResolveInstrumentType(tc.name, tc.current); got != tc.want {
				t.Fatalf("got %q; want %q", got, tc.want)
			}
			inst := Instrument{ISIN: "CH1135202120", Name: tc.name, InstrumentType: tc.want, FundCurrency: "USD", Distribution: "accumulating", Replication: "physical_full"}
			if err := ValidateInstrument(inst); err != nil {
				t.Fatal(err)
			}
		})
	}
}
