/* Datos que pide una pantalla a la API y que se vuelven a pedir cuando llega un evento que los toca. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ApiEvent, SandboxApi } from '../api/types';
import { onEvent } from './store';

export interface ApiData<T> { data: T | undefined; error: string | null; loading: boolean; reload: () => void }

/**
 * const { data } = useApi(a => a.hdfsList(path), [path], e => e.type === 'hdfs');
 * `refreshOn` decide qué eventos SSE disparan otra pedida (se juntan en una cada 150 ms).
 */
export function useApi<T>(load: (a: SandboxApi) => Promise<T>, deps: unknown[], refreshOn?: (e: ApiEvent) => boolean): ApiData<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const filterRef = useRef(refreshOn);
  filterRef.current = refreshOn;
  const seq = useRef(0);

  const reload = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    loadRef.current(api()).then(
      v => { if (n === seq.current) { setData(v); setError(null); setLoading(false); } },
      e => { if (n === seq.current) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } },
    );
  }, []);

  useEffect(reload, deps);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onEvent(e => {
      if (!filterRef.current?.(e)) return;
      clearTimeout(t);
      t = setTimeout(reload, 150);
    });
    return () => { off(); clearTimeout(t); };
  }, [reload]);

  return { data, error, loading, reload };
}
