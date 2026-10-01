import { holdingPatch } from './utils/holdingPatch';
import { createClient } from '@connectrpc/connect';
import type { Interceptor } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

import { AccountService } from './pb/v1/account_pb.js';
import { HoldingService } from './pb/v1/holding_pb.js';
import { InstrumentService } from './pb/v1/instrument_pb.js';
import { BacktestService } from './pb/v1/backtest_pb.js';
import { RateService } from './pb/v1/rate_pb.js';
import { SnapshotService } from './pb/v1/snapshot_pb.js';
import { SummaryService } from './pb/v1/summary_pb.js';
import { SystemService } from './pb/v1/system_pb.js';
import { ProfileService } from './pb/v1/profile_pb.js';
import { BtpService } from './pb/v1/btp_pb.js';
import { getToken } from './auth';

const authInterceptor: Interceptor = (next) => async (req) => {
  const token = getToken();
  if (token) {
    req.header.set('Authorization', `Bearer ${token}`);
  }
  return next(req);
};

const transport = createConnectTransport({
  baseUrl: '',
  interceptors: [authInterceptor],
});

export const accountClient = createClient(AccountService, transport);
export const holdingClient = createClient(HoldingService, transport);
export const instrumentClient = createClient(InstrumentService, transport);
export const backtestClient = createClient(BacktestService, transport);
export const rateClient = createClient(RateService, transport);
export const snapshotClient = createClient(SnapshotService, transport);
export const summaryClient = createClient(SummaryService, transport);
export const systemClient = createClient(SystemService, transport);
export const profileClient = createClient(ProfileService, transport);
export const btpClient = createClient(BtpService, transport);

export type ReferenceRate = {
  code: string;
  label: string;
  rate_bps: number;
  observed_on: string;
  updated_at?: string;
};

export type MarketMetric = {
  code: string;
  label: string;
  category: string;
  value: number;
  unit: string;
  observed_on: string;
  source_url: string;
  change_1y?: number;
  distance_52w_high?: number;
  sma_200?: number;
};

export type MarketObservation = { code: string; observed_on: string; value: number };

export type InflationRange = '1y' | '3y' | '5y' | 'max';

export type MarketContext = { metrics: MarketMetric[]; observations: MarketObservation[]; warnings: string[] };

function protoToReferenceRate(rate: any): ReferenceRate {
  return {
    code: rate.code,
    label: rate.label,
    rate_bps: num(rate.rateBps),
    observed_on: rate.observedOn,
    updated_at: optStr(rate.updatedAt),
  };
}

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
  pac_amount_minor?: number;
  notes?: string;
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

export type Diagnostic = {
  id: string;
  category: string;
  severity: 'info' | 'warning' | 'alert';
  title: string;
  message: string;
  holding_id?: number;
  account_id?: number;
  isin?: string;
};

export type Summary = {
  base_currency: string;
  currencies: CurrencySummary[];
  diagnostics?: Diagnostic[];
};

export type InstrumentType = 'etf' | 'etc' | 'etn' | 'etp' | 'fund' | 'stock' | 'bond' | 'crypto' | 'commodity' | 'real_estate' | 'other';

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
  actual_bps: number;
  ter_bps?: number;
  is_pac?: boolean;
  pac_bps?: number;
  pac_frequency?: string;
  notes?: string;
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
    pac_amount_minor: num(a.pacAmountMinor),
    notes: optStr(a.notes),
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

    actual_bps: num(h.actualBps),
    ter_bps: optNum(h.terBps) ?? undefined,
    is_pac: Boolean(h.isPac),
    pac_bps: num(h.pacBps),
    pac_frequency: optStr(h.pacFrequency) ?? 'monthly',
    notes: optStr(h.notes),
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

// --- Typed Connect-RPC Service Wrappers ---

// Summary
export async function getSummary(): Promise<Summary> {
  const res = await summaryClient.getSummary({});
  return {
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
    diagnostics: (res.summary?.diagnostics ?? []).map((d: any) => ({
      id: d.id,
      category: d.category,
      severity: d.severity,
      title: d.title,
      message: d.message,
      holding_id: optNum(d.holdingId) ?? undefined,
      account_id: optNum(d.accountId) ?? undefined,
      isin: optStr(d.isin),
    })),
  };
}

