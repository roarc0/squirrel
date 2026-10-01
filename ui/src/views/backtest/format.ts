export const colors = ['#6097ff', '#b798fb', '#f17eae', '#50c8df', '#6cbf8e', '#e6af59'];
export const pct = (value?: number) =>
  value === undefined || !Number.isFinite(value)
    ? '—'
    : `${(Math.abs(value) < 0.00005 ? 0 : value * 100).toFixed(2)}%`;
export const ratio = (value?: number) =>
  value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(2);
export const eur = (value: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(
    value,
  );
