import assert from 'node:assert/strict';
import test from 'node:test';
import { chartGeometry, chipColor, matchesExactFilters, pageBounds, performanceMood } from './visual.ts';

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
