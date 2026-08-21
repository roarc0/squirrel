export type ReferenceRate = {
  code: string;
  label: string;
  rate_bps: number;
  observed_on: string;
  updated_at?: string;
};

export type TaxRate = { code: string; label: string; rate_bps: number };

export type InterestTier = {
  id?: number;
  up_to_minor: number | null;
  fixed_rate_bps: number | null;
  reference_code?: string;
  spread_bps: number;
  resolved_rate_bps?: number;
};

export type Account = {
  id: number;
  name: string;
  institution: string;
  type: 'bank' | 'broker' | 'other';
  preferred: boolean;
  archived: boolean;
  currency: string;
  balance_minor: number;
  tax_bps: number;
  annual_fee_minor: number;
  tiers: InterestTier[] | null;
  gross_revenue_minor: number;
  tax_minor: number;
  net_revenue_minor: number;
  holding_count: number;
  holdings_value_minor: number;
  total_assets_minor: number;
};

export type CurrencySummary = {
  currency: string;
  balance_minor: number;
  gross_revenue_minor: number;
  tax_minor: number;
  fees_minor: number;
  net_revenue_minor: number;
  invested_minor: number;
  portfolio_minor: number;
  total_minor: number;
  allocations: { asset_class: string; value_minor: number }[] | null;
};

export type Summary = { base_currency: string; currencies: CurrencySummary[] | null };

export type InstrumentType = 'etf' | 'etc' | 'etn' | 'fund' | 'stock' | 'bond' | 'crypto' | 'commodity' | 'real_estate' | 'other';

export type Instrument = {
  id: number;
  isin: string;
  name: string;
  ticker?: string;
  instrument_type: InstrumentType;
  provider?: string;
  index_name?: string;
  investment_focus?: string;
  asset_class?: string;
  strategy?: string;
  currency_hedged: boolean;
  starred: boolean;
  data_status: 'catalog' | 'enriched';
  distribution: 'accumulating' | 'distributing';
  replication: 'physical_full' | 'physical_sampling' | 'synthetic';
  domicile?: string;
  fund_currency: string;
  ter_bps: number;
  fund_size_million: number;
  inception_date?: string;
  tracking_difference_bps: number | null;
  tracking_error_bps: number | null;
  ucits: boolean;
  source_url?: string;
  refreshed_at?: string;
  enriched_at?: string;
};

export type InstrumentAlternative = {
  instrument: Instrument;
  match: 'exact_index' | 'same_exposure';
  better: boolean;
  score: number;
  reasons: string[];
};

export type Holding = {
  id: number;
  account_id: number;
  instrument_id: number;
  account_name?: string;
  currency?: string;
  instrument_name?: string;
  instrument_isin?: string;
  instrument_ticker?: string;
  instrument_type?: InstrumentType;
  asset_class?: string;
  invested_minor: number;
  value_minor: number;
  tax_bps: number;
  planned_bps: number;
  actual_bps: number;
};

export type Snapshot = {
  id: number;
  observed_on: string;
  currency: string;
  cash_minor: number;
  invested_minor: number;
  portfolio_minor: number;
  total_minor: number;
};

export type RankedInstrument = {
  instrument: Instrument;
  total: number;
  cost: number;
  tracking_difference: number;
  tracking_error: number;
  size: number;
  age: number;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `${response.status} ${response.statusText}`);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
