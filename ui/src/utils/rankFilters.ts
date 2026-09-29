import type { Instrument } from '../api.ts';

export type Numeric = string | number;
export const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
export const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

export interface InstrumentFilters {
  query: string;
  excludeQuery?: string;
  esg?: string; // '' | 'esg' | 'non_esg'
  assetClasses: string[];
  excludeAssetClasses: string[];
  distributions: string[];
  excludeDistributions: string[];
  replications: string[];
  excludeReplications: string[];
  strategies: string[];
  excludeStrategies: string[];
  domiciles: string[];
  excludeDomiciles: string[];
  currencies: string[];
  excludeCurrencies: string[];
  issuers: string[];
  excludeIssuers: string[];
  types: string[];
  excludeTypes: string[];
  currencyHedged: string;
  ucits: string;
  maxTER: Numeric;
  minSize: Numeric;
  minAge: Numeric;
  maxTrackingDiff: Numeric;
  maxTrackingError: Numeric;
}

export type RankFilterState = InstrumentFilters;

export interface FilterPreset {
  id: string;
  name: string;
  builtIn?: boolean;
  filters: InstrumentFilters;
}

export type RankPreset = FilterPreset;

export function isESG(instrument: Partial<Instrument>): boolean {
  if (instrument.strategy === 'esg') return true;
  const text = [
    instrument.name,
    instrument.index_name,
    instrument.investment_focus,
  ].filter(Boolean).join(' ').toLowerCase();

  return (
    /\b(esg|sri|screened|climate|paris|sustainable|sustainability|clean energy|socially responsible)\b/.test(text) ||
    text.includes('paris-aligned') ||
    text.includes('low carbon')
  );
}

export function resolveInstrumentProvider(instrument: Partial<Instrument>): string {
  const prov = instrument.provider?.trim();
  if (prov && prov.toLowerCase() === 'american century') return 'Avantis';
  if (instrument.name && instrument.name.toLowerCase().startsWith('avantis')) return 'Avantis';
  return prov || '';
}

export function parseSearchTerms(query: string = '', excludeQuery: string = ''): { includes: string[]; excludes: string[] } {
  const includes: string[] = [];
  const excludes: string[] = [];

  // Parse words from main query
  const queryTokens = query.trim().split(/\s+/).filter(Boolean);
  for (const token of queryTokens) {
    if ((token.startsWith('-') || token.startsWith('!')) && token.length > 1) {
      const term = token.slice(1).toLowerCase();
      if (term && !excludes.includes(term)) {
        excludes.push(term);
      }
    } else {
      const term = token.toLowerCase();
      if (term && !includes.includes(term)) {
        includes.push(term);
      }
    }
  }

  // Parse words from explicit exclude query (split on commas or whitespace)
  if (excludeQuery) {
    const excTokens = excludeQuery.split(/[\s,]+/).filter(Boolean);
    for (const token of excTokens) {
      const clean = token.replace(/^[-!]+/, '').trim().toLowerCase();
      if (clean && !excludes.includes(clean)) {
        excludes.push(clean);
      }
    }
  }

  return { includes, excludes };
}

export const defaultFilters: InstrumentFilters = {
  query: '',
  excludeQuery: '',
  esg: '',
  assetClasses: [],
  excludeAssetClasses: [],
  distributions: [],
  excludeDistributions: [],
  replications: [],
  excludeReplications: [],
  strategies: [],
  excludeStrategies: [],
  domiciles: [],
  excludeDomiciles: [],
  currencies: [],
  excludeCurrencies: [],
  issuers: [],
  excludeIssuers: [],
  types: [],
  excludeTypes: [],
  currencyHedged: '',
  ucits: '',
  maxTER: '',
  minSize: '',
  minAge: '',
  maxTrackingDiff: '',
  maxTrackingError: '',
};

export const defaultRankFilters = defaultFilters;

