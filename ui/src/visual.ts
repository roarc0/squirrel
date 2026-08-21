const knownColors: Record<string, string> = {
  cash: 'teal', equity: 'blue', bond: 'indigo', mixed: 'violet', other: 'gray',
  commodity: 'yellow', 'money market': 'cyan', 'real estate': 'grape', crypto: 'orange',
  etf: 'blue', 'ucits etf': 'blue', 'non-ucits etf': 'blue', etc: 'yellow', 'non-ucits etc': 'yellow', etn: 'orange', 'non-ucits etn': 'orange',
  fund: 'violet', stock: 'blue', bank: 'cyan', broker: 'violet', acc: 'teal', dist: 'orange',
  refreshed: 'teal', 'awaiting refresh': 'gray', archived: 'gray', hedged: 'cyan', default: 'teal', rate: 'green', tax: 'red',
  'strictly better': 'green', 'same index': 'blue', 'same exposure': 'violet', score: 'teal',
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

export function chartGeometry(values: number[]) {
  const minimum = Math.min(...values); const maximum = Math.max(...values); const padding = Math.max((maximum - minimum) * 0.08, maximum * 0.01, 1); const low = Math.max(0, minimum - padding); const high = maximum + padding;
  return { low, high, points: values.map((value, index) => ({ x: 74 + index * 666 / Math.max(values.length - 1, 1), y: 24 + (high - value) / (high - low) * 196 })) };
}

export function pageBounds(total: number, page: number, requestedSize = 50) {
  const size = Math.min(100, Math.max(1, requestedSize)); const pages = Math.max(1, Math.ceil(total / size)); const current = Math.min(pages, Math.max(1, page)); const start = (current - 1) * size;
  return { current, pages, start, end: Math.min(total, start + size) };
}

export function matchesExactFilters<K extends string>(values: Record<K, string | boolean>, filters: Record<K, string>) {
  return (Object.keys(filters) as K[]).every(key => !filters[key] || String(values[key]) === filters[key]);
}