// Reference Rates & Tax Rates
export async function listReferenceRates(): Promise<ReferenceRate[]> {
  const res = await rateClient.listReferenceRates({});
  return (res.rates ?? []).map(protoToReferenceRate);
}

export async function listTaxRates(): Promise<TaxRate[]> {
  const res = await rateClient.listTaxRates({});
  return (res.rates ?? []).map((r: any) => ({
    code: r.code,
    label: r.label,
    rate_bps: num(r.rateBps),
  }));
}

// Accounts
export async function listAccounts(sort?: string): Promise<Account[]> {
  const res = await accountClient.listAccounts({ sort });
  return (res.accounts ?? []).map(protoToAccount);
}

export async function createAccount(data: Partial<Account> & { tiers?: any[] | null }): Promise<Account> {
  const res = await accountClient.createAccount({
    account: {
      name: data.name ?? '',
      institution: data.institution ?? '',
      type: data.type ?? 'broker',
      preferred: Boolean(data.preferred),
      archived: Boolean(data.archived),
      currency: data.currency ?? 'EUR',
      balanceMinor: bigint(data.balance_minor),
      taxBps: bigint(data.tax_bps),
      annualFeeMinor: bigint(data.annual_fee_minor),
      pacAmountMinor: bigint(data.pac_amount_minor),
      notes: data.notes ?? '',
      tiers: (data.tiers ?? []).map((t: any) => ({
        upToMinor: t.up_to_minor !== null && t.up_to_minor !== undefined ? bigint(t.up_to_minor) : undefined,
        fixedRateBps: t.fixed_rate_bps !== null && t.fixed_rate_bps !== undefined ? bigint(t.fixed_rate_bps) : undefined,
        referenceCode: t.reference_code || undefined,
        spreadBps: bigint(t.spread_bps) ?? 0n,
      })),
    } as any,
  });
  return protoToAccount(res.account);
}

export async function updateAccount(id: number | bigint, data: Partial<Account> & { tiers?: any[] | null }): Promise<Account> {
  const accountId = BigInt(id);
  const res = await accountClient.updateAccount({
    id: accountId,
    account: {
      id: accountId,
      name: data.name,
      institution: data.institution ?? '',
      type: data.type ?? 'broker',
      preferred: Boolean(data.preferred),
      archived: Boolean(data.archived),
      currency: data.currency ?? 'EUR',
      balanceMinor: bigint(data.balance_minor),
      taxBps: bigint(data.tax_bps),
      annualFeeMinor: bigint(data.annual_fee_minor),
      pacAmountMinor: bigint(data.pac_amount_minor),
      notes: data.notes ?? '',
      tiers: (data.tiers ?? []).map((t: any) => ({
        id: t.id !== undefined && t.id !== null ? bigint(t.id) : undefined,
        upToMinor: t.up_to_minor !== null && t.up_to_minor !== undefined ? bigint(t.up_to_minor) : undefined,
        fixedRateBps: t.fixed_rate_bps !== null && t.fixed_rate_bps !== undefined ? bigint(t.fixed_rate_bps) : undefined,
        referenceCode: t.reference_code || undefined,
        spreadBps: bigint(t.spread_bps) ?? 0n,
      })),
    } as any,
  });
  return protoToAccount(res.account);
}

export async function deleteAccount(id: number | bigint): Promise<void> {
  await accountClient.deleteAccount({ id: BigInt(id) });
}

// Holdings
export async function listHoldings(sort?: string): Promise<Holding[]> {
  const res = await holdingClient.listHoldings({ sort });
  return (res.holdings ?? []).map(protoToHolding);
}