export const builtInPresets: FilterPreset[] = [
  {
    id: 'core-world-acc',
    name: 'Core World (Acc)',
    builtIn: true,
    filters: {
      ...defaultFilters,
      query: 'World',
      assetClasses: ['equity'],
      distributions: ['accumulating'],
      excludeDistributions: ['distributing'],
      replications: ['physical_full', 'physical_sampling'],
      domiciles: ['IE', 'LU'],
      maxTER: 0.25,
      minSize: 500,
      minAge: 3,
      ucits: 'true',
    },
  },
  {
    id: 'all-world-equity',
    name: 'All Accumulating Equities',
    builtIn: true,
    filters: {
      ...defaultFilters,
      assetClasses: ['equity'],
      distributions: ['accumulating'],
      excludeDistributions: ['distributing'],
      minSize: 100,
      ucits: 'true',
    },
  },
  {
    id: 'low-cost-physical',
    name: 'Low-Cost Physical (≤ 0.20%)',
    builtIn: true,
    filters: {
      ...defaultFilters,
      distributions: ['accumulating'],
      excludeDistributions: ['distributing'],
      replications: ['physical_full', 'physical_sampling'],
      maxTER: 0.20,
      minSize: 200,
      ucits: 'true',
    },
  },
  {
    id: 'bonds-core',
    name: 'Bonds & Fixed Income',
    builtIn: true,
    filters: {
      ...defaultFilters,
      assetClasses: ['bond'],
      currencies: ['EUR'],
      minSize: 100,
      ucits: 'true',
    },
  },
  {
    id: 'dividend-dist',
    name: 'High Dividend / Income (Dist)',
    builtIn: true,
    filters: {
      ...defaultFilters,
      distributions: ['distributing'],
      assetClasses: ['equity'],
      strategies: ['dividend'],
      ucits: 'true',
    },
  },
  {
    id: 'commodities',
    name: 'Commodities & Metals',
    builtIn: true,
    filters: {
      ...defaultFilters,
      assetClasses: ['commodity'],
      minSize: 50,
    },
  },
];

export function loadSavedFilters(): InstrumentFilters {
  try {
    if (typeof localStorage === 'undefined') return defaultFilters;
    const raw = localStorage.getItem('squirrel.catalogFilters.v5') ||
                localStorage.getItem('squirrel.catalogFilters.v4') ||
                localStorage.getItem('squirrel.catalogFilters.v3') ||
                localStorage.getItem('squirrel.rankFilters.v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaultFilters,
        query: parsed.query || parsed.indexQuery || '',
        excludeQuery: parsed.excludeQuery || '',
        esg: parsed.esg || '',
        distributions: Array.isArray(parsed.distributions) ? parsed.distributions : (parsed.distribution ? [parsed.distribution] : []),
        excludeDistributions: Array.isArray(parsed.excludeDistributions) ? parsed.excludeDistributions : [],
        replications: Array.isArray(parsed.replications) ? parsed.replications : (parsed.replication ? [parsed.replication] : []),
        excludeReplications: Array.isArray(parsed.excludeReplications) ? parsed.excludeReplications : [],
        strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
        excludeStrategies: Array.isArray(parsed.excludeStrategies) ? parsed.excludeStrategies : [],
        assetClasses: Array.isArray(parsed.assetClasses) ? parsed.assetClasses : (parsed.assetClass ? [parsed.assetClass] : []),
        excludeAssetClasses: Array.isArray(parsed.excludeAssetClasses) ? parsed.excludeAssetClasses : [],
        domiciles: Array.isArray(parsed.domiciles) ? parsed.domiciles : (typeof parsed.domicile === 'string' && parsed.domicile ? parsed.domicile.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean) : []),
        excludeDomiciles: Array.isArray(parsed.excludeDomiciles) ? parsed.excludeDomiciles : [],
        currencies: Array.isArray(parsed.currencies) ? parsed.currencies : (parsed.currency ? [parsed.currency] : []),
        excludeCurrencies: Array.isArray(parsed.excludeCurrencies) ? parsed.excludeCurrencies : [],
        issuers: Array.isArray(parsed.issuers) ? parsed.issuers : (parsed.issuer ? [parsed.issuer] : []),
        excludeIssuers: Array.isArray(parsed.excludeIssuers) ? parsed.excludeIssuers : [],
        types: Array.isArray(parsed.types) ? parsed.types : (parsed.type ? [parsed.type] : []),
        excludeTypes: Array.isArray(parsed.excludeTypes) ? parsed.excludeTypes : [],
        currencyHedged: parsed.currencyHedged || '',
        ucits: parsed.ucits || '',
        maxTER: parsed.maxTER !== undefined ? parsed.maxTER : '',
        minSize: parsed.minSize !== undefined ? parsed.minSize : '',
        minAge: parsed.minAge !== undefined ? parsed.minAge : '',
        maxTrackingDiff: parsed.maxTrackingDiff !== undefined ? parsed.maxTrackingDiff : '',
        maxTrackingError: parsed.maxTrackingError !== undefined ? parsed.maxTrackingError : '',
      };
    }
  } catch {}
  return defaultFilters;
}

export const loadSavedRankFilters = loadSavedFilters;

export function saveFilters(filters: InstrumentFilters) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('squirrel.catalogFilters.v5', JSON.stringify(filters));
  } catch {}
}

