import assert from 'node:assert/strict';
import test from 'node:test';
import type { Instrument } from '../api.ts';
import { compactMoney, currencySymbol, instrumentLabels, localDateISO, relativeDate, setHideBalancesState } from './format.ts';
import { builtInPresets, computeInstrumentScore, defaultFilters, defaultRankFilters, isESG, matchesFilters, matchesRankFilters, parseSearchTerms, resolveInstrumentProvider } from './rankFilters.ts';
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

test('computeInstrumentScore calculates ETF score and returns null for non-enriched or non-UCITS', () => {
  const enrichedUCITS: Partial<Instrument> = {
    instrument_type: 'etf',
    data_status: 'enriched',
    ucits: true,
    ter_bps: 20,
    fund_size_million: 1000,
    inception_date: '2019-01-01',
    tracking_difference_bps: 5,
    tracking_error_bps: 8,
  };
  const nonUCITS: Partial<Instrument> = {
    ...enrichedUCITS,
    ucits: false,
  };
  const nonEnriched: Partial<Instrument> = {
    ...enrichedUCITS,
    data_status: 'catalog',
  };

  const asOf = new Date('2024-01-01').getTime();
  const score = computeInstrumentScore(enrichedUCITS, asOf);
  assert.ok(score !== null && score > 70 && score <= 100);
  assert.equal(computeInstrumentScore(nonUCITS, asOf), null);
  assert.equal(computeInstrumentScore(nonEnriched, asOf), null);
});

test('matchesFilters supports query search, max TER, min size, and ucits status', () => {
  const testETF: Partial<Instrument> = {
    name: 'Vanguard FTSE All-World UCITS ETF (USD) Accumulating',
    ticker: 'VWCE',
    isin: 'IE00BK5BQT80',
    provider: 'Vanguard',
    instrument_type: 'etf',
    data_status: 'enriched',
    ucits: true,
    asset_class: 'equity',
    distribution: 'accumulating',
    ter_bps: 22,
    fund_size_million: 12000,
  };

  // Text search on ticker or name
  assert.equal(matchesFilters(testETF, { ...defaultFilters, query: 'VWCE' }), true);
  assert.equal(matchesFilters(testETF, { ...defaultFilters, query: 'ftse' }), true);
  assert.equal(matchesFilters(testETF, { ...defaultFilters, query: 'ishares' }), false);

  // Max TER
  assert.equal(matchesFilters(testETF, { ...defaultFilters, maxTER: 0.25 }), true);
  assert.equal(matchesFilters(testETF, { ...defaultFilters, maxTER: 0.20 }), false);

  // Min size
  assert.equal(matchesFilters(testETF, { ...defaultFilters, minSize: 5000 }), true);
  assert.equal(matchesFilters(testETF, { ...defaultFilters, minSize: 20000 }), false);

  // UCITS
  assert.equal(matchesFilters(testETF, { ...defaultFilters, ucits: 'true' }), true);
  assert.equal(matchesFilters(testETF, { ...defaultFilters, ucits: 'false' }), false);
});

test('matchesFilters supports explicit exclusion of options', () => {
  const accETF: Partial<Instrument> = {
    name: 'iShares Core MSCI World UCITS ETF',
    ticker: 'SWDA',
    isin: 'IE00B4L5Y983',
    instrument_type: 'etf',
    data_status: 'enriched',
    ucits: true,
    distribution: 'accumulating',
    asset_class: 'equity',
    replication: 'physical_full',
  };
  const distETF: Partial<Instrument> = {
    ...accETF,
    name: 'iShares MSCI World UCITS ETF (Dist)',
    distribution: 'distributing',
  };
  const synthETF: Partial<Instrument> = {
    ...accETF,
    name: 'Invesco MSCI World UCITS ETF',
    replication: 'synthetic',
  };
  const cryptoETP: Partial<Instrument> = {
    ...accETF,
    name: 'CoinShares Physical Bitcoin',
    asset_class: 'crypto',
  };

  // Exclude distributing
  const excludeDistFilters = { ...defaultFilters, excludeDistributions: ['distributing'] };
  assert.equal(matchesFilters(accETF, excludeDistFilters), true);
  assert.equal(matchesFilters(distETF, excludeDistFilters), false);

  // Exclude synthetic replication
  const excludeSynthFilters = { ...defaultFilters, excludeReplications: ['synthetic'] };
  assert.equal(matchesFilters(accETF, excludeSynthFilters), true);
  assert.equal(matchesFilters(synthETF, excludeSynthFilters), false);

  // Exclude crypto asset class
  const excludeCryptoFilters = { ...defaultFilters, excludeAssetClasses: ['crypto'] };
  assert.equal(matchesFilters(accETF, excludeCryptoFilters), true);
  assert.equal(matchesFilters(cryptoETP, excludeCryptoFilters), false);

  // Include equity and exclude distributing simultaneously
  const combined = { ...defaultFilters, assetClasses: ['equity'], excludeDistributions: ['distributing'] };
  assert.equal(matchesFilters(accETF, combined), true);
  assert.equal(matchesFilters(distETF, combined), false);
  assert.equal(matchesFilters(cryptoETP, combined), false);
});

