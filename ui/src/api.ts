import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

import { AccountService } from './pb/v1/account_connect.js';
import { HoldingService } from './pb/v1/holding_connect.js';
import { InstrumentService } from './pb/v1/instrument_connect.js';
import { RateService } from './pb/v1/rate_connect.js';
import { SnapshotService } from './pb/v1/snapshot_connect.js';
import { SummaryService } from './pb/v1/summary_connect.js';
import { SystemService } from './pb/v1/system_connect.js';

const transport = createConnectTransport({
  baseUrl: '',
});

export const accountClient: any = createPromiseClient(AccountService as any, transport);
export const holdingClient: any = createPromiseClient(HoldingService as any, transport);
export const instrumentClient: any = createPromiseClient(InstrumentService as any, transport);
export const rateClient: any = createPromiseClient(RateService as any, transport);
export const snapshotClient: any = createPromiseClient(SnapshotService as any, transport);
export const summaryClient: any = createPromiseClient(SummaryService as any, transport);
export const systemClient: any = createPromiseClient(SystemService as any, transport);

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

function num(val: bigint | number | undefined | null): number {
  if (val === undefined || val === null) return 0;
  return typeof val === 'bigint' ? Number(val) : val;
}

function optNum(val: bigint | number | undefined | null): number | null {
  if (val === undefined || val === null) return null;
  return typeof val === 'bigint' ? Number(val) : val;
}

function optStr(val: string | undefined | null): string | undefined {
  return val ? val : undefined;
}

function bigint(val: number | null | undefined): bigint | undefined {
  if (val === null || val === undefined) return undefined;
  return BigInt(val);
}

// Convert Proto Account -> UI Account
function protoToAccount(a: any): Account {
  return {
    id: num(a.id),
    name: a.name ?? '',
    institution: a.institution ?? '',
    type: (a.type || 'other') as Account['type'],
    preferred: Boolean(a.preferred),
    archived: Boolean(a.archived),
    currency: a.currency ?? 'EUR',
    balance_minor: num(a.balanceMinor),
    tax_bps: num(a.taxBps),
    annual_fee_minor: num(a.annualFeeMinor),
    tiers: Array.isArray(a.tiers)
      ? a.tiers.map((t: any) => ({
          id: t.id !== undefined && t.id !== null ? num(t.id) : undefined,
          up_to_minor: optNum(t.upToMinor),
          fixed_rate_bps: optNum(t.fixedRateBps),
          reference_code: optStr(t.referenceCode),
          spread_bps: num(t.spreadBps),
          resolved_rate_bps: optNum(t.resolvedRateBps) ?? undefined,
        }))
      : null,
    gross_revenue_minor: num(a.grossRevenueMinor),
    tax_minor: num(a.taxMinor),
    net_revenue_minor: num(a.netRevenueMinor),
    holding_count: num(a.holdingCount),
    holdings_value_minor: num(a.holdingsValueMinor),
    total_assets_minor: num(a.totalAssetsMinor),
  };
}

// Convert Proto Instrument -> UI Instrument
function protoToInstrument(inst: any): Instrument {
  return {
    id: num(inst.id),
    isin: inst.isin ?? '',
    name: inst.name ?? '',
    ticker: optStr(inst.ticker),
    instrument_type: (inst.instrumentType || 'etf') as InstrumentType,
    provider: optStr(inst.provider),
    index_name: optStr(inst.indexName),
    investment_focus: optStr(inst.investmentFocus),
    asset_class: optStr(inst.assetClass),
    strategy: optStr(inst.strategy),
    currency_hedged: Boolean(inst.currencyHedged),
    starred: Boolean(inst.starred),
    data_status: (inst.dataStatus || 'catalog') as Instrument['data_status'],
    distribution: (inst.distribution || 'accumulating') as Instrument['distribution'],
    replication: (inst.replication || 'physical_full') as Instrument['replication'],
    domicile: optStr(inst.domicile),
    fund_currency: inst.fundCurrency ?? 'EUR',
    ter_bps: num(inst.terBps),
    fund_size_million: num(inst.fundSizeMillion),
    inception_date: optStr(inst.inceptionDate),
    tracking_difference_bps: optNum(inst.trackingDifferenceBps),
    tracking_error_bps: optNum(inst.trackingErrorBps),
    ucits: Boolean(inst.ucits),
    source_url: optStr(inst.sourceUrl),
    refreshed_at: optStr(inst.refreshedAt),
    enriched_at: optStr(inst.enrichedAt),
  };
}

