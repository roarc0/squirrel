import type { Account, Holding } from '../../api';

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
    source: account.name,
    monthly: account.pac_amount_minor / 100,
    allocations: rows.map((h) => ({ isin: h.instrument_isin!, weight: h.pac_bps! / 100 })),
  };
}
