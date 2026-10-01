import assert from 'node:assert/strict';
import test from 'node:test';
import { copyPAC } from './draft.ts';

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
