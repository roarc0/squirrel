import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedHistory } from './historyCoverage.ts';

test('history preview identifies both date limits, updates on replacement, and waits for every active instrument', () => {
  const coverage = {
    old: { start: '2010-01-01', end: '2026-09-30' },
    recent: { start: '2026-08-19', end: '2026-09-30' },
    stale: { start: '2020-01-01', end: '2026-09-18' },
    failed: { error: 'Unavailable' },
  };
  const short = sharedHistory(['old', 'recent', 'stale'], coverage)!;
  assert.equal(short.start, '2026-08-19');
  assert.equal(short.end, '2026-09-18');
  assert.deepEqual(short.startLimiters, ['recent']);
  assert.deepEqual(short.endLimiters, ['stale']);
  assert.equal(short.years, 30 / 365.25);
  assert.equal(sharedHistory(['old', 'stale'], coverage)?.start, '2020-01-01');
  assert.equal(sharedHistory(['old', 'missing'], coverage), undefined);
  assert.equal(sharedHistory(['old', 'failed'], coverage), undefined);
  assert.equal(sharedHistory([], coverage), undefined);
  assert.ok(
    sharedHistory(['old', 'future'], { ...coverage, future: { start: '2027-01-01', end: '2027-02-01' } })!
      .years < 0,
  );
});