test('relativeDate formats timestamps into human-readable relative intervals', () => {
  const base = new Date('2026-09-29T12:00:00Z').getTime();

  assert.equal(relativeDate(undefined, base), '—');
  assert.equal(relativeDate(null, base), '—');
  assert.equal(relativeDate('invalid-date', base), '—');

  // Just now (<60s)
  assert.equal(relativeDate(new Date(base - 30 * 1000).toISOString(), base), 'just now');

  // Minutes ago (<1h)
  assert.equal(relativeDate(new Date(base - 5 * 60 * 1000).toISOString(), base), '5m ago');

  // Hours ago (<24h)
  assert.equal(relativeDate(new Date(base - 3 * 3600 * 1000).toISOString(), base), '3h ago');

  // Yesterday (1 day)
  assert.equal(relativeDate(new Date(base - 86400 * 1000).toISOString(), base), 'yesterday');

  // Days ago (<30d)
  assert.equal(relativeDate(new Date(base - 14 * 86400 * 1000).toISOString(), base), '14d ago');

  // Months ago (<365d)
  assert.equal(relativeDate(new Date(base - 90 * 86400 * 1000).toISOString(), base), '2mo ago');

  // Years ago
  assert.equal(relativeDate(new Date(base - 400 * 86400 * 1000).toISOString(), base), '1y 1mo ago');
  assert.equal(relativeDate(new Date(base - 5 * 365 * 86400 * 1000).toISOString(), base), '5y ago');
});

test('matchesFilters supports strategy filtering, tracking diff, and tracking error', () => {
  const broadETF: Partial<Instrument> = {
    name: 'Vanguard FTSE All-World UCITS ETF',
    strategy: 'broad',
    tracking_difference_bps: 10, // 0.10%
    tracking_error_bps: 8,       // 0.08%
  };
  const esgETF: Partial<Instrument> = {
    name: 'iShares MSCI World SRI UCITS ETF',
    strategy: 'esg',
    tracking_difference_bps: 25, // 0.25%
    tracking_error_bps: 30,      // 0.30%
  };

  // Strategy include
  assert.equal(matchesFilters(broadETF, { ...defaultFilters, strategies: ['broad'] }), true);
  assert.equal(matchesFilters(esgETF, { ...defaultFilters, strategies: ['broad'] }), false);

  // Strategy exclude
  assert.equal(matchesFilters(broadETF, { ...defaultFilters, excludeStrategies: ['esg'] }), true);
  assert.equal(matchesFilters(esgETF, { ...defaultFilters, excludeStrategies: ['esg'] }), false);

  // Max Tracking Diff % (broad has 0.10%, esg has 0.25%)
  assert.equal(matchesFilters(broadETF, { ...defaultFilters, maxTrackingDiff: 0.15 }), true);
  assert.equal(matchesFilters(esgETF, { ...defaultFilters, maxTrackingDiff: 0.15 }), false);

  // Max Tracking Error % (broad has 0.08%, esg has 0.30%)
  assert.equal(matchesFilters(broadETF, { ...defaultFilters, maxTrackingError: 0.10 }), true);
  assert.equal(matchesFilters(esgETF, { ...defaultFilters, maxTrackingError: 0.10 }), false);
});

