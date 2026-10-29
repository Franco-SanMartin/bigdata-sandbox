/* Piezas que comparten HDFS y YARN: pedir datos sin perder el código del error, y los estados de la pantalla. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2, Power, RotateCw } from 'lucide-react';
import { api } from '../../api';
import { errorCode } from '../../api/errors';
import type { ApiErrorCode, ApiEvent, ClusterStatus, SandboxApi } from '../../api/types';
import { Empty } from '../../components/ui';
import { onEvent } from '../../state/store';
import { navigate } from '../../state/ui';

export interface Res<T> { data: T | undefined; err: { message: string; code?: ApiErrorCode } | null; loading: boolean; reload: () => void }

/**
 * Como useApi, pero guarda el código del error (cluster_stopped, service_down…) y puede
 * volver a pedir cada `everyMs` (para lo que cambia sin evento propio, como la cola de re-replicación).
 * `load` devuelve null cuando no hay nada que pedir.
 */
export function useRes<T>(load: (a: SandboxApi) => Promise<T> | null, deps: unknown[], refreshOn?: (e: ApiEvent) => boolean, everyMs?: number): Res<T> {
  const [data, setData] = useState<T>();
  const [err, setErr] = useState<Res<T>['err']>(null);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(load); loadRef.current = load;
  const filterRef = useRef(refreshOn); filterRef.current = refreshOn;
  const seq = useRef(0);

  const reload = useCallback(() => {
    const n = ++seq.current;
    const p = loadRef.current(api());
    if (!p) { setData(undefined); setErr(null); setLoading(false); return; }
    setLoading(true);
    p.then(
      v => { if (n === seq.current) { setData(v); setErr(null); setLoading(false); } },
      e => { if (n === seq.current) { setErr({ message: e instanceof Error ? e.message : String(e), code: errorCode(e) }); setLoading(false); } },
    );
  }, []);

  // Al cambiar lo que se pide, lo viejo no sirve: se limpia para no mostrar otra carpeta u otro trabajo
  useEffect(() => { setData(undefined); setErr(null); reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onEvent(e => { if (!filterRef.current?.(e)) return; clearTimeout(t); t = setTimeout(reload, 150); });
    const iv = everyMs ? setInterval(reload, everyMs) : undefined;
    return () => { off(); clearTimeout(t); if (iv) clearInterval(iv); };
  }, [reload, everyMs]);

  return { data, err, loading, reload };
}

const CODE_HINT: Record<ApiErrorCode, string> = {
  cluster_stopped: 'el cluster no está en marcha',
  service_down: 'el servicio que hace falta está apagado',
  not_found: 'no existe',
  forbidden: 'el pedido no vino de la propia interfaz',
  invalid: 'pedido inválido',
  busy: 'hay algo corriendo que lo impide',
  unsupported: 'no está en esta imagen',
  failed: 'el comando falló',
};

/** Error de la API con su código, en una línea, y para reintentar */
export function ErrorLine({ err, onRetry }: { err: { message: string; code?: ApiErrorCode }; onRetry?: () => void }) {
  return (
    <div className="callout" data-k="bad" role="alert">
      <AlertTriangle size={14} />
      <span style={{ flex: 1 }}><b>{err.message}</b>{err.code && <> <span className="mono ops-code">{err.code}</span> <span className="muted">· {CODE_HINT[err.code]}</span></>}</span>
      {onRetry && <button className="btn btn-sm btn-ghost" type="button" onClick={onRetry}><RotateCw size={13} />Reintentar</button>}
    </div>
  );
}

export const Loading = ({ label = 'Cargando' }: { label?: string }) => <span className="muted ops-loading"><Loader2 size={13} className="spin" />{label}…</span>;

/** Lo que se ve mientras el cluster no está en marcha (apagado, arrancando o apagándose) */
export function ClusterGate({ status, icon, what, children }: { status: ClusterStatus | null; icon: ReactNode; what: string; children: ReactNode }) {
  if (!status) return <section className="panel"><div className="panel-b"><Loading label="Conectando con el cluster" /></div></section>;
  if (status.phase === 'running') return <>{children}</>;
  const busy = status.phase === 'starting' || status.phase === 'stopping';
  return (
    <section className="panel">
      <Empty icon={busy ? <Loader2 size={20} className="spin" /> : icon} title={busy ? (status.phase === 'starting' ? 'El cluster está arrancando' : 'El cluster se está apagando') : 'El cluster está apagado'}
        action={!busy ? <button className="btn" type="button" onClick={() => navigate('cluster')}><Power size={14} />Ir a Cluster</button> : undefined}>
        {busy ? `${what} aparece cuando termine.` : `Prendelo para ver ${what.toLowerCase()}.`}
      </Empty>
    </section>
  );
}

/** Una celda de la franja de números de arriba (mismo formato que en Cluster) */
export function Stat({ label, value, sub, k }: { label: string; value: ReactNode; sub: string; k?: 'bad' | 'run' }) {
  return <div className="stat" data-k={k}><span className="stat-l">{label}</span><span className="stat-v">{value}</span><span className="stat-s">{sub}</span></div>;
}
