import assert from 'node:assert/strict';
import test from 'node:test';
import { availablePacBps, availablePacPercent } from './pac.ts';
import type { Holding } from '../api';

test('available PAC percentage calculates unallocated budget correctly', () => {
  const dummyHoldings: Holding[] = [
    {
      id: 1,
      account_id: 10,
      instrument_id: 101,
      invested_minor: 1000,
      value_minor: 1200,
      tax_bps: 2600,
      actual_bps: 5000,
      ter_bps: 20,
      is_pac: true,
      pac_bps: 6000, // 60%
    },
    {
      id: 2,
      account_id: 10,
      instrument_id: 102,
      invested_minor: 500,
      value_minor: 600,
      tax_bps: 2600,
      actual_bps: 2500,
      ter_bps: 15,
      is_pac: true,
      pac_bps: 1500, // 15%
    },
    {
      id: 3,
      account_id: 20, // different account
      instrument_id: 103,
      invested_minor: 200,
      value_minor: 250,
      tax_bps: 2600,
      actual_bps: 1000,
      ter_bps: 10,
      is_pac: true,
      pac_bps: 5000,
    },
  ];

  // For account 10, 60% + 15% = 75% used, 25% left
  assert.equal(availablePacBps(10, dummyHoldings), 2500);
  assert.equal(availablePacPercent(10, dummyHoldings), 25);

  // When editing holding 1 in account 10, holding 1's 60% is excluded, so 15% used, 85% available
  assert.equal(availablePacBps(10, dummyHoldings, 1), 8500);
  assert.equal(availablePacPercent(10, dummyHoldings, 1), 85);

  // For account 20, 50% used, 50% left
  assert.equal(availablePacPercent(20, dummyHoldings), 50);

  // For an empty account with no holdings, 100% available
  assert.equal(availablePacPercent(99, dummyHoldings), 100);
});

test('available PAC percentage clamps at 0 if over-allocated', () => {
  const overAllocated: Holding[] = [
    {
      id: 1,
      account_id: 1,
      instrument_id: 101,
      invested_minor: 0,
      value_minor: 0,
      tax_bps: 2600,
      actual_bps: 0,
      ter_bps: 20,
      is_pac: true,
      pac_bps: 11000,
    },
  ];
  assert.equal(availablePacBps(1, overAllocated), 0);
  assert.equal(availablePacPercent(1, overAllocated), 0);
});
