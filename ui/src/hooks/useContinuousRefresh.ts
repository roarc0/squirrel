import { useEffect, useState } from 'react';
import { watchContinuousRefresh, setContinuousRefresh, type RefreshTickData } from '../api';

const STORAGE_KEY = 'squirrel.continuousRefresh';

export function useContinuousRefresh() {
  const [tick, setTick] = useState<RefreshTickData | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    if (localStorage.getItem(STORAGE_KEY) === 'true') {
      setContinuousRefresh(true).catch(() => {});
    }

    (async () => {
      try {
        for await (const incoming of watchContinuousRefresh({ signal: abortController.signal })) {
          setTick(prev => ({
            ...incoming,
            ticker: incoming.ticker || prev?.ticker || '',
            isin: incoming.isin || prev?.isin || '',
            refreshedToday: incoming.refreshedToday || prev?.refreshedToday || 0,
            hasError: incoming.hasError,
          }));
        }
      } catch {
        // stream closed or aborted
      }
    })();

    return () => abortController.abort();
  }, []);

  const toggle = async () => {
    const newEnabled = !(tick?.enabled ?? false);
    localStorage.setItem(STORAGE_KEY, String(newEnabled));
    await setContinuousRefresh(newEnabled);
  };

  return { tick, toggle };
}