export async function createHolding(data: Partial<Holding>): Promise<Holding> {
  const res = await holdingClient.createHolding({
    holding: {
      accountId: bigint(data.account_id),
      instrumentId: bigint(data.instrument_id),
      investedMinor: bigint(data.invested_minor),
      valueMinor: bigint(data.value_minor),
      taxBps: bigint(data.tax_bps),
      isPac: Boolean(data.is_pac),
      pacBps: bigint(data.pac_bps),
      pacFrequency: data.pac_frequency || 'monthly',
      notes: data.notes ?? '',
    } as any,
  });
  return protoToHolding(res.holding);
}

export async function updateHolding(id: number | bigint, data: any): Promise<Holding> {
  const holdingId = BigInt(id);
  const res = await holdingClient.updateHolding({
    id: holdingId,
    holding: { ...holdingPatch(data), id: holdingId } as any,
  });
  return protoToHolding(res.holding);
}

export async function deleteHolding(id: number | bigint): Promise<void> {
  await holdingClient.deleteHolding({ id: BigInt(id) });
}

// Snapshots
export async function listSnapshots(sort?: string): Promise<Snapshot[]> {
  const res = await snapshotClient.listSnapshots({ sort });
  return (res.snapshots ?? []).map(protoToSnapshot);
}

export async function createSnapshot(observedOn: string): Promise<void> {
  await snapshotClient.createSnapshot({ observedOn });
}

export async function updateSnapshot(id: number | bigint, data: Partial<Snapshot>): Promise<Snapshot> {
  const snapshotId = BigInt(id);
  const res = await snapshotClient.updateSnapshot({
    id: snapshotId,
    observedOn: data.observed_on,
    currency: data.currency ?? 'EUR',
    cashMinor: bigint(data.cash_minor) ?? 0n,
    investedMinor: bigint(data.invested_minor) ?? 0n,
    portfolioMinor: bigint(data.portfolio_minor) ?? 0n,
  });
  return protoToSnapshot(res.snapshot);
}

export async function deleteSnapshot(id: number | bigint): Promise<void> {
  await snapshotClient.deleteSnapshot({ id: BigInt(id) });
}

// Instruments
export async function listInstruments(sort?: string): Promise<Instrument[]> {
  const res = await instrumentClient.listInstruments({ sort });
  return (res.instruments ?? []).map(protoToInstrument);
}

export async function searchInstruments(query: string): Promise<Instrument[]> {
  const res = await instrumentClient.searchInstruments({ query });
  return (res.instruments ?? []).map(protoToInstrument);
}

export async function lookupInstrument(query: string): Promise<Instrument> {
  const res = await instrumentClient.lookupInstrument({ query });
  return protoToInstrument(res.instrument);
}

export async function importInstruments(isins: string[]): Promise<Instrument[]> {
  const res = await instrumentClient.importInstruments({ isins });
  return (res.instruments ?? []).map(protoToInstrument);
}

export async function syncInstrumentCatalog(limit = 4000): Promise<{ saved: number; available: number }> {
  const res = await instrumentClient.syncInstrumentCatalog({ limit });
  return { saved: res.saved, available: res.available };
}

export async function enrichInstrumentCatalog(limit = 20): Promise<{ enriched: number; failed: number }> {
  const res = await instrumentClient.enrichInstrumentCatalog({ limit });
  return { enriched: res.enriched, failed: res.failed };
}

export async function createInstrument(data: any): Promise<Instrument> {
  const res = await instrumentClient.createInstrument({
    instrument: {
      isin: data.isin,
      name: data.name,
      ticker: data.ticker || undefined,
      instrumentType: data.instrument_type ?? 'etf',
      provider: data.provider || undefined,
      indexName: data.index_name || undefined,
      investmentFocus: data.investment_focus || undefined,
      assetClass: data.asset_class || undefined,
      strategy: data.strategy || undefined,
      currencyHedged: Boolean(data.currency_hedged),
      starred: Boolean(data.starred),
      dataStatus: data.data_status ?? 'enriched',
      distribution: data.distribution ?? 'accumulating',
      replication: data.replication ?? 'physical_full',
      domicile: data.domicile || undefined,
      fundCurrency: data.fund_currency ?? 'EUR',
      terBps: bigint(data.ter_bps) ?? 0n,
      fundSizeMillion: bigint(data.fund_size_million) ?? 0n,
      inceptionDate: data.inception_date || undefined,
      trackingDifferenceBps: data.tracking_difference_bps !== null && data.tracking_difference_bps !== undefined ? bigint(data.tracking_difference_bps) : undefined,
      trackingErrorBps: data.tracking_error_bps !== null && data.tracking_error_bps !== undefined ? bigint(data.tracking_error_bps) : undefined,
      ucits: Boolean(data.ucits),
      sourceUrl: data.source_url || undefined,
    } as any,
  });
  return protoToInstrument(res.instrument);
}

