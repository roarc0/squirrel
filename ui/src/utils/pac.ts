import type { Holding } from '../api';

/**
 * Calculates the unallocated PAC share in basis points (0-10000) for a given account.
 * If currentHoldingId is provided, that holding's current allocation is excluded so
 * that editing a holding allows reallocating up to its current share plus any leftover unallocated budget.
 */
export function availablePacBps(
  accountId: number,
  holdings: Holding[],
  currentHoldingId?: number
): number {
  const accountHoldings = holdings.filter(
    h => h.account_id === accountId && (!currentHoldingId || h.id !== currentHoldingId)
  );
  const usedBps = accountHoldings.reduce((sum, h) => sum + (h.pac_bps ?? 0), 0);
  return Math.max(0, 10000 - usedBps);
}

/**
 * Calculates the unallocated PAC share as a percentage (0-100) for a given account.
 */
export function availablePacPercent(
  accountId: number,
  holdings: Holding[],
  currentHoldingId?: number
): number {
  return availablePacBps(accountId, holdings, currentHoldingId) / 100;
}
