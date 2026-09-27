import { useEffect, useState } from 'react';
import { watchContinuousRefresh, setContinuousRefresh, type RefreshTickData } from '../api';

const STORAGE_KEY = 'squirrel.continuousRefresh';

export function useContinuousRefresh() {
  const [tick, setTick] = useState<RefreshTickData | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    (async () => {
      while (!abortController.signal.aborted) {
        try {
          if (localStorage.getItem(STORAGE_KEY) === 'true') {
            await setContinuousRefresh(true);
          }
          for await (const incoming of watchContinuousRefresh({ signal: abortController.signal })) {
            setTick(prev => ({
              ...incoming,
              ticker: incoming.ticker || prev?.ticker || '',
              isin: incoming.isin || prev?.isin || '',
            }));
          }
        } catch {
          // Reconnect after backend restarts; the browser preference resumes the worker.
        }
        if (!abortController.signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
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
