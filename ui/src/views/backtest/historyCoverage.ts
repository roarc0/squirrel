export type HistoryCoverage =
  { start: string; end: string; error?: never } | { error: string; start?: never; end?: never };

// Preview only. The Go engine validates every daily observation when the test runs.
export function sharedHistory(isins: string[], coverage: Record<string, HistoryCoverage>) {
  if (!isins.length || isins.some((isin) => !coverage[isin]?.start || !coverage[isin]?.end)) return undefined;
  const start = isins
    .map((isin) => coverage[isin].start!)
    .sort()
    .at(-1)!;
  const end = isins.map((isin) => coverage[isin].end!).sort()[0];
  return {
    start,
    end,
    years: (Date.parse(end) - Date.parse(start)) / (86400000 * 365.25),
    startLimiters: isins.filter((isin) => coverage[isin].start === start),
    endLimiters: isins.filter((isin) => coverage[isin].end === end),
    differentEnds: isins.some((isin) => coverage[isin].end !== end),
  };
}