export async function starInstrument(isin: string, starred: boolean): Promise<void> {
  await instrumentClient.starInstrument({ isin, starred });
}

export async function getInstrumentAlternatives(id: number | bigint): Promise<InstrumentAlternative[]> {
  const res = await instrumentClient.getInstrumentAlternatives({ id: BigInt(id) });
  return (res.alternatives ?? []).map((a: any) => ({
    instrument: protoToInstrument(a.instrument),
    match: a.match as InstrumentAlternative['match'],
    better: Boolean(a.better),
    score: a.score,
    reasons: a.reasons ?? [],
  }));
}

export async function deleteInstrument(id: number | bigint): Promise<void> {
  await instrumentClient.deleteInstrument({ id: BigInt(id) });
}



export async function refreshReferenceRates(): Promise<ReferenceRate[]> {
  const res = await rateClient.refreshReferenceRates({});
  return (res.rates ?? []).map(protoToReferenceRate);
}

export async function getMarketContext(inflationRange: InflationRange = '1y', forceRefresh = false): Promise<MarketContext> {
  const res = await rateClient.getMarketContext({ inflationRange, forceRefresh });
  return {
    metrics: (res.metrics ?? []).map((metric: any) => ({
      code: metric.code,
      label: metric.label,
      category: metric.category,
      value: Number(metric.value),
      unit: metric.unit,
      observed_on: metric.observedOn,
      source_url: metric.sourceUrl,
      change_1y: metric.change_1y ?? metric.change1Y,
      distance_52w_high: metric.distance_52w_high ?? metric.distance52WHigh,
      sma_200: metric.sma_200 ?? metric.sma200,
    })),
    observations: (res.observations ?? []).map((observation: any) => ({
      code: observation.code,
      observed_on: observation.observedOn,
      value: Number(observation.value),
    })),
    warnings: res.warnings ?? [],
  };
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
  return { data: res.backupData, filename: res.filename || 'squirrel-backup.json' };
}

export async function restoreBackup(fileBytes: Uint8Array): Promise<{ success: boolean; message: string }> {
  const res = await systemClient.restoreBackup({ backupData: fileBytes });
  return { success: Boolean(res.success), message: res.message || 'Restored successfully' };
}

export type AIModelInfo = {
  id: string;
  name: string;
  filename: string;
  size_bytes: number;
  is_downloaded: boolean;
  source_url: string;
  description: string;
  download_percent: number;
  is_downloading: boolean;
};

export async function listAIModels(): Promise<AIModelInfo[]> {
  const res = await systemClient.listAIModels({});
  return (res.models ?? []).map((m: any) => ({
    id: m.id,
    name: m.name,
    filename: m.filename,
    size_bytes: Number(m.sizeBytes ?? 0),
    is_downloaded: Boolean(m.isDownloaded),
    source_url: m.sourceUrl ?? '',
    description: m.description ?? '',
    download_percent: Number(m.downloadPercent ?? 0),
    is_downloading: Boolean(m.isDownloading),
  }));
}

export async function downloadAIModel(modelName: string): Promise<{ success: boolean; message: string; modelId: string }> {
  const res = await systemClient.downloadAIModel({ modelName });
  return {
    success: Boolean(res.success),
    message: res.message ?? '',
    modelId: res.modelId ?? '',
  };
}

export type OllamaModelInfo = {
  name: string;
  size_bytes: number;
  modified_at: string;
};

