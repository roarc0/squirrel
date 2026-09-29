import type { Instrument } from '../api.ts';

export type Numeric = string | number;
export const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
export const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

export interface RankFilterState {
  indexQuery: string;
  assetClasses: string[];
  distributions: string[];
  replications: string[];
  domiciles: string[];
  currencies: string[];
  issuers: string[];
  currencyHedged: string;
  maxTER: Numeric;
  minSize: Numeric;
  minAge: Numeric;
}

export interface RankPreset {
  id: string;
  name: string;
  builtIn?: boolean;
  filters: RankFilterState;
}

export const defaultRankFilters: RankFilterState = {
  indexQuery: '',
  assetClasses: [],
  distributions: [],
  replications: [],
  domiciles: [],
  currencies: [],
  issuers: [],
  currencyHedged: '',
  maxTER: '',
  minSize: 100,
  minAge: 3,
};

export const builtInPresets: RankPreset[] = [
  {
    id: 'core-world-acc',
    name: 'Core World (Acc)',
    builtIn: true,
    filters: {
      ...defaultRankFilters,
      indexQuery: 'MSCI World',
      assetClasses: ['equity'],
      distributions: ['accumulating'],
      replications: ['physical_full', 'physical_sampling'],
      domiciles: ['IE', 'LU'],
      maxTER: 0.25,
      minSize: 500,
      minAge: 3,
    },
  },
  {
    id: 'all-world-equity',
    name: 'All-World Equities',
    builtIn: true,
    filters: {
      ...defaultRankFilters,
      assetClasses: ['equity'],
      distributions: ['accumulating'],
      minSize: 100,
      minAge: 3,
    },
  },
  {
    id: 'low-cost-physical',
    name: 'Low-Cost Physical (≤ 0.20%)',
    builtIn: true,
    filters: {
      ...defaultRankFilters,
      distributions: ['accumulating'],
      replications: ['physical_full', 'physical_sampling'],
      maxTER: 0.20,
      minSize: 200,
      minAge: 3,
    },
  },
  {
    id: 'bonds-core',
    name: 'Bonds & Fixed Income',
    builtIn: true,
    filters: {
      ...defaultRankFilters,
      assetClasses: ['bond'],
      currencies: ['EUR'],
      minSize: 100,
      minAge: 2,
    },
  },
  {
    id: 'dividend-dist',
    name: 'Dividend & Distributing',
    builtIn: true,
    filters: {
      ...defaultRankFilters,
      distributions: ['distributing'],
      assetClasses: ['equity'],
      minSize: 100,
      minAge: 0,
    },
  },
  {
    id: 'commodities',
    name: 'Commodities',
    builtIn: true,
    filters: {
      ...defaultRankFilters,
      assetClasses: ['commodity'],
      minSize: 50,
      minAge: 0,
    },
  },
];

export function loadSavedRankFilters(): RankFilterState {
  try {
    if (typeof localStorage === 'undefined') return defaultRankFilters;
    const raw = localStorage.getItem('squirrel.rankFilters.v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaultRankFilters,
        ...parsed,
        distributions: Array.isArray(parsed.distributions) ? parsed.distributions : (parsed.distribution ? [parsed.distribution] : []),
        replications: Array.isArray(parsed.replications) ? parsed.replications : (parsed.replication ? [parsed.replication] : []),
        assetClasses: Array.isArray(parsed.assetClasses) ? parsed.assetClasses : (parsed.assetClass ? [parsed.assetClass] : []),
        domiciles: Array.isArray(parsed.domiciles) ? parsed.domiciles : (typeof parsed.domicile === 'string' && parsed.domicile ? parsed.domicile.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean) : []),
        currencies: Array.isArray(parsed.currencies) ? parsed.currencies : [],
        issuers: Array.isArray(parsed.issuers) ? parsed.issuers : [],
      };
    }
  } catch {}
  return defaultRankFilters;
}

export function saveRankFilters(filters: RankFilterState) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('squirrel.rankFilters.v2', JSON.stringify(filters));
  } catch {}
}

export function loadCustomPresets(): RankPreset[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem('squirrel.rankPresets.v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveCustomPresets(presets: RankPreset[]) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('squirrel.rankPresets.v2', JSON.stringify(presets));
  } catch {}
}

export function matchesRankFilters(
  instrument: Partial<Instrument>,
  rankFilters: RankFilterState,
  asOf: number = Date.now()
): boolean {
  if (instrument.instrument_type !== 'etf' || instrument.data_status !== 'enriched' || !instrument.ucits) {
    return false;
  }
  if (rankFilters.indexQuery) {
    const q = rankFilters.indexQuery.trim().toLowerCase();
    const match = [
      instrument.index_name,
      instrument.investment_focus,
      instrument.name,
      instrument.ticker,
    ].some(val => val?.toLowerCase().includes(q));
    if (!match) return false;
  }
  if (rankFilters.distributions.length > 0) {
    if (!instrument.distribution || !rankFilters.distributions.includes(instrument.distribution)) return false;
  }
  if (rankFilters.replications.length > 0) {
    if (!instrument.replication || !rankFilters.replications.includes(instrument.replication)) return false;
  }
  if (rankFilters.assetClasses.length > 0) {
    if (!instrument.asset_class || !rankFilters.assetClasses.some(ac => ac.toLowerCase() === instrument.asset_class!.toLowerCase())) return false;
  }
  if (rankFilters.domiciles.length > 0) {
    const instDom = (instrument.domicile || '').toUpperCase();
    if (!rankFilters.domiciles.some(d => d.toUpperCase() === instDom)) return false;
  }
  if (rankFilters.currencies.length > 0) {
    if (!instrument.fund_currency || !rankFilters.currencies.includes(instrument.fund_currency)) return false;
  }
  if (rankFilters.issuers.length > 0) {
    if (!instrument.provider || !rankFilters.issuers.includes(instrument.provider)) return false;
  }
  if (rankFilters.currencyHedged === 'hedged' && !instrument.currency_hedged) return false;
  if (rankFilters.currencyHedged === 'unhedged' && instrument.currency_hedged) return false;
  if (rankFilters.maxTER !== '' && (instrument.ter_bps ?? 0) > bps(rankFilters.maxTER)) return false;
  if (rankFilters.minSize !== '' && (instrument.fund_size_million ?? 0) < n(rankFilters.minSize)) return false;
  if (rankFilters.minAge !== '') {
    if (!instrument.inception_date) return false;
    const parsed = new Date(instrument.inception_date).getTime();
    if (isNaN(parsed)) return false;
    const age = (asOf - parsed) / (365.25 * 24 * 3600 * 1000);
    if (age < n(rankFilters.minAge)) return false;
  }
  return true;
}
