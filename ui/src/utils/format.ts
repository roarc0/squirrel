import type { InstrumentType } from '../api';

type Numeric = string | number;

export const n = (value: Numeric | undefined) => (value === '' || value === undefined ? 0 : Number(value));
export const minor = (value: Numeric | undefined) => Math.round(n(value) * 100);
export const bps = (value: Numeric | undefined) => Math.round(n(value) * 100);

export const localDateISO = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const percent = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value) ? '—' : `${(value / 100).toFixed(2)}%`;

let hideBalancesGlobal = typeof localStorage !== 'undefined' && localStorage.getItem('squirrel.hideBalances') === 'true';

export const setHideBalancesState = (hidden: boolean) => {
  hideBalancesGlobal = hidden;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('squirrel.hideBalances', String(hidden));
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
  etp: 'ETP',
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

export function relativeDate(dateString: string | undefined | null, now: number = Date.now()): string {
  if (!dateString) return '—';
  const timestamp = new Date(dateString).getTime();
  if (isNaN(timestamp)) return '—';
  const diffSec = Math.round((now - timestamp) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const diffDays = Math.floor(diffSec / 86400);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30.4);
    return `${Math.max(1, months)}mo ago`;
  }
  const years = Math.floor(diffDays / 365);
  const remainingMonths = Math.floor((diffDays % 365) / 30.4);
  return remainingMonths > 0 && years < 3 ? `${years}y ${remainingMonths}mo ago` : `${years}y ago`;
}

