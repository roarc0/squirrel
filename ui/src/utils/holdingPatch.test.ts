import assert from 'node:assert/strict';
import test from 'node:test';
import { holdingPatch } from './holdingPatch.ts';

test('PAC and other holding fields are patched independently', () => {
  const holding = { pacBps: 3000n, valueMinor: 90000n, accountId: 1n, notes: 'Core' };
  const stopped = { ...holding, ...holdingPatch({ pac_bps: 0 }) };
  assert.equal(stopped.pacBps, 0n);
  assert.equal(stopped.valueMinor, holding.valueMinor);
  assert.equal(stopped.notes, holding.notes);
  assert.deepEqual(holdingPatch({ value_minor: 0, notes: '', is_pac: false }), { valueMinor: 0n, notes: '', isPac: false });
});
