import assert from 'node:assert/strict';
import test from 'node:test';
import { compactMoney, setHideBalancesState } from './utils/format.ts';
import { chartGeometry, chartTickIndexes, chipColor, filterChartRange, matchesExactFilters, nearestChartIndex, pageBounds, performanceMood } from './visual.ts';

test('financial labels use semantic colors and unknown labels stay stable', () => {
  assert.equal(chipColor('Cash'), 'teal');
  assert.equal(chipColor('Bond'), 'indigo');
  assert.equal(chipColor('Custom label'), chipColor('custom label'));
});

test('performance moods cover losses through strong gains', () => {
  assert.equal(performanceMood(-30).emoji, '💀');
  assert.equal(performanceMood(0).emoji, '😐');
  assert.equal(performanceMood(30).emoji, '🚀');
});

test('chart geometry stays finite for a flat series', () => {
  const geometry = chartGeometry([100, 100]);
  assert.ok(geometry.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.ok(geometry.high > geometry.low);
  assert.equal(chartGeometry([100]).points[0].x, 407);
  assert.ok(chartGeometry([-1, 1], undefined, false).low < 0);
});

test('chart ranges use the latest snapshot as their endpoint', () => {
  const snapshots = ['2025-01-01', '2026-01-01', '2026-01-07', '2026-01-08'].map(observed_on => ({ observed_on }));
  assert.deepEqual(filterChartRange(snapshots, '1w').map(item => item.observed_on), ['2026-01-01', '2026-01-07', '2026-01-08']);
  assert.equal(filterChartRange(snapshots, 'max').length, 4);
  const monthEnd = ['2026-01-30', '2026-02-28', '2026-03-31'].map(observed_on => ({ observed_on }));
  assert.deepEqual(filterChartRange(monthEnd, '1m').map(item => item.observed_on), ['2026-02-28', '2026-03-31']);
});

test('compact chart labels respect hidden balance mode', () => {
  setHideBalancesState(true);
  assert.equal(compactMoney(12_345_678, 'EUR'), '••••••');
  setHideBalancesState(false);
  assert.notEqual(compactMoney(12_345_678, 'EUR'), '••••••');
});

test('chart hover snaps to the nearest visible snapshot', () => {
  assert.equal(nearestChartIndex(74, 4), 0);
  assert.equal(nearestChartIndex(407, 4), 2);
  assert.equal(nearestChartIndex(900, 4), 3);
  assert.equal(nearestChartIndex(407, 1), 0);
});

test('chart ticks spread labels across the visible range', () => {
  assert.deepEqual(chartTickIndexes(12), [0, 2, 4, 6, 7, 9, 11]);
  assert.deepEqual(chartTickIndexes(1), [0]);
});

test('pagination caps pages at one hundred rows', () => {
  assert.deepEqual(pageBounds(120, 2), { current: 2, pages: 3, start: 50, end: 100 });
  assert.deepEqual(pageBounds(250, 2, 500), { current: 2, pages: 3, start: 100, end: 200 });
  assert.deepEqual(pageBounds(20, 9), { current: 1, pages: 1, start: 0, end: 20 });
});

test('catalog filters combine exact column values', () => {
  const values = { issuer: 'Vanguard', type: 'etf', ucits: true };
  assert.equal(matchesExactFilters(values, { issuer: 'Vanguard', type: '', ucits: 'true' }), true);
  assert.equal(matchesExactFilters(values, { issuer: 'iShares', type: '', ucits: '' }), false);
});

test('chart ranges filter monthly observed_on dates correctly', () => {
  const monthly = [
    '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
    '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12',
    '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
    '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
  ].map(observed_on => ({ observed_on }));
  const oneYear = filterChartRange(monthly, '1y');
  assert.equal(oneYear.length, 13);
  assert.equal(oneYear[0].observed_on, '2025-07');
  assert.equal(oneYear.at(-1)!.observed_on, '2026-07');

  const maxRange = filterChartRange(monthly, 'max');
  assert.equal(maxRange.length, 31);
});


