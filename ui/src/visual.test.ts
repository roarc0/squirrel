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

test('inflation chart geometry scales negative and positive values correctly', () => {
  const values = [-0.5, 0.0, 1.5, 3.2];
  const geom = chartGeometry(values, values, false);
  assert.ok(geom.low < -0.5);
  assert.ok(geom.high > 3.2);
  const zeroRatio = (geom.high - 0) / (geom.high - geom.low);
  const zeroY = 24 + zeroRatio * 196;
  assert.ok(zeroY > 24 && zeroY < 220);
});

