import { useEffect, useRef, useState } from 'react';
import { instrumentClient } from '../../api';
import type { HistoryCoverage } from './historyCoverage';

export function useHistoryCoverage(isins: string[]) {
  const cache = useRef<Record<string, HistoryCoverage>>({});
  const [coverage, setCoverage] = useState(cache.current);
  const [retry, setRetry] = useState(0);
  const key = [...new Set(isins)].sort().join(',');
  useEffect(() => {
    const controller = new AbortController();
    // Reuse the same cached-history API as the backtest; fetch absent histories
    // sequentially to respect the provider's existing request pacing.
    void (async () => {
      for (const isin of key.split(',').filter(Boolean)) {
        if (controller.signal.aborted) return;
        if (cache.current[isin] && !cache.current[isin].error) continue;
        let next: HistoryCoverage;
        try {
          const history = await instrumentClient.getInstrumentPerformance(
            { isin },
            { signal: controller.signal },
          );
          const start = history.series[0]?.date;
          const end = history.series.at(-1)?.date;
          next =
            start && end && history.series.length >= 2
              ? { start, end }
              : { error: 'Not enough price history' };
        } catch (cause) {
          next = { error: cause instanceof Error ? cause.message : 'History unavailable' };
        }
        if (controller.signal.aborted) return;
        cache.current = { ...cache.current, [isin]: next };
        setCoverage(cache.current);
      }
    })();
    return () => controller.abort();
  }, [key, retry]);
  return { coverage, retry: () => setRetry((value) => value + 1) };
}