export async function listOllamaModels(endpoint: string): Promise<OllamaModelInfo[]> {
  const res = await systemClient.listOllamaModels({ endpoint });
  return (res.models ?? []).map((m: any) => ({
    name: m.name,
    size_bytes: Number(m.sizeBytes ?? 0),
    modified_at: m.modifiedAt ?? '',
  }));
}

export async function loadOllamaModel(endpoint: string, model: string, contextSize: number): Promise<{ success: boolean; message: string }> {
  const res = await systemClient.loadOllamaModel({ endpoint, model, contextSize });
  return {
    success: Boolean(res.success),
    message: res.message ?? '',
  };
}

export async function restartLocalServer(modelFilename: string, contextSize: number, port?: number): Promise<{ success: boolean; message: string; actualNCtx: number }> {
  const res = await systemClient.restartLocalServer({ modelFilename, contextSize, port: port ?? 8080 });
  return {
    success: Boolean(res.success),
    message: res.message ?? '',
    actualNCtx: Number(res.actualNCtx ?? 0),
  };
}

export type StreamChatChunk = {
  deltaText: string;
  isMcpToolCall: boolean;
  toolName: string;
  toolArgsJson: string;
  toolResultJson: string;
  done: boolean;
  actualNCtx: number;
};

export async function* streamChat(
  req: {
    provider: string;
    endpoint: string;
    model: string;
    apiKey: string;
    contextSize?: number;
    messages: { role: string; content: string }[];
    portfolioContextJson: string;
    sessionId?: string;
  },
  options?: { signal?: AbortSignal }
): AsyncIterable<StreamChatChunk> {
  const stream = systemClient.streamChat(
    {
      provider: req.provider,
      endpoint: req.endpoint,
      model: req.model,
      apiKey: req.apiKey,
      contextSize: req.contextSize ? req.contextSize : 16384,
      messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      portfolioContextJson: req.portfolioContextJson,
      sessionId: req.sessionId ?? '',
    },
    options
  );

  for await (const chunk of stream) {
    if (chunk.errorMessage) {
      throw new Error(chunk.errorMessage);
    }
    yield {
      deltaText: chunk.deltaText ?? '',
      isMcpToolCall: Boolean(chunk.isMcpToolCall),
      toolName: chunk.toolName ?? '',
      toolArgsJson: chunk.toolArgsJson ?? '',
      toolResultJson: chunk.toolResultJson ?? '',
      done: Boolean(chunk.done),
      actualNCtx: Number(chunk.actualNCtx ?? 0),
    };
  }
}

export async function stopChatSession(sessionId: string): Promise<boolean> {
  const res = await systemClient.stopChatSession({ sessionId });
  return Boolean(res.success);
}

export async function getChatStatus(sessionId: string): Promise<{ isGenerating: boolean; sessionId: string; actualNCtx: number }> {
  const res = await systemClient.getChatStatus({ sessionId });
  return {
    isGenerating: Boolean(res.isGenerating),
    sessionId: res.sessionId ?? '',
    actualNCtx: Number(res.actualNCtx ?? 0),
  };
}

export type ChatMessageData = {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  tool_calls_json?: string;
};

export type ChatSessionData = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessageData[];
  message_count: number;
};

export async function listChatSessions(): Promise<ChatSessionData[]> {
  const res = await systemClient.listChatSessions({});
  return ((res.sessions as any[]) ?? []).map(s => ({
    id: s.id ?? '',
    title: s.title ?? 'New Conversation',
    created_at: s.createdAt ?? '',
    updated_at: s.updatedAt ?? '',
    messages: ((s.messages as any[]) ?? []).map(m => ({
      id: m.id ?? '',
      role: m.role ?? '',
      content: m.content ?? '',
      timestamp: m.timestamp ?? '',
      tool_calls_json: m.toolCallsJson ?? '',
    })),
    message_count: Number(s.messageCount ?? 0),
  }));
}