export const saveRankFilters = saveFilters;

export function loadCustomPresets(): FilterPreset[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem('squirrel.catalogPresets.v5') ||
                localStorage.getItem('squirrel.catalogPresets.v4') ||
                localStorage.getItem('squirrel.catalogPresets.v3') ||
                localStorage.getItem('squirrel.rankPresets.v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((p: any) => ({
          ...p,
          filters: {
            ...defaultFilters,
            ...p.filters,
            query: p.filters?.query || p.filters?.indexQuery || '',
            excludeQuery: p.filters?.excludeQuery || '',
            esg: p.filters?.esg || '',
          },
        }));
      }
    }
  } catch {}
  return [];
}

export function saveCustomPresets(presets: FilterPreset[]) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('squirrel.catalogPresets.v5', JSON.stringify(presets));
  } catch {}
}

export function matchesFilters(
  instrument: Partial<Instrument>,
  filters: InstrumentFilters,
  asOf: number = Date.now()
): boolean {
  const { includes, excludes } = parseSearchTerms(filters.query, filters.excludeQuery);

  if (includes.length > 0 || excludes.length > 0) {
    const instProvider = resolveInstrumentProvider(instrument);
    const searchable = [
      instrument.name,
      instrument.ticker,
      instrument.isin,
      instProvider,
      instrument.index_name,
      instrument.investment_focus,
      instrument.asset_class,
      instrument.instrument_type,
    ].filter(Boolean).join(' ').toLowerCase();

    // Check excludes first: if any excluded term is present, reject
    for (const exc of excludes) {
      if (searchable.includes(exc)) {
        return false;
      }
    }

    // Check includes: every positive term must match
    for (const inc of includes) {
      if (!searchable.includes(inc)) {
        return false;
      }
    }
  }

  // ESG screening filter
  if (filters.esg === 'esg' && !isESG(instrument)) return false;
  if (filters.esg === 'non_esg' && isESG(instrument)) return false;

  // Include asset classes
  if (filters.assetClasses.length > 0) {
    if (!instrument.asset_class || !filters.assetClasses.some(ac => ac.toLowerCase() === instrument.asset_class?.toLowerCase())) {
      return false;
    }
  }
  // Exclude asset classes
  if (filters.excludeAssetClasses?.length > 0) {
    if (instrument.asset_class && filters.excludeAssetClasses.some(ac => ac.toLowerCase() === instrument.asset_class?.toLowerCase())) {
      return false;
    }
  }

  // Include distributions
  if (filters.distributions.length > 0) {
    if (!instrument.distribution || !filters.distributions.includes(instrument.distribution)) {
      return false;
    }
  }
  // Exclude distributions
  if (filters.excludeDistributions?.length > 0) {
    if (instrument.distribution && filters.excludeDistributions.includes(instrument.distribution)) {
      return false;
    }
  }

  // Include replications
  if (filters.replications.length > 0) {
    if (!instrument.replication || !filters.replications.includes(instrument.replication)) {
      return false;
    }
  }
  // Exclude replications
  if (filters.excludeReplications?.length > 0) {
    if (instrument.replication && filters.excludeReplications.includes(instrument.replication)) {
      return false;
    }
  }

  // Include strategies
  if (filters.strategies?.length > 0) {
    if (!instrument.strategy || !filters.strategies.includes(instrument.strategy)) {
      return false;
    }
  }
  // Exclude strategies
  if (filters.excludeStrategies?.length > 0) {
    if (instrument.strategy && filters.excludeStrategies.includes(instrument.strategy)) {
      return false;
    }
  }

  // Include domiciles
  if (filters.domiciles.length > 0) {
    const instDom = (instrument.domicile || '').toUpperCase();
    if (!filters.domiciles.some(d => d.toUpperCase() === instDom)) {
      return false;
    }
  }
  // Exclude domiciles
  if (filters.excludeDomiciles?.length > 0) {
    const instDom = (instrument.domicile || '').toUpperCase();
    if (filters.excludeDomiciles.some(d => d.toUpperCase() === instDom)) {
      return false;
    }
  }

  // Include currencies
  if (filters.currencies.length > 0) {
    if (!instrument.fund_currency || !filters.currencies.includes(instrument.fund_currency)) {
      return false;
    }
  }
  // Exclude currencies
  if (filters.excludeCurrencies?.length > 0) {
    if (instrument.fund_currency && filters.excludeCurrencies.includes(instrument.fund_currency)) {
      return false;
    }
  }

  // Include issuers
  const provider = resolveInstrumentProvider(instrument);
  if (filters.issuers.length > 0) {
    if (!provider || !filters.issuers.includes(provider)) {
      return false;
    }
  }
  // Exclude issuers
  if (filters.excludeIssuers?.length > 0) {
    if (provider && filters.excludeIssuers.includes(provider)) {
      return false;
    }
  }

  // Include types
  if (filters.types.length > 0) {
    if (!instrument.instrument_type || !filters.types.includes(instrument.instrument_type)) {
      return false;
    }
  }
  // Exclude types
  if (filters.excludeTypes?.length > 0) {
    if (instrument.instrument_type && filters.excludeTypes.includes(instrument.instrument_type)) {
      return false;
    }
  }

  if (filters.ucits === 'true' && !instrument.ucits) return false;
  if (filters.ucits === 'false' && instrument.ucits) return false;

  if (filters.currencyHedged === 'hedged' && !instrument.currency_hedged) return false;
  if (filters.currencyHedged === 'unhedged' && instrument.currency_hedged) return false;

  if (filters.maxTER !== '' && filters.maxTER !== undefined) {
    if ((instrument.ter_bps ?? 0) > bps(filters.maxTER)) return false;
  }

  if (filters.minSize !== '' && filters.minSize !== undefined) {
    if ((instrument.fund_size_million ?? 0) < n(filters.minSize)) return false;
  }

  if (filters.minAge !== '' && filters.minAge !== undefined) {
    const minA = n(filters.minAge);
    if (minA > 0) {
      if (!instrument.inception_date) return false;
      const parsed = new Date(instrument.inception_date).getTime();
      if (isNaN(parsed)) return false;
      const ageYears = (asOf - parsed) / (365.25 * 24 * 3600 * 1000);
      if (ageYears < minA) return false;
    }
  }

  if (filters.maxTrackingDiff !== '' && filters.maxTrackingDiff !== undefined) {
    if (instrument.tracking_difference_bps != null) {
      if (Math.abs(instrument.tracking_difference_bps) > bps(filters.maxTrackingDiff)) {
        return false;
      }
    }
  }

  if (filters.maxTrackingError !== '' && filters.maxTrackingError !== undefined) {
    if (instrument.tracking_error_bps != null) {
      if (instrument.tracking_error_bps > bps(filters.maxTrackingError)) {
        return false;
      }
    }
  }

  return true;
}

