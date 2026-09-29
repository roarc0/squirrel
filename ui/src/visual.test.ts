import assert from 'node:assert/strict';
import test from 'node:test';
import type { Instrument } from './api.ts';
import { compactMoney, instrumentLabels, localDateISO, setHideBalancesState } from './utils/format.ts';
import { builtInPresets, defaultRankFilters, matchesRankFilters } from './utils/rankFilters.ts';
import { chartGeometry, chartTickIndexes, chipColor, filterChartRange, matchesExactFilters, nearestChartIndex, pageBounds, performanceMood } from './visual.ts';

test('financial labels use semantic colors and unknown labels stay stable', () => {
  assert.equal(instrumentLabels.etp, 'ETP');
  assert.equal(instrumentLabels.etc, 'ETC');
  assert.equal(instrumentLabels.etn, 'ETN');
  assert.equal(chipColor('ETP'), 'grape');
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

test('snapshot defaults use the local calendar date', () => {
  assert.equal(localDateISO(new Date(2026, 0, 2, 0, 30)), '2026-01-02');
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

test('matchesRankFilters supports distribution exclusion and multi-selection', () => {
  const accETF: Partial<Instrument> = {
    instrument_type: 'etf',
    data_status: 'enriched',
    ucits: true,
    distribution: 'accumulating',
    replication: 'physical_full',
    asset_class: 'equity',
    domicile: 'IE',
    fund_currency: 'EUR',
    ter_bps: 20,
    fund_size_million: 500,
    inception_date: '2020-01-01',
  };
  const distETF: Partial<Instrument> = {
    ...accETF,
    distribution: 'distributing',
  };

  // When no distribution filter is selected, both match
  assert.equal(matchesRankFilters(accETF, defaultRankFilters), true);
  assert.equal(matchesRankFilters(distETF, defaultRankFilters), true);

  // When user selects only 'accumulating' (deselecting/excluding dist)
  const onlyAccFilters = { ...defaultRankFilters, distributions: ['accumulating'] };
  assert.equal(matchesRankFilters(accETF, onlyAccFilters), true);
  assert.equal(matchesRankFilters(distETF, onlyAccFilters), false);

  // When user selects only 'distributing' (excluding acc)
  const onlyDistFilters = { ...defaultRankFilters, distributions: ['distributing'] };
  assert.equal(matchesRankFilters(accETF, onlyDistFilters), false);
  assert.equal(matchesRankFilters(distETF, onlyDistFilters), true);

  // When user selects both ['accumulating', 'distributing']
  const bothFilters = { ...defaultRankFilters, distributions: ['accumulating', 'distributing'] };
  assert.equal(matchesRankFilters(accETF, bothFilters), true);
  assert.equal(matchesRankFilters(distETF, bothFilters), true);
});

test('matchesRankFilters filters by asset class and replications', () => {
  const equityETF: Partial<Instrument> = {
    instrument_type: 'etf',
    data_status: 'enriched',
    ucits: true,
    distribution: 'accumulating',
    replication: 'physical_full',
    asset_class: 'equity',
    ter_bps: 12,
    fund_size_million: 1000,
    inception_date: '2018-01-01',
  };
  const bondETF: Partial<Instrument> = {
    ...equityETF,
    asset_class: 'bond',
    replication: 'physical_sampling',
  };
  const synthETF: Partial<Instrument> = {
    ...equityETF,
    replication: 'synthetic',
  };

  // Asset class filter
  assert.equal(matchesRankFilters(equityETF, { ...defaultRankFilters, assetClasses: ['equity'] }), true);
  assert.equal(matchesRankFilters(bondETF, { ...defaultRankFilters, assetClasses: ['equity'] }), false);
  assert.equal(matchesRankFilters(bondETF, { ...defaultRankFilters, assetClasses: ['bond'] }), true);

  // Multi-replication filter (selecting physical, excluding synthetic)
  const physicalOnly = { ...defaultRankFilters, replications: ['physical_full', 'physical_sampling'] };
  assert.equal(matchesRankFilters(equityETF, physicalOnly), true);
  assert.equal(matchesRankFilters(bondETF, physicalOnly), true);
  assert.equal(matchesRankFilters(synthETF, physicalOnly), false);
});

test('built-in presets provide valid filter configurations', () => {
  assert.ok(builtInPresets.length >= 5);
  const coreWorld = builtInPresets.find(p => p.id === 'core-world-acc');
  assert.ok(coreWorld);
  assert.deepEqual(coreWorld.filters.distributions, ['accumulating']);
  assert.deepEqual(coreWorld.filters.assetClasses, ['equity']);
});


