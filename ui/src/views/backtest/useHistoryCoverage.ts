import { useEffect, useState } from 'react';
import { instrumentClient } from '../../api';
import type { HistoryCoverage } from './historyCoverage';

export function useHistoryCoverage(isins: string[]) {
  const [coverage, setCoverage] = useState<Record<string, HistoryCoverage>>({});
  const [retry, setRetry] = useState(0);
  const key = [...new Set(isins)].sort().join(',');
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === 'visible') setRetry((value) => value + 1);
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setCoverage({});
    // Read the shared server cache again after returning from an ETF page/tab.
    // The API refreshes expired history; avoid a second indefinite browser cache.
    void (async () => {
      for (const isin of key.split(',').filter(Boolean)) {
        if (controller.signal.aborted) return;
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
        setCoverage((current) => ({ ...current, [isin]: next }));
      }
    })();
    return () => controller.abort();
  }, [key, retry]);
  return { coverage, retry: () => setRetry((value) => value + 1) };
}