export const matchesRankFilters = matchesFilters;

export function computeInstrumentScore(
  instrument: Partial<Instrument>,
  asOf: number = Date.now()
): number | null {
  if (instrument.instrument_type !== 'etf' || !instrument.ucits || instrument.data_status !== 'enriched') {
    return null;
  }
  const ter = instrument.ter_bps ?? 0;
  const cost = Math.max(0, Math.min(1, 1 - (ter / 100)));

  // Fund size score with diminishing returns:
  // Saturates around ~€3.16B (log10(3162) / 3.5 = 1.0), so a €3B, €20B, and €50B fund are all treated as established/maxed
  const sizeM = instrument.fund_size_million ?? 0;
  const size = Math.max(0, Math.min(1, Math.log10(Math.max(sizeM, 1)) / 3.5));

  // Fund age score with diminishing returns:
  // A 10y fund and 20y fund are both fully established (1.0).
  // 3-5y funds already gain strong credibility (~0.58-0.75) via logarithmic saturation.
  let age = 0;
  if (instrument.inception_date) {
    const parsed = new Date(instrument.inception_date).getTime();
    if (!isNaN(parsed)) {
      const ageYears = Math.max(0, (asOf - parsed) / (365.25 * 24 * 3600 * 1000));
      age = Math.max(0, Math.min(1, Math.log10(1 + Math.min(ageYears, 10)) / Math.log10(11)));
    }
  }

  // Tracking difference:
  // Outperforming index (TD <= 0) up to -30 bps gets top score (1.0).
  // Lagging index (TD > 0) is penalized.
  let td = 0;
  if (instrument.tracking_difference_bps != null) {
    const tdBps = instrument.tracking_difference_bps;
    if (tdBps <= 0) {
      td = Math.max(0, Math.min(1, 1 - Math.max(0, -tdBps - 30) / 100));
    } else {
      td = Math.max(0, Math.min(1, 1 - tdBps / 100));
    }
  }

  let te = 0;
  if (instrument.tracking_error_bps != null) {
    te = Math.max(0, Math.min(1, 1 - Math.abs(instrument.tracking_error_bps) / 100));
  }

  const total = cost * 35 + td * 30 + te * 15 + size * 15 + age * 5;
  return Math.round(total * 10) / 10;
}
