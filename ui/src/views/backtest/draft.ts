import type { Account, Holding } from '../../api';

export type AllocationRow = { isin: string; weight: number };
export type DraftPlan = { id: string; name: string; monthly: number; allocations: AllocationRow[] };

// Detached inputs only: running/editing this copy never writes account or holding records.
export function copyPAC(
  account: Pick<Account, 'id' | 'name' | 'currency' | 'pac_amount_minor'>,
  holdings: Pick<Holding, 'account_id' | 'instrument_isin' | 'pac_bps' | 'pac_frequency'>[],
) {
  const rows = holdings.filter((h) => h.account_id === account.id && (h.pac_bps ?? 0) > 0);
  if (account.currency !== 'EUR' || !account.pac_amount_minor || account.pac_amount_minor < 0)
    throw new Error('Choose an EUR PAC with a positive monthly budget.');
  if (
    !rows.length ||
    rows.some((h) => !h.instrument_isin || (h.pac_frequency && h.pac_frequency !== 'monthly'))
  )
    throw new Error('A backtest copy needs instruments with monthly PAC allocations.');
  return {
    id: String(account.id),
    name: account.name,
    monthly: account.pac_amount_minor / 100,
    allocations: rows.map((h) => ({ isin: h.instrument_isin!, weight: h.pac_bps! / 100 })),
  };
}

export function selectPACs(
  ids: string[],
  current: DraftPlan[],
  accounts: Pick<Account, 'id' | 'name' | 'currency' | 'pac_amount_minor'>[],
  holdings: Pick<Holding, 'account_id' | 'instrument_isin' | 'pac_bps' | 'pac_frequency'>[],
): DraftPlan[] {
  return ids.map((id) => {
    const existing = current.find((plan) => plan.id === id);
    if (existing) return existing;
    const account = accounts.find((a) => String(a.id) === id);
    if (!account) throw new Error('Selected PAC is unavailable.');
    return copyPAC(account, holdings);
  });
}

// Same funding split as the backtest engine, including lump-sum-only drafts.
export function portfolioShares(plans: DraftPlan[]): Map<string, number> {
  const total = plans.reduce((sum, plan) => sum + plan.monthly, 0);
  return new Map(plans.map((plan) => [plan.id, total > 0 ? plan.monthly / total : 1 / plans.length]));
}

export function pacWeight(portfolioWeight: number, share: number): number {
  return share > 0 ? Math.round(Math.min(100, Math.max(0, portfolioWeight / share)) * 100) / 100 : 0;
}