test('parseSearchTerms parses included and excluded keywords', () => {
  assert.deepEqual(parseSearchTerms('msci -usa'), { includes: ['msci'], excludes: ['usa'] });
  assert.deepEqual(parseSearchTerms('msci !usa'), { includes: ['msci'], excludes: ['usa'] });
  assert.deepEqual(parseSearchTerms('msci -usa -china'), { includes: ['msci'], excludes: ['usa', 'china'] });
  assert.deepEqual(parseSearchTerms('ftse world', 'china, em'), { includes: ['ftse', 'world'], excludes: ['china', 'em'] });
  assert.deepEqual(parseSearchTerms(''), { includes: [], excludes: [] });
});

test('matchesFilters allows including keywords while excluding others', () => {
  const msciWorld: Partial<Instrument> = {
    name: 'Amundi MSCI World Minimum Volatility Advanced UCITS ETF Acc',
    ticker: 'WMMV',
    index_name: 'MSCI World Minimum Volatility Advanced Target',
  };
  const msciUSA: Partial<Instrument> = {
    name: 'iShares MSCI USA UCITS ETF',
    ticker: 'CSUS',
    index_name: 'MSCI USA Index',
  };
  const ftseChina: Partial<Instrument> = {
    name: 'Franklin FTSE China UCITS ETF',
    ticker: 'FLXC',
    index_name: 'FTSE China Index',
  };

  // User includes "msci" but excludes "usa" via inline query "msci -usa"
  const inlineQuery = { ...defaultFilters, query: 'msci -usa' };
  assert.equal(matchesFilters(msciWorld, inlineQuery), true);
  assert.equal(matchesFilters(msciUSA, inlineQuery), false);
  assert.equal(matchesFilters(ftseChina, inlineQuery), false);

  // User includes "msci" but excludes "usa" via explicit excludeQuery
  const explicitQuery = { ...defaultFilters, query: 'msci', excludeQuery: 'usa' };
  assert.equal(matchesFilters(msciWorld, explicitQuery), true);
  assert.equal(matchesFilters(msciUSA, explicitQuery), false);
  assert.equal(matchesFilters(ftseChina, explicitQuery), false);
});

test('isESG detects sustainable / SRI ETFs and matchesFilters handles ESG screening', () => {
  const esgEtf: Partial<Instrument> = {
    name: 'iShares MSCI World SRI UCITS ETF',
    ticker: 'SUSW',
    index_name: 'MSCI World SRI Select Reduced Fossil Fuel Index',
    strategy: 'esg',
  };
  const screenedEtf: Partial<Instrument> = {
    name: 'Xtrackers MSCI World ESG Screened UCITS ETF',
    ticker: 'XDWE',
    index_name: 'MSCI World ESG Screened Index',
    strategy: 'broad',
  };
  const climateEtf: Partial<Instrument> = {
    name: 'Amundi MSCI World Climate Paris Aligned UCITS ETF',
    ticker: 'PABW',
    index_name: 'MSCI World Climate Paris Aligned Filtered Index',
    strategy: 'broad',
  };
  const traditionalEtf: Partial<Instrument> = {
    name: 'iShares Core MSCI World UCITS ETF',
    ticker: 'IWDA',
    index_name: 'MSCI World Index',
    strategy: 'broad',
  };

  assert.equal(isESG(esgEtf), true);
  assert.equal(isESG(screenedEtf), true);
  assert.equal(isESG(climateEtf), true);
  assert.equal(isESG(traditionalEtf), false);

  // ESG only filter
  const esgOnly = { ...defaultFilters, esg: 'esg' };
  assert.equal(matchesFilters(esgEtf, esgOnly), true);
  assert.equal(matchesFilters(screenedEtf, esgOnly), true);
  assert.equal(matchesFilters(climateEtf, esgOnly), true);
  assert.equal(matchesFilters(traditionalEtf, esgOnly), false);

  // Exclude ESG filter
  const nonEsgOnly = { ...defaultFilters, esg: 'non_esg' };
  assert.equal(matchesFilters(esgEtf, nonEsgOnly), false);
  assert.equal(matchesFilters(screenedEtf, nonEsgOnly), false);
  assert.equal(matchesFilters(climateEtf, nonEsgOnly), false);
  assert.equal(matchesFilters(traditionalEtf, nonEsgOnly), true);
});