// Convert Proto Holding -> UI Holding
function protoToHolding(h: any): Holding {
  return {
    id: num(h.id),
    account_id: num(h.accountId),
    instrument_id: num(h.instrumentId),
    account_name: optStr(h.accountName),
    currency: optStr(h.currency),
    instrument_name: optStr(h.instrumentName),
    instrument_isin: optStr(h.instrumentIsin),
    instrument_ticker: optStr(h.instrumentTicker),
    instrument_type: h.instrumentType ? (h.instrumentType as InstrumentType) : undefined,
    asset_class: optStr(h.assetClass),
    invested_minor: num(h.investedMinor),
    value_minor: num(h.valueMinor),
    tax_bps: num(h.taxBps),
    planned_bps: num(h.plannedBps),
    actual_bps: num(h.actualBps),
  };
}

// Convert Proto Snapshot -> UI Snapshot
function protoToSnapshot(s: any): Snapshot {
  return {
    id: num(s.id),
    observed_on: s.observedOn ?? '',
    currency: s.currency ?? 'EUR',
    cash_minor: num(s.cashMinor),
    invested_minor: num(s.investedMinor),
    portfolio_minor: num(s.portfolioMinor),
    total_minor: num(s.totalMinor),
  };
}

// Central API routing function translating legacy path calls to Connect RPC client invocations
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const bodyData = init?.body ? JSON.parse(init.body as string) : {};

  // Summary
  if (path === '/api/summary' && method === 'GET') {
    const res = await summaryClient.getSummary({});
    const summary: Summary = {
      base_currency: res.summary?.baseCurrency ?? 'EUR',
      currencies: (res.summary?.currencies ?? []).map((c: any) => ({
        currency: c.currency,
        balance_minor: num(c.balanceMinor),
        gross_revenue_minor: num(c.grossRevenueMinor),
        tax_minor: num(c.taxMinor),
        fees_minor: num(c.feesMinor),
        net_revenue_minor: num(c.netRevenueMinor),
        invested_minor: num(c.investedMinor),
        portfolio_minor: num(c.portfolioMinor),
        total_minor: num(c.totalMinor),
        allocations: (c.allocations ?? []).map((a: any) => ({
          asset_class: a.assetClass,
          value_minor: num(a.valueMinor),
        })),
      })),
    };
    return summary as unknown as T;
  }

  // Accounts
  if (path.startsWith('/api/accounts')) {
    if (path === '/api/accounts' || path.startsWith('/api/accounts?')) {
      const urlParams = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '');
      const sortParam = urlParams.get('sort');
      const dirParam = urlParams.get('direction');
      const sort = sortParam ? `${sortParam}:${dirParam ?? 'asc'}` : undefined;
      const res = await accountClient.listAccounts({ sort });
      return (res.accounts ?? []).map(protoToAccount) as unknown as T;
    }
    if (method === 'POST') {
      const res = await accountClient.createAccount({
        account: {
          name: bodyData.name,
          institution: bodyData.institution ?? '',
          type: bodyData.type ?? 'broker',
          preferred: Boolean(bodyData.preferred),
          archived: Boolean(bodyData.archived),
          currency: bodyData.currency ?? 'EUR',
          balanceMinor: bigint(bodyData.balance_minor),
          taxBps: bigint(bodyData.tax_bps),
          annualFeeMinor: bigint(bodyData.annual_fee_minor),
          tiers: (bodyData.tiers ?? []).map((t: any) => ({
            upToMinor: t.up_to_minor !== null ? bigint(t.up_to_minor) : undefined,
            fixedRateBps: t.fixed_rate_bps !== null ? bigint(t.fixed_rate_bps) : undefined,
            referenceCode: t.reference_code || undefined,
            spreadBps: bigint(t.spread_bps) ?? 0n,
          })),
        } as any,
      });
      return protoToAccount(res.account) as unknown as T;
    }
    const idMatch = path.match(/\/api\/accounts\/(\d+)/);
    if (idMatch) {
      const id = BigInt(idMatch[1]);
      if (method === 'PUT') {
        const res = await accountClient.updateAccount({
          id,
          account: {
            id,
            name: bodyData.name,
            institution: bodyData.institution ?? '',
            type: bodyData.type ?? 'broker',
            preferred: Boolean(bodyData.preferred),
            archived: Boolean(bodyData.archived),
            currency: bodyData.currency ?? 'EUR',
            balanceMinor: bigint(bodyData.balance_minor),
            taxBps: bigint(bodyData.tax_bps),
            annualFeeMinor: bigint(bodyData.annual_fee_minor),
            tiers: (bodyData.tiers ?? []).map((t: any) => ({
              id: t.id !== undefined && t.id !== null ? bigint(t.id) : undefined,
              upToMinor: t.up_to_minor !== null ? bigint(t.up_to_minor) : undefined,
              fixedRateBps: t.fixed_rate_bps !== null ? bigint(t.fixed_rate_bps) : undefined,
              referenceCode: t.reference_code || undefined,
              spreadBps: bigint(t.spread_bps) ?? 0n,
            })),
          } as any,
        });
        return protoToAccount(res.account) as unknown as T;
      }
      if (method === 'DELETE') {
        await accountClient.deleteAccount({ id });
        return undefined as unknown as T;
      }
    }
  }

  // Reference Rates & Tax Rates
  if (path === '/api/reference-rates') {
    const res = await rateClient.listReferenceRates({});
    return (res.rates ?? []).map((r: any) => ({
      code: r.code,
      label: r.label,
      rate_bps: num(r.rateBps),
      observed_on: r.observedOn,
      updated_at: optStr(r.updatedAt),
    })) as unknown as T;
  }

  if (path === '/api/tax-rates') {
    const res = await rateClient.listTaxRates({});
    return (res.rates ?? []).map((r: any) => ({
      code: r.code,
      label: r.label,
      rate_bps: num(r.rateBps),
    })) as unknown as T;
  }

  // Holdings
  if (path.startsWith('/api/holdings')) {
    if (path === '/api/holdings' || path.startsWith('/api/holdings?')) {
      const urlParams = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '');
      const sortParam = urlParams.get('sort');
      const dirParam = urlParams.get('direction');
      const sort = sortParam ? `${sortParam}:${dirParam ?? 'asc'}` : undefined;
      const res = await holdingClient.listHoldings({ sort });
      return (res.holdings ?? []).map(protoToHolding) as unknown as T;
    }
    if (method === 'POST') {
      const res = await holdingClient.createHolding({
        holding: {
          accountId: bigint(bodyData.account_id),
          instrumentId: bigint(bodyData.instrument_id),
          investedMinor: bigint(bodyData.invested_minor),
          valueMinor: bigint(bodyData.value_minor),
          taxBps: bigint(bodyData.tax_bps),
          plannedBps: bigint(bodyData.planned_bps),
        } as any,
      });
      return protoToHolding(res.holding) as unknown as T;
    }
    const idMatch = path.match(/\/api\/holdings\/(\d+)/);
    if (idMatch) {
      const id = BigInt(idMatch[1]);
      if (method === 'PUT') {
        const res = await holdingClient.updateHolding({
          id,
          holding: {
            id,
            accountId: bigint(bodyData.account_id),
            instrumentId: bigint(bodyData.instrument_id),
            investedMinor: bigint(bodyData.invested_minor),
            valueMinor: bigint(bodyData.value_minor),
            taxBps: bigint(bodyData.tax_bps),
            plannedBps: bigint(bodyData.planned_bps),
          } as any,
        });
        return protoToHolding(res.holding) as unknown as T;
      }
      if (method === 'DELETE') {
        await holdingClient.deleteHolding({ id });
        return undefined as unknown as T;
      }
    }
  }

  // Snapshots
  if (path.startsWith('/api/snapshots')) {
    if (path === '/api/snapshots' || path.startsWith('/api/snapshots?')) {
      const urlParams = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '');
      const sortParam = urlParams.get('sort');
      const dirParam = urlParams.get('direction');
      const sort = sortParam ? `${sortParam}:${dirParam ?? 'asc'}` : undefined;
      const res = await snapshotClient.listSnapshots({ sort });
      return (res.snapshots ?? []).map(protoToSnapshot) as unknown as T;
    }
    if (method === 'POST') {
      await snapshotClient.createSnapshot({ observedOn: bodyData.observed_on });
      return undefined as unknown as T;
    }
    const idMatch = path.match(/\/api\/snapshots\/(\d+)/);
    if (idMatch) {
      const id = BigInt(idMatch[1]);
      if (method === 'PUT') {
        const res = await snapshotClient.updateSnapshot({
          id,
          observedOn: bodyData.observed_on,
          currency: bodyData.currency ?? 'EUR',
          cashMinor: bigint(bodyData.cash_minor) ?? 0n,
          investedMinor: bigint(bodyData.invested_minor) ?? 0n,
          portfolioMinor: bigint(bodyData.portfolio_minor) ?? 0n,
        });
        return protoToSnapshot(res.snapshot) as unknown as T;
      }
      if (method === 'DELETE') {
        await snapshotClient.deleteSnapshot({ id });
        return undefined as unknown as T;
      }
    }
  }

  // Instruments
  if (path.startsWith('/api/instruments')) {
    if (path === '/api/instruments' || path.startsWith('/api/instruments?')) {
      const urlParams = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '');
      const sortParam = urlParams.get('sort');
      const dirParam = urlParams.get('direction');
      const sort = sortParam ? `${sortParam}:${dirParam ?? 'asc'}` : undefined;
      const res = await instrumentClient.listInstruments({ sort });
      return (res.instruments ?? []).map(protoToInstrument) as unknown as T;
    }
    if (path.startsWith('/api/instruments/search')) {
      const urlParams = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '');
      const query = urlParams.get('q') ?? '';
      const res = await instrumentClient.searchInstruments({ query });
      return (res.instruments ?? []).map(protoToInstrument) as unknown as T;
    }
    if (path === '/api/instruments/lookup' && method === 'POST') {
      const res = await instrumentClient.lookupInstrument({ query: bodyData.query });
      return protoToInstrument(res.instrument) as unknown as T;
    }
    if (path === '/api/instruments/import' && method === 'POST') {
      const res = await instrumentClient.importInstruments({ isins: bodyData.isins });
      return (res.instruments ?? []).map(protoToInstrument) as unknown as T;
    }
    if (path === '/api/instruments/catalog/sync' && method === 'POST') {
      const res = await instrumentClient.syncInstrumentCatalog({ limit: bodyData.limit ?? 4000 });
      return { saved: res.saved, available: res.available } as unknown as T;
    }
    if (path === '/api/instruments/catalog/enrich' && method === 'POST') {
      const res = await instrumentClient.enrichInstrumentCatalog({ limit: bodyData.limit ?? 20 });
      return { enriched: res.enriched, failed: res.failed } as unknown as T;
    }
    if (path === '/api/instruments/rank' && method === 'POST') {
      const res = await instrumentClient.rankInstruments({
        criteria: {
          indexQuery: bodyData.index_query ?? '',
          distribution: bodyData.distribution ?? '',
          replications: bodyData.replications ?? [],
          domiciles: bodyData.domiciles ?? [],
          maxTerBps: bodyData.max_ter_bps !== null && bodyData.max_ter_bps !== undefined ? bigint(bodyData.max_ter_bps) : undefined,
          minFundSizeMillion: bigint(bodyData.min_fund_size_million) ?? 0n,
          minAgeYears: bodyData.min_age_years ?? 0,
          weights: bodyData.weights ? {
            cost: bodyData.weights.cost ?? 0,
            trackingDifference: bodyData.weights.tracking_difference ?? 0,
            trackingError: bodyData.weights.tracking_error ?? 0,
            size: bodyData.weights.size ?? 0,
            age: bodyData.weights.age ?? 0,
          } : undefined,
        },
      });
      return (res.rankedInstruments ?? []).map((r: any) => ({
        instrument: protoToInstrument(r.instrument),
        total: r.total,
        cost: r.cost,
        tracking_difference: r.trackingDifference,
        tracking_error: r.trackingError,
        size: r.size,
        age: r.age,
      })) as unknown as T;
    }
    if (method === 'POST') {
      const res = await instrumentClient.createInstrument({
        instrument: {
          isin: bodyData.isin,
          name: bodyData.name,
          ticker: bodyData.ticker || undefined,
          instrumentType: bodyData.instrument_type ?? 'etf',
          provider: bodyData.provider || undefined,
          indexName: bodyData.index_name || undefined,
          investmentFocus: bodyData.investment_focus || undefined,
          assetClass: bodyData.asset_class || undefined,
          strategy: bodyData.strategy || undefined,
          currencyHedged: Boolean(bodyData.currency_hedged),
          starred: Boolean(bodyData.starred),
          dataStatus: bodyData.data_status ?? 'enriched',
          distribution: bodyData.distribution ?? 'accumulating',
          replication: bodyData.replication ?? 'physical_full',
          domicile: bodyData.domicile || undefined,
          fundCurrency: bodyData.fund_currency ?? 'EUR',
          terBps: bigint(bodyData.ter_bps) ?? 0n,
          fundSizeMillion: bigint(bodyData.fund_size_million) ?? 0n,
          inceptionDate: bodyData.inception_date || undefined,
          trackingDifferenceBps: bodyData.tracking_difference_bps !== null && bodyData.tracking_difference_bps !== undefined ? bigint(bodyData.tracking_difference_bps) : undefined,
          trackingErrorBps: bodyData.tracking_error_bps !== null && bodyData.tracking_error_bps !== undefined ? bigint(bodyData.tracking_error_bps) : undefined,
          ucits: Boolean(bodyData.ucits),
          sourceUrl: bodyData.source_url || undefined,
        } as any,
      });
      return protoToInstrument(res.instrument) as unknown as T;
    }

    const starMatch = path.match(/\/api\/instruments\/([^\/]+)\/star/);
    if (starMatch && method === 'PUT') {
      const isin = decodeURIComponent(starMatch[1]);
      await instrumentClient.starInstrument({ isin, starred: Boolean(bodyData.starred) });
      return undefined as unknown as T;
    }

    const altMatch = path.match(/\/api\/instruments\/(\d+)\/alternatives/);
    if (altMatch && method === 'GET') {
      const id = BigInt(altMatch[1]);
      const res = await instrumentClient.getInstrumentAlternatives({ id });
      return (res.alternatives ?? []).map((a: any) => ({
        instrument: protoToInstrument(a.instrument),
        match: a.match as InstrumentAlternative['match'],
        better: Boolean(a.better),
        score: a.score,
        reasons: a.reasons ?? [],
      })) as unknown as T;
    }

    const idMatch = path.match(/\/api\/instruments\/(\d+)/);
    if (idMatch && method === 'DELETE') {
      const id = BigInt(idMatch[1]);
      await instrumentClient.deleteInstrument({ id });
      return undefined as unknown as T;
    }
  }

  throw new Error(`Unhandled Connect API call: ${method} ${path}`);
}

