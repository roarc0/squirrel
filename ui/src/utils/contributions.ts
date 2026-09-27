// Targets are portfolio weights; contribution shares are fractions of new cash.
export function suggestedPacShares(holdings: { id: number; value_minor: number; planned_bps: number }[], portfolioValue: number, contribution: number) {
  const deficits = holdings.map(h => ({ id: h.id, value: Math.max(0, (portfolioValue + contribution) * h.planned_bps / 10000 - h.value_minor) }));
  const total = deficits.reduce((sum, d) => sum + d.value, 0);
  const denominator = Math.max(total, contribution);
  const shares = deficits.map(d => ({ id: d.id, exact: denominator > 0 ? d.value / denominator * 10000 : 0, bps: 0 }));
  for (const share of shares) share.bps = Math.floor(share.exact);
  let remainder = Math.round(shares.reduce((sum, s) => sum + s.exact, 0)) - shares.reduce((sum, s) => sum + s.bps, 0);
  shares.sort((a, b) => (b.exact - b.bps) - (a.exact - a.bps) || a.id - b.id);
  for (const share of shares) { if (remainder-- > 0) share.bps++; }
  return new Map(shares.map(s => [s.id, s.bps]));
}
