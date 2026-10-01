export async function refreshBacktestInstruments(
  isins: string[],
  actions: { profile: (isin: string) => Promise<unknown>; history: (isin: string) => Promise<unknown> },
  signal: AbortSignal,
  progress: (isin: string, stage: string, completed: number, total: number) => void,
) {
  const unique = [...new Set(isins)];
  const failures: string[] = [];
  let completed = 0;
  for (const isin of unique) {
    let succeeded = true;
    for (const stage of ['profile', 'history'] as const) {
      if (signal.aborted) return { completed, failures, cancelled: true, total: unique.length };
      progress(isin, stage, completed, unique.length);
      try {
        await actions[stage](isin);
      } catch (cause) {
        if (signal.aborted) return { completed, failures, cancelled: true, total: unique.length };
        succeeded = false;
        failures.push(`${isin} · ${stage}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    if (succeeded) completed++;
  }
  return { completed, failures, cancelled: signal.aborted, total: unique.length };
}
