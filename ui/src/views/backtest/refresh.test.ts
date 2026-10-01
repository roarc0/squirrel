import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshBacktestInstruments } from './refresh.ts';

test('full refresh deduplicates instruments and still fetches returns after a profile failure', async () => {
  const calls: string[] = [];
  const result = await refreshBacktestInstruments(
    ['a', 'a', 'b'],
    {
      profile: async (isin) => {
        calls.push(`profile:${isin}`);
        if (isin === 'a') throw new Error('Profile unavailable');
      },
      history: async (isin) => {
        calls.push(`history:${isin}`);
      },
    },
    new AbortController().signal,
    () => {},
  );
  assert.deepEqual(calls, ['profile:a', 'history:a', 'profile:b', 'history:b']);
  assert.equal(result.completed, 1);
  assert.equal(result.total, 2);
  assert.deepEqual(result.failures, ['a · profile: Profile unavailable']);
});

test('cancelling a refresh stops remaining network operations', async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const result = await refreshBacktestInstruments(
    ['a', 'b'],
    {
      profile: async (isin) => {
        calls.push(isin);
        controller.abort();
      },
      history: async () => {
        assert.fail('history must not start after cancellation');
      },
    },
    controller.signal,
    () => {},
  );
  assert.deepEqual(calls, ['a']);
  assert.equal(result.cancelled, true);
});
