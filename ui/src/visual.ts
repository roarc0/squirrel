const knownColors: Record<string, string> = {
  cash: 'teal', equity: 'blue', bond: 'indigo', mixed: 'violet', other: 'gray',
  commodity: 'yellow', monetary: 'cyan', 'real estate': 'grape', crypto: 'orange',
  etf: 'blue', 'ucits etf': 'blue', 'non-ucits etf': 'blue', etc: 'yellow', 'non-ucits etc': 'yellow', etn: 'orange', 'non-ucits etn': 'orange',
  fund: 'violet', stock: 'blue', bank: 'cyan', broker: 'violet', acc: 'teal', dist: 'orange',
  refreshed: 'teal', 'awaiting refresh': 'gray', archived: 'gray', hedged: 'cyan', default: 'teal', rate: 'green', tax: 'red',
  'strictly better': 'green', 'same index': 'blue', 'same exposure': 'violet', score: 'teal',
  'phy / full': 'blue', 'phy / sampled': 'cyan', 'swap / syn': 'grape', synthetic: 'grape',
  'physical_full': 'blue', 'physical_sampling': 'cyan',
};
const fallbackColors = ['blue', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange', 'red', 'pink', 'grape', 'violet', 'indigo'];

export function chipColor(value: string) {
  const key = value.trim().toLowerCase();
  if (knownColors[key]) return knownColors[key];
  const hash = [...key].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 0);
  return fallbackColors[hash % fallbackColors.length];
}

export function performanceMood(percent: number) {
  if (percent <= -30) return { emoji: '💀', label: 'Critical' };
  if (percent <= -15) return { emoji: '😰', label: 'Rough' };
  if (percent < -3) return { emoji: '😕', label: 'Down' };
  if (percent <= 3) return { emoji: '😐', label: 'Flat' };
  if (percent < 15) return { emoji: '🙂', label: 'Good' };
  if (percent < 30) return { emoji: '🔥', label: 'Great' };
  return { emoji: '🚀', label: 'Excellent' };
}

export type ChartRange = '1w' | '2w' | '1m' | '3m' | '6m' | '1y' | '3y' | '5y' | 'max';

const chartRanges: Record<Exclude<ChartRange, 'max'>, { days?: number; months?: number }> = { '1w': { days: 7 }, '2w': { days: 14 }, '1m': { months: 1 }, '3m': { months: 3 }, '6m': { months: 6 }, '1y': { months: 12 }, '3y': { months: 36 }, '5y': { months: 60 } };

export function filterChartRange<T extends { observed_on: string }>(items: T[], range: ChartRange) {
  if (range === 'max' || items.length === 0) return items;
  const cutoff = new Date(`${items.at(-1)!.observed_on}T00:00:00Z`); const offset = chartRanges[range];
  if (offset.days) cutoff.setUTCDate(cutoff.getUTCDate() - offset.days);
  else {
    const day = cutoff.getUTCDate(); cutoff.setUTCDate(1); cutoff.setUTCMonth(cutoff.getUTCMonth() - offset.months!);
    cutoff.setUTCDate(Math.min(day, new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  return items.filter(item => Date.parse(`${item.observed_on}T00:00:00Z`) >= cutoff.getTime());
}

export function chartGeometry(values: number[], scaleValues = values) {
  const minimum = Math.min(...scaleValues); const maximum = Math.max(...scaleValues); const padding = Math.max((maximum - minimum) * 0.08, maximum * 0.01, 1); const low = Math.max(0, minimum - padding); const high = maximum + padding;
  return { low, high, points: values.map((value, index) => ({ x: values.length === 1 ? 407 : 74 + index * 666 / (values.length - 1), y: 24 + (high - value) / (high - low) * 196 })) };
}

export function nearestChartIndex(x: number, count: number) {
  if (count < 2) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((x - 74) / 666 * (count - 1))));
}

export function pageBounds(total: number, page: number, requestedSize = 50) {
  const size = Math.min(100, Math.max(1, requestedSize)); const pages = Math.max(1, Math.ceil(total / size)); const current = Math.min(pages, Math.max(1, page)); const start = (current - 1) * size;
  return { current, pages, start, end: Math.min(total, start + size) };
}

export function matchesExactFilters<K extends string>(values: Record<K, string | boolean>, filters: Record<K, string>) {
  return (Object.keys(filters) as K[]).every(key => !filters[key] || String(values[key]) === filters[key]);
}
