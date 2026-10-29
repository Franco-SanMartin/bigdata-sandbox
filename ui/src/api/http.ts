/* Cliente del backend real del contenedor (puerto 8080). Rutas documentadas en types.ts. */
import type { ApiErrorCode, ApiEvent, ClusterConfig, DataSource, SandboxApi } from './types';
import { ApiFailure } from './errors';

async function req<T>(method: string, path: string, body?: unknown, as: 'json' | 'text' = 'json'): Promise<T> {
  const form = body instanceof FormData;
  const r = await fetch(`./api${path}`, {
    method,
    headers: body && !form ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`; let code: ApiErrorCode | undefined;
    try { const j = await r.json(); if (j?.error) msg = j.error; code = j?.code; } catch { /* sin cuerpo */ }
    throw new ApiFailure(msg, code, r.status);
  }
  if (r.status === 204 || (r.status === 202 && !(r.headers.get('content-type') || '').includes('json'))) return undefined as T;
  return (as === 'text' ? r.text() : r.json()) as Promise<T>;
}

export function createHttpApi(): SandboxApi {
  let offset = 0; // diferencia entre el reloj del cluster y el del navegador
  const cfg = (config: ClusterConfig) => ({ config });
  const q = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => e[1] !== undefined)).toString();
  const src = (source: DataSource, text: string) => ({ source, text });
  return {
    mode: 'live',
    now: () => Date.now() + offset,
    status: async () => { const s = await req<Awaited<ReturnType<SandboxApi['status']>>>('GET', '/status'); offset = s.now - Date.now(); return s; },
    activity: () => req('GET', '/activity?limit=200'),
    subscribe(fn: (e: ApiEvent) => void) {
      const es = new EventSource('./api/events');
      ['status', 'activity', 'transfer', 'yarn', 'hdfs', 'step', 'model', 'mlrun'].forEach(t => es.addEventListener(t, ev => fn({ type: t, ...JSON.parse((ev as MessageEvent).data || '{}') } as ApiEvent)));
      // De action solo interesa cuándo empieza y termina, no cada línea de salida
      es.addEventListener('action', ev => { const d = JSON.parse((ev as MessageEvent).data || '{}'); if (d.state) fn({ type: 'action', id: d.id, state: d.state, exitCode: d.exitCode }); });
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
    action: id => req('GET', `/actions/${encodeURIComponent(id)}`),
    dataNodes: () => req('GET', '/hdfs/datanodes'),
    files: () => req('GET', '/hdfs/files?recursive=1'),
    putExample: example => req('POST', '/hdfs/put', { example }),
    setReplication: (path, replication) => req('PATCH', '/hdfs/files', { path, replication }),
    addDataNode: () => req('POST', '/hdfs/datanodes'),
    hdfsList: path => req('GET', `/hdfs/ls?${q({ path })}`),
    hdfsFile: path => req('GET', `/hdfs/file?${q({ path })}`),
    hdfsUpload: ({ file, ...rest }) => {
      if (!file) return req('POST', '/hdfs/upload', rest);
      const f = new FormData();
      Object.entries(rest).forEach(([k, v]) => { if (v !== undefined) f.append(k, String(v)); });
      f.append('file', file);
      return req('POST', '/hdfs/upload', f);
    },
    hdfsMkdir: path => req('POST', '/hdfs/mkdir', { path }),
    hdfsDelete: (path, recursive) => req('DELETE', `/hdfs/files?${q({ path, recursive: recursive ? '1' : '0' })}`),
    fsck: path => req('GET', `/hdfs/fsck?${q({ path })}`),
    replication: () => req('GET', '/hdfs/replication'),
    hdfsCat: (path, offset, length) => req('GET', `/hdfs/cat?${q({ path, offset: offset?.toString(), length: length?.toString() })}`),
    hdfsDownload: async path => ({ url: `./api/hdfs/download?${q({ path })}`, name: path.split('/').pop() || 'archivo' }),
    hdfsMove: (from, to) => req('POST', '/hdfs/move', { from, to }),
    apps: () => req('GET', '/yarn/apps'),
    submitExample: async example => (await req<{ id: string }>('POST', '/yarn/apps', { example })).id,
    killApp: id => req('POST', `/yarn/apps/${encodeURIComponent(id)}/kill`),
    jobTemplates: () => req('GET', '/yarn/templates'),
    submitJob: async r => (await req<{ id: string }>('POST', '/yarn/apps', r)).id,
    yarnCluster: () => req('GET', '/yarn/cluster'),
    app: id => req('GET', `/yarn/apps/${encodeURIComponent(id)}`),
    appLogs: (id, container) => req('GET', `/yarn/apps/${encodeURIComponent(id)}/logs?${q({ container })}`),
    pipelineCatalog: () => req('GET', '/pipeline/catalog'),
    pipelineState: () => req('GET', '/pipeline'),
    runStep: async r => (await req<{ id: string }>('POST', '/pipeline/steps', r)).id,
    steps: () => req('GET', '/pipeline/steps'),
    pipelineReset: () => req('POST', '/pipeline/reset'),
    catalog: () => req('GET', '/data/catalog'),
    schema: (source, name) => req('GET', `/data/schema?${q({ source, name })}`),
    query: (source, text) => req('POST', '/data/query', src(source, text)),
    explain: (source, text) => req('POST', '/data/explain', src(source, text)),
    queryExamples: () => req('GET', '/data/examples'),
    mlDatasets: () => req('GET', '/ml/datasets'),
    recommend: (dataset, task) => req('POST', '/ml/recommend', { dataset, task }),
    train: async r => (await req<{ id: string }>('POST', '/ml/train', r)).id,
    models: () => req('GET', '/ml/models'),
    modelViz: id => req('GET', `/ml/models/${encodeURIComponent(id)}/viz`),
    mlCatalog: () => req('GET', '/ml/catalog'),
    mlSources: () => req('GET', '/ml/sources'),
    mlExample: ejemplo => req('POST', '/ml/sources/example', { ejemplo }),
    mlProfile: (datos, objetivo) => req('POST', '/ml/profile', { datos, objetivo: objetivo ?? null }),
    mlCheck: receta => req('POST', '/ml/check', { receta }),
    mlCode: receta => req('POST', '/ml/code', { receta }),
    mlTrain: receta => req('POST', '/ml/experiments', { receta }),
    mlRunCode: r => req('POST', '/ml/runs', r),
    mlRuns: () => req('GET', '/ml/runs'),
    mlRun: (id, desde) => req('GET', `/ml/runs/${encodeURIComponent(id)}?${q({ desde: desde?.toString() })}`),
    mlCancel: id => req('POST', `/ml/runs/${encodeURIComponent(id)}/cancel`),
    mlExperiments: () => req('GET', '/ml/experiments'),
    mlExperiment: id => req('GET', `/ml/experiments/${encodeURIComponent(id)}`),
    mlDeleteExperiment: id => req('DELETE', `/ml/experiments/${encodeURIComponent(id)}`),
    mlDownload: async (id, formato) => ({
      url: `./api/ml/experiments/${encodeURIComponent(id)}/download?${q({ formato })}`,
      name: `${id}.${formato === 'modelo' ? 'joblib' : formato}`,
    }),
    mlToJupyter: id => req('POST', `/ml/experiments/${encodeURIComponent(id)}/jupyter`),
    mlPredict: (id, r) => req('POST', `/ml/experiments/${encodeURIComponent(id)}/predict`, r),
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
