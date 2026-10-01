import assert from 'node:assert/strict';
import test from 'node:test';
import { copyPAC, selectPACs, portfolioShares, pacWeight } from './draft.ts';

test('backtest copies preserve budget, weights and cash without mutating a saved PAC', () => {
  const account = Object.freeze({ id: 1, name: 'My PAC', currency: 'EUR', pac_amount_minor: 200000 });
  const holdings = [
    Object.freeze({ account_id: 1, instrument_isin: 'WORLD', pac_bps: 6000, pac_frequency: 'monthly' }),
    Object.freeze({ account_id: 1, instrument_isin: 'BOND', pac_bps: 2000 }),
    Object.freeze({ account_id: 1, instrument_isin: 'NOT_PAC', pac_bps: 0 }),
    Object.freeze({ account_id: 2, instrument_isin: 'OTHER_ACCOUNT', pac_bps: 10000 }),
  ];
  const draft = copyPAC(account, holdings);
  assert.equal(draft.monthly, 2000);
  assert.deepEqual(draft.allocations, [
    { isin: 'WORLD', weight: 60 },
    { isin: 'BOND', weight: 20 },
  ]);
  draft.allocations[0].isin = 'OLDER_WORLD';
  draft.allocations[0].weight = 50;
  draft.monthly = 100;
  assert.equal(holdings[0].instrument_isin, 'WORLD');
  assert.equal(holdings[0].pac_bps, 6000);
  assert.equal(account.pac_amount_minor, 200000);
  assert.throws(() => copyPAC(account, [{ ...holdings[0], pac_frequency: 'quarterly' }]), /monthly/);
});

test('selecting PACs keeps existing edits and budgets separate, including shared instruments', () => {
  const accounts = [
    { id: 1, name: 'First', currency: 'EUR', pac_amount_minor: 10000 },
    { id: 2, name: 'Second', currency: 'EUR', pac_amount_minor: 30000 },
  ];
  const holdings = [
    { account_id: 1, instrument_isin: 'WORLD', pac_bps: 6000 },
    { account_id: 2, instrument_isin: 'WORLD', pac_bps: 9000 },
  ];
  const first = selectPACs(['1'], [], accounts, holdings);
  first[0].allocations[0].isin = 'REPLACEMENT';
  first[0].monthly = 150;
  const combined = selectPACs(['1', '2'], first, accounts, holdings);
  assert.equal(combined[0], first[0]);
  assert.equal(combined[0].monthly, 150);
  assert.deepEqual(combined[1].allocations, [{ isin: 'WORLD', weight: 90 }]);
  assert.equal(combined[1].monthly, 300);
  assert.deepEqual(selectPACs(['2'], combined, accounts, holdings), [combined[1]]);
  assert.equal(holdings[0].instrument_isin, 'WORLD');
});

test('combined weights scale with PAC budgets and edits convert back to PAC weights', () => {
  const plans = [
    { id: 'trade', name: 'trade', monthly: 2000, allocations: [{ isin: 'WORLD', weight: 60 }, { isin: 'BONDS', weight: 40 }] },
    { id: 'scalable', name: 'scalable', monthly: 1000, allocations: [{ isin: 'WORLD', weight: 60 }, { isin: 'GOLD', weight: 40 }] },
  ];
  const shares = portfolioShares(plans);
  assert.equal(60 * shares.get('trade')!, 40);
  assert.equal(60 * shares.get('scalable')!, 20);
  assert.ok(Math.abs(plans.reduce((sum, plan) => sum + plan.allocations.reduce((n, row) => n + row.weight * shares.get(plan.id)!, 0), 0) - 100) < 1e-10);
  assert.equal(pacWeight(30, shares.get('trade')!), 45);
  assert.equal(pacWeight(50, shares.get('scalable')!), 100);
  assert.equal(pacWeight(5, 0), 0);
  assert.equal(portfolioShares([plans[0]]).get('trade'), 1);
  assert.equal(portfolioShares([{ ...plans[0], monthly: 0 }, plans[1]]).get('trade'), 0);
  const lumpSum = portfolioShares(plans.map((plan) => ({ ...plan, monthly: 0 })));
  assert.equal(lumpSum.get('trade'), 0.5);
  assert.equal(lumpSum.get('scalable'), 0.5);
  // Unallocated weight stays cash, rather than inflating instrument weights.
  plans[0].allocations[1].weight = 10;
  assert.ok(Math.abs(plans.reduce((sum, plan) => sum + plan.allocations.reduce((n, row) => n + row.weight * shares.get(plan.id)!, 0), 0) - 80) < 1e-10);
  plans[0].monthly = 1000;
  assert.equal(portfolioShares(plans).get('trade'), 0.5);
});
