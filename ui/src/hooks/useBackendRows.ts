import { useEffect, useState } from 'react';
import type { SortDirection } from '../components/DataTable';

export function useBackendRows<T>(
  fetcher: (sortParam: string) => Promise<T[]>,
  source: T[],
  initialSort = '',
  initialDirection: SortDirection = 'asc'
) {
  const [rows, setRows] = useState(source);
  const [sort, setSort] = useState(initialSort);
  const [direction, setDirection] = useState<SortDirection>(initialDirection);
  const [sortError, setSortError] = useState('');
  useEffect(() => { setRows(source); setSort(initialSort); setDirection(initialDirection); }, [source, initialSort, initialDirection]);
  const sortRows = async (key: string, next: SortDirection) => {
    try {
      const sortParam = `${key}:${next}`;
      setRows(await fetcher(sortParam) ?? []);
      setSort(key); setDirection(next); setSortError('');
    } catch (cause) { setSortError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return { rows, setRows, sort, direction, sortError, sortRows };
}
