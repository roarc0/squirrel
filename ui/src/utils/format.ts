import type { InstrumentType } from '../api';

type Numeric = string | number;

export const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
export const minor = (value: Numeric | undefined) => Math.round(n(value) * 100);
export const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

export const percent = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value) ? '—' : `${(value / 100).toFixed(2)}%`;

let hideBalancesGlobal = false;

export const setHideBalancesState = (hidden: boolean) => {
  hideBalancesGlobal = hidden;
};

export const money = (value: number | undefined, currency: string) =>
  hideBalancesGlobal
    ? '••••••'
    : value === undefined || !Number.isFinite(value)
      ? '—'
      : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value / 100);

export const compactMoney = (value: number, currency: string) =>
  hideBalancesGlobal
    ? '••••••'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value / 100);

export const investedMoney = (invested: number, current: number, currency: string) =>
  invested > 0 || current === 0 ? money(invested, currency) : '—';

export const instrumentLabels: Record<InstrumentType, string> = {
  etf: 'ETF',
  etc: 'ETC',
  etn: 'ETN',
  fund: 'Fund',
  stock: 'Stock',
  bond: 'Bond',
  crypto: 'Crypto',
  commodity: 'Commodity',
  real_estate: 'Real estate',
  other: 'Other',
};

export const label = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, character => character.toUpperCase());

export const confirmDelete = (kind: string, name: string, consequence = '') =>
  window.confirm(`Delete ${kind} “${name}”?${consequence ? `\n\n${consequence}` : ''}\n\nThis cannot be undone.`);
