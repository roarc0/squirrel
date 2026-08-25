import type { InstrumentType } from '../api';

type Numeric = string | number;

export const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
export const minor = (value: Numeric | undefined) => Math.round(n(value) * 100);
export const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

export const percent = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value) ? '—' : `${(value / 100).toFixed(2)}%`;

let hideBalancesGlobal = typeof localStorage !== 'undefined' && localStorage.getItem('loot.hideBalances') === 'true';

export const setHideBalancesState = (hidden: boolean) => {
  hideBalancesGlobal = hidden;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('loot.hideBalances', String(hidden));
  }
};

export const getHideBalancesState = (): boolean => hideBalancesGlobal;

export const money = (value: number | undefined, currency: string) => {
  if (hideBalancesGlobal) return '••••••';
  if (value === undefined || !Number.isFinite(value)) return '—';
  const curr = currency || 'EUR';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: curr, maximumFractionDigits: 2 }).format(value / 100);
  } catch {
    return `${curr} ${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
};

export const compactMoney = (value: number, currency: string) => {
  if (hideBalancesGlobal) return '••••••';
  const curr = currency || 'EUR';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: curr, notation: 'compact', maximumFractionDigits: 1 }).format(value / 100);
  } catch {
    return `${curr} ${(value / 100).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })}`;
  }
};

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
