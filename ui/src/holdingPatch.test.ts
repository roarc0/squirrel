import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestedPacShares } from './utils/contributions.ts';
import { holdingPatch } from './utils/holdingPatch.ts';

test('target and recurring contribution edits preserve each other and other holding data', () => {
  const holding = { plannedBps: 6000n, pacBps: 3000n, valueMinor: 90000n, accountId: 1n, notes: 'Core' };
  const target = { ...holding, ...holdingPatch({ planned_bps: 4000 }) };
  assert.equal(target.plannedBps, 4000n);
  assert.equal(target.pacBps, 3000n);
  const stopped = { ...target, ...holdingPatch({ pac_bps: 0 }) };
  assert.equal(stopped.plannedBps, 4000n);
  assert.equal(stopped.pacBps, 0n);
  assert.equal(stopped.valueMinor, holding.valueMinor);
  assert.equal(stopped.notes, holding.notes);
  assert.deepEqual(holdingPatch({ value_minor: 0, notes: '', is_pac: false }), { valueMinor: 0n, notes: '', isPac: false });
});

test('PAC preview uses portfolio deficits and never allocates more than the contribution', () => {
  const shares = suggestedPacShares([{ id: 1, value_minor: 60000, planned_bps: 5000 }, { id: 2, value_minor: 40000, planned_bps: 5000 }], 100000, 10000);
  assert.equal(shares.get(1), 0);
  assert.equal(shares.get(2), 10000);
  const partial = suggestedPacShares([{ id: 1, value_minor: 0, planned_bps: 1000 }], 0, 10000);
  assert.equal(partial.get(1), 1000);
  const thirds = suggestedPacShares([1, 2, 3].map(id => ({ id, value_minor: 0, planned_bps: 4000 })), 100000, 10000);
  assert.equal([...thirds.values()].reduce((a, b) => a + b, 0), 10000);
});