test('computeInstrumentScore applies diminishing returns for age >= 10y and fund size >= €3B', () => {
  const asOf = new Date('2026-01-01').getTime();

  // 10-year-old vs 20-year-old fund with identical specs
  const etf10y: Partial<Instrument> = {
    instrument_type: 'etf',
    data_status: 'enriched',
    ucits: true,
    ter_bps: 15,
    fund_size_million: 5000,
    inception_date: '2016-01-01', // exactly 10 years
    tracking_difference_bps: -5, // outperforming
    tracking_error_bps: 6,
  };
  const etf20y: Partial<Instrument> = {
    ...etf10y,
    inception_date: '2006-01-01', // 20 years
  };

  const score10y = computeInstrumentScore(etf10y, asOf);
  const score20y = computeInstrumentScore(etf20y, asOf);
  assert.ok(score10y !== null && score20y !== null);
  // Both are established: score is identical because age saturated at 10 years
  assert.equal(score10y, score20y);

  // 20 billion vs 50 billion fund with identical specs
  const etf20B: Partial<Instrument> = {
    ...etf10y,
    fund_size_million: 20000, // €20 Billion
  };
  const etf50B: Partial<Instrument> = {
    ...etf10y,
    fund_size_million: 50000, // €50 Billion
  };

  const score20B = computeInstrumentScore(etf20B, asOf);
  const score50B = computeInstrumentScore(etf50B, asOf);
  assert.ok(score20B !== null && score50B !== null);
  // Both mega-funds are fully saturated: score is identical
  assert.equal(score20B, score50B);
});

test('matchesFilters supports active strategy filtering', () => {
  const activeEtf: Partial<Instrument> = {
    name: 'JPMorgan Global Research Enhanced Index Equity Active UCITS ETF',
    ticker: 'JREG',
    strategy: 'active',
  };
  const passiveEtf: Partial<Instrument> = {
    name: 'iShares Core MSCI World UCITS ETF',
    ticker: 'IWDA',
    strategy: 'broad',
  };

  const activeFilter = { ...defaultFilters, strategies: ['active'] };
  assert.equal(matchesFilters(activeEtf, activeFilter), true);
  assert.equal(matchesFilters(passiveEtf, activeFilter), false);
});

test('resolveInstrumentProvider and matchesFilters correctly handle Avantis provider', () => {
  const avantisEtf: Partial<Instrument> = {
    name: 'Avantis Global Small Cap Value UCITS ETF USD Acc',
    provider: 'American Century',
    strategy: 'active',
  };
  assert.equal(resolveInstrumentProvider(avantisEtf), 'Avantis');

  // Matching by Avantis issuer
  const avantisFilter = { ...defaultFilters, issuers: ['Avantis'] };
  assert.equal(matchesFilters(avantisEtf, avantisFilter), true);

  // Negative issuer filter
  const excludeAvantis = { ...defaultFilters, excludeIssuers: ['Avantis'] };
  assert.equal(matchesFilters(avantisEtf, excludeAvantis), false);

  // ESG and Active chip colors
  assert.equal(chipColor('esg'), 'green');
  assert.equal(chipColor('active'), 'orange');
});

test('currencySymbol returns expected symbol or currency code', () => {
  assert.equal(currencySymbol('EUR'), '€');
  assert.equal(currencySymbol('USD'), '$');
  assert.equal(currencySymbol('GBP'), '£');
  assert.equal(currencySymbol('CHF'), 'CHF');
  assert.equal(currencySymbol('JPY'), '¥');
  assert.equal(currencySymbol('ILS'), '₪');
  assert.equal(currencySymbol('CAD'), '$');
  assert.equal(currencySymbol('AUD'), '$');
  assert.equal(currencySymbol(''), '€');
  assert.equal(currencySymbol(undefined), '€');
  assert.equal(currencySymbol('XYZ'), 'XYZ');
});



