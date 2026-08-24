import { useEffect, useState } from 'react';

function readParam(key: string): string {
  return new URLSearchParams(window.location.search).get(key) ?? '';
}

function writeParam(key: string, value: string) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, '', url.toString());
}

export function useQueryParam(key: string, fallback = ''): [string, (v: string) => void] {
  const [value, setValue] = useState(() => readParam(key) || fallback);
  useEffect(() => { writeParam(key, value === fallback ? '' : value); }, [key, value, fallback]);
  return [value, setValue];
}

export function useQueryParamArray(key: string): [string[], (v: string[]) => void] {
  const [value, setValue] = useState<string[]>(() => {
    const raw = readParam(key);
    return raw ? raw.split(',').filter(Boolean) : [];
  });
  useEffect(() => { writeParam(key, value.join(',')); }, [key, value]);
  return [value, setValue];
}

export function useQueryParamObject<T extends Record<string, string>>(
  prefix: string,
  defaults: T,
): [T, (patch: Partial<T> | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const params = new URLSearchParams(window.location.search);
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const raw = params.get(`${prefix}.${String(key)}`);
      if (raw !== null) (result as Record<keyof T, string>)[key] = raw;
    }
    return result;
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const paramKey = `${prefix}.${String(key)}`;
      const v = value[key];
      if (v) url.searchParams.set(paramKey, v);
      else url.searchParams.delete(paramKey);
    }
    window.history.replaceState(null, '', url.toString());
  }, [prefix, value]); // eslint-disable-line react-hooks/exhaustive-deps

  return [value, setValue as (patch: Partial<T> | ((prev: T) => T)) => void];
}
