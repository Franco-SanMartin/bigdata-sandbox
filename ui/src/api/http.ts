/* Cliente del backend real del contenedor (puerto 8080). Rutas documentadas en types.ts. */
import type { ApiEvent, ClusterConfig, SandboxApi } from './types';

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function req<T>(method: string, path: string, body?: unknown, as: 'json' | 'text' = 'json'): Promise<T> {
  const r = await fetch(`./api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
    throw new HttpError(r.status, msg);
  }
  if (r.status === 202 || r.status === 204) return undefined as T;
  return (as === 'text' ? r.text() : r.json()) as Promise<T>;
}

export function createHttpApi(): SandboxApi {
  let offset = 0; // diferencia entre el reloj del cluster y el del navegador
  const cfg = (config: ClusterConfig) => ({ config });
  return {
    mode: 'live',
    now: () => Date.now() + offset,
    status: async () => { const s = await req<Awaited<ReturnType<SandboxApi['status']>>>('GET', '/status'); offset = s.now - Date.now(); return s; },
    activity: () => req('GET', '/activity?limit=200'),
    subscribe(fn: (e: ApiEvent) => void) {
      const es = new EventSource('./api/events');
      ['status', 'activity', 'transfer', 'yarn'].forEach(t => es.addEventListener(t, ev => fn({ type: t, ...JSON.parse((ev as MessageEvent).data || '{}') } as ApiEvent)));
      return () => es.close();
    },
    validate: c => req('POST', '/config/validate', cfg(c)),
    estimate: c => req('POST', '/config/estimate', cfg(c)),
    compose: c => req('POST', '/config/compose', cfg(c), 'text'),
    saveConfig: c => req('PUT', '/config', cfg(c)),
    start: c => req('POST', '/cluster/start', cfg(c)),
    stop: () => req('POST', '/cluster/stop'),
    apply: c => req('POST', '/cluster/apply', cfg(c)),
    resetVolume: () => req('POST', '/cluster/reset'),
    processAction: (id, a) => req('POST', `/processes/${encodeURIComponent(id)}/${a}`),
    dataNodes: () => req('GET', '/hdfs/datanodes'),
    files: () => req('GET', '/hdfs/files?recursive=1'),
    putExample: example => req('POST', '/hdfs/put', { example }),
    setReplication: (path, replication) => req('PATCH', '/hdfs/files', { path, replication }),
    addDataNode: () => req('POST', '/hdfs/datanodes'),
    apps: () => req('GET', '/yarn/apps'),
    submitExample: async example => (await req<{ id: string }>('POST', '/yarn/apps', { example })).id,
    killApp: id => req('POST', `/yarn/apps/${encodeURIComponent(id)}/kill`),
  };
}

/** Hay backend si /api/status contesta JSON en menos de 1,5 s */
export async function backendAvailable(): Promise<boolean> {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch('./api/status', { signal: ctl.signal }); clearTimeout(t);
    return r.ok && (r.headers.get('content-type') || '').includes('json');
  } catch { return false; }
}