export async function getChatSession(id: string): Promise<ChatSessionData | null> {
  const res = await systemClient.getChatSession({ id });
  if (!res.session) return null;
  const s = res.session as any;
  return {
    id: s.id ?? '',
    title: s.title ?? 'New Conversation',
    created_at: s.createdAt ?? '',
    updated_at: s.updatedAt ?? '',
    messages: ((s.messages as any[]) ?? []).map(m => ({
      id: m.id ?? '',
      role: m.role ?? '',
      content: m.content ?? '',
      timestamp: m.timestamp ?? '',
      tool_calls_json: m.toolCallsJson ?? '',
    })),
    message_count: Number(s.messageCount ?? 0),
  };
}

export async function saveChatSession(id: string, title: string, messages: ChatMessageData[]): Promise<ChatSessionData | null> {
  const res = await systemClient.saveChatSession({
    id,
    title,
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      toolCallsJson: m.tool_calls_json ?? '',
    })),
  });
  if (!res.session) return null;
  const s = res.session as any;
  return {
    id: s.id ?? '',
    title: s.title ?? 'New Conversation',
    created_at: s.createdAt ?? '',
    updated_at: s.updatedAt ?? '',
    messages: ((s.messages as any[]) ?? []).map(m => ({
      id: m.id ?? '',
      role: m.role ?? '',
      content: m.content ?? '',
      timestamp: m.timestamp ?? '',
      tool_calls_json: m.toolCallsJson ?? '',
    })),
    message_count: Number(s.messageCount ?? 0),
  };
}

export async function deleteChatSession(id: string): Promise<boolean> {
  const res = await systemClient.deleteChatSession({ id });
  return Boolean(res.success);
}

export type AIConfigResponse = {
  provider: string;
  endpoint: string;
  model: string;
  context_size: number;
  has_api_key: boolean;
};

export async function getAIConfig(): Promise<AIConfigResponse> {
  const res = await fetch('/api/config/ai', { headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {} });
  if (!res.ok) throw new Error(`getAIConfig: ${res.status}`);
  return res.json();
}

export async function updateAIConfig(patch: {
  provider?: string;
  endpoint?: string;
  model?: string;
  api_key?: string;
  context_size?: number;
}): Promise<AIConfigResponse> {
  const res = await fetch('/api/config/ai', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `updateAIConfig: ${res.status}`);
  }
  return res.json();
}

export type BtpBond = {
  analytics_available: boolean;
  analytics_note: string;
  isin: string;
  name: string;
  bond_type: string;
  price: number;
  coupon: number;
  expiry_date: string;
  maturity_years: number;
  duration_mac: number;
  duration_mod: number;
  rate_hike_impact: number;
  simple_yield_net: number;
  simple_yield_gross: number;
  ytm_gross: number;
  ytm_net: number;
  total_return_net: number;
  total_return_gross: number;
  score: number;
  tier_rank: string;
  is_traded: boolean;
  scraped_at: string;
  is_starred: boolean;
};

export async function listBtps(params?: { query?: string; bondType?: string; starredOnly?: boolean; targetMaturityYear?: number }): Promise<{ btps: BtpBond[]; lastUpdated: string; totalCount: number }> {
  const res = await btpClient.listBtps({
    query: params?.query ?? '',
    bondType: params?.bondType ?? '',
    starredOnly: Boolean(params?.starredOnly),
    targetMaturityYear: params?.targetMaturityYear ?? 0,
  });
  return {
    btps: (res.btps ?? []).map((b: any) => ({
      isin: b.isin ?? '',
      name: b.name ?? '',
      analytics_available: Boolean(b.analyticsAvailable),
      analytics_note: b.analyticsNote ?? '',
      bond_type: b.bondType ?? '',
      price: num(b.price),
      coupon: num(b.coupon),
      expiry_date: b.expiryDate ?? '',
      maturity_years: num(b.maturityYears),
      duration_mac: num(b.durationMac),
      duration_mod: num(b.durationMod),
      rate_hike_impact: num(b.rateHikeImpact),
      simple_yield_net: num(b.simpleYieldNet),
      simple_yield_gross: num(b.simpleYieldGross),
      ytm_gross: num(b.ytmGross),
      ytm_net: num(b.ytmNet),
      total_return_net: num(b.totalReturnNet),
      total_return_gross: num(b.totalReturnGross),
      score: num(b.score),
      tier_rank: b.tierRank ?? 'F',
      is_traded: Boolean(b.isTraded),
      scraped_at: b.scrapedAt ?? '',
      is_starred: Boolean(b.isStarred),
    })),
    lastUpdated: res.lastUpdated ?? '',
    totalCount: num(res.totalCount),
  };
}