export async function updateSituation(params: {
  accountUpdates: { accountId: bigint; balanceMinor: bigint }[];
  holdingUpdates: { holdingId: bigint; valueMinor: bigint; investedMinor?: bigint }[];
  saveSnapshot: boolean;
  observedOn?: string;
}): Promise<boolean> {
  const res = await snapshotClient.updateSituation({
    accountUpdates: params.accountUpdates.map(u => ({ accountId: u.accountId, balanceMinor: u.balanceMinor })),
    holdingUpdates: params.holdingUpdates.map(u => ({ holdingId: u.holdingId, valueMinor: u.valueMinor, investedMinor: u.investedMinor })),
    saveSnapshot: params.saveSnapshot,
    observedOn: params.observedOn,
  });
  return Boolean(res.snapshotSaved);
}

export async function exportBackup(): Promise<{ data: Uint8Array; filename: string }> {
  const res = await systemClient.exportBackup({});
  return { data: res.backupTarGz, filename: res.filename || 'loot-backup.tar.gz' };
}

export async function restoreBackup(fileBytes: Uint8Array): Promise<{ success: boolean; message: string }> {
  const res = await systemClient.restoreBackup({ backupTarGz: fileBytes });
  return { success: Boolean(res.success), message: res.message || 'Restored successfully' };
}