export async function refreshBtps(targetMaturityYear?: number): Promise<{ count: number; lastUpdated: string }> {
  const res = await btpClient.refreshBtps({ targetMaturityYear: targetMaturityYear ?? 0 });
  return { count: num(res.count), lastUpdated: res.lastUpdated ?? '' };
}

export async function toggleStarBtp(isin: string, starred: boolean): Promise<boolean> {
  const res = await btpClient.toggleStarBtp({ isin, starred });
  return Boolean(res.starred);
}

export type GeoExposure = {
  region?: string;
  country_code?: string;
  country_name?: string;
  value_minor: number;
  percentage: number;
};

export type CurrencyExposure = {
  currency: string;
  is_hedged: boolean;
  value_minor: number;
  percentage: number;
  fx_impact_5pct_minor: number;
};

export type GeoRadarResult = {
  regions: GeoExposure[];
  countries: GeoExposure[];
  currencies: CurrencyExposure[];
  diagnostics: Diagnostic[];
  current_eur_usd_rate: number;
  current_eur_usd_observed_on: string;
  current_eur_usd_source_url: string;
};

export async function getGeoRadar(includeCash = false): Promise<GeoRadarResult> {
  const res = await summaryClient.getGeoRadar({ includeCash });
  return {
    current_eur_usd_rate: Number(res.currentEurUsdRate),
    current_eur_usd_observed_on: res.currentEurUsdObservedOn ?? '',
    current_eur_usd_source_url: res.currentEurUsdSourceUrl ?? '',
    regions: (res.regions ?? []).map((r: any) => ({
      region: r.region,
      value_minor: Number(r.valueMinor),
      percentage: Number(r.percentage),
    })),
    countries: (res.countries ?? []).map((c: any) => ({
      region: c.region,
      country_code: c.countryCode,
      country_name: c.countryName,
      value_minor: Number(c.valueMinor),
      percentage: Number(c.percentage),
    })),
    currencies: (res.currencies ?? []).map((c: any) => ({
      currency: c.currency,
      is_hedged: Boolean(c.isHedged),
      value_minor: Number(c.valueMinor),
      percentage: Number(c.percentage),
      fx_impact_5pct_minor: Number(c.fxImpact_5PctMinor),
    })),
    diagnostics: (res.diagnostics ?? []).map((d: any) => ({
      id: d.id,
      category: d.category,
      severity: d.severity,
      title: d.title,
      message: d.message,
    })),
  };
}

export interface RefreshTickData {
  ticker: string;
  isin: string;
  refreshedToday: number;
  enabled: boolean;
  phase: string;
  hasError: boolean;
}

export async function* watchContinuousRefresh(options?: { signal?: AbortSignal }): AsyncIterable<RefreshTickData> {
  const stream = instrumentClient.watchContinuousRefresh({}, options);
  for await (const tick of stream) {
    yield {
      ticker: tick.ticker ?? '',
      isin: tick.isin ?? '',
      refreshedToday: tick.refreshedToday ?? 0,
      enabled: tick.enabled ?? false,
      phase: tick.phase ?? 'idle',
      hasError: tick.hasError ?? false,
    };
  }
}

export async function setContinuousRefresh(enabled: boolean): Promise<void> {
  await instrumentClient.setContinuousRefresh({ enabled });
}

export async function reclassifyInstruments(): Promise<{ updated: number; total: number }> {
  const res = await instrumentClient.reclassifyInstruments({});
  return { updated: res.updated, total: res.total };
}
