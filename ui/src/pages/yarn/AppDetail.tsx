/* Detalle de un trabajo de YARN: DAG con sus tareas, contadores, resumen y logs por contenedor. */
import { useMemo, useState } from 'react';
import { ArrowRight, Search, Square, X } from 'lucide-react';
import type { AppLogs, DagEdge, DagVertex, YarnAppDetail, YarnStage } from '../../api/types';
import { EngineTag } from '../../components/Trace';
import { CodeBlock, Dot, Seg, Tip } from '../../components/ui';
import { clock, duration, mbLabel, nf } from '../../lib/format';
import { ErrorLine, Loading, type Res } from '../hdfs/common';
import { shortId } from './Containers';

export const APP_STATE: Record<YarnAppDetail['state'], string> = { ACCEPTED: 'run', RUNNING: 'run', FINISHED: 'ok', FAILED: 'bad', KILLED: 'bad' };
const TASK_STATE = { pending: 'en cola', running: 'corriendo', done: 'terminada', failed: 'falló' } as const;

/** Columnas del DAG por profundidad: un vértice va una columna después de todo lo que lo alimenta */
function layers(vs: DagVertex[], es: DagEdge[]): DagVertex[][] {
  const depth = new Map<string, number>();
  const d = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const ins = es.filter(e => e.to === id && vs.some(v => v.id === e.from));
    const v = ins.length ? 1 + Math.max(...ins.map(e => d(e.from, seen))) : 0;
    depth.set(id, v); return v;
  };
  vs.forEach(v => d(v.id, new Set()));
  const out: DagVertex[][] = [];
  vs.forEach(v => { const k = depth.get(v.id) ?? 0; (out[k] ||= []).push(v); });
  return out.filter(Boolean);
}

function Dag({ app, now }: { app: YarnAppDetail; now: number }) {
  const stage = (id: string): YarnStage | undefined => app.stages.find(s => s.id === id);
  if (!app.dag.vertices.length) return <p className="muted">Todavía no hay etapas: el trabajo espera su ApplicationMaster.</p>;
  // Spark History da las etapas sin decir de cuál depende cada una: van en fila, en el orden en que arrancaron, sin flechas
  const flat = !app.dag.edges.length && app.dag.vertices.length > 1;
  const cols = flat
    ? [[...app.dag.vertices].sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity))]
    : layers(app.dag.vertices, app.dag.edges);
  return (
    <>
    {flat && <p className="muted dag-note">Etapas en el orden en que arrancaron: {app.type === 'SPARK' ? 'Spark History' : 'el motor'} no informa de qué etapa depende cada una.</p>}
    <div className={flat ? 'dag dag-flat' : 'dag'} role="list" aria-label="DAG">
      {cols.map((col, i) => {
        const into = i ? app.dag.edges.find(e => col.some(v => v.id === e.to)) : undefined;
        return (
          <div key={i} className="dag-step">
            {into && <div className="dag-edge" aria-hidden="true" title={into.kind}><ArrowRight size={14} /><span className="mono">{into.kind.replace('_', ' ')}</span></div>}
            <div className="dag-col">
              {col.map(v => {
                const tasks = stage(v.id)?.tasks ?? [];
                return (
                  <div key={v.id} className="dag-v" data-s={v.state} role="listitem">
                    <div className="dag-v-h"><Dot s={v.state} label={v.state} /><b>{v.name}</b><span className="muted num">{v.tasksDone}/{v.tasks}</span></div>
                    {tasks.length > 0 && (
                      <div className="dag-tasks">
                        {tasks.map(t => (
                          <Tip key={t.id} content={<>{t.id} · {TASK_STATE[t.state]}{t.block && <><br /><span className="mono">lee {t.block}</span>{t.dataNode != null && ` del DataNode ${t.dataNode}`}</>}</>}>
                            <i data-s={t.state} aria-label={`${t.id} ${TASK_STATE[t.state]}`} />
                          </Tip>
                        ))}
                      </div>
                    )}
                    <div className="dag-ops mono">{v.operators.join(' → ')}</div>
                    <div className="dag-meta muted">
                      {v.recordsIn != null && <span>entran {nf(v.recordsIn)}</span>}
                      {v.recordsOut != null && <span>salen {nf(v.recordsOut)}</span>}
                      {v.bytesReadMb != null && <span>lee {mbLabel(v.bytesReadMb)}</span>}
                      {v.bytesWrittenMb != null && <span>escribe {mbLabel(v.bytesWrittenMb)}</span>}
                      {v.startedAt && <span>{duration((Math.max(0, (v.finishedAt ?? app.finishedAt ?? now) - v.startedAt)) / 1000)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
    </>
  );
}

function Logs({ logs, onContainer }: { logs: Res<AppLogs>; onContainer: (id: string) => void }) {
  const l = logs.data;
  const [file, setFile] = useState<'stdout' | 'stderr' | 'syslog' | null>(null);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all');
  const cur = l ? (file && l.files.find(f => f.name === file)) || l.files.find(f => f.lines.length) || l.files[0] : undefined;
  const lines = useMemo(() => {
    if (!cur) return [];
    const ql = q.trim().toLowerCase();
    return cur.lines.map((text, i) => ({ n: i + 1, text })).filter(x =>
      (level === 'all' || (level === 'warn' ? / (WARN|ERROR) /.test(x.text) : / ERROR /.test(x.text))) && (!ql || x.text.toLowerCase().includes(ql)));
  }, [cur, q, level]);
  return (
    <div className="lg">
      <div className="lg-side">
        <div className="ops-sub-h"><h3>Contenedores</h3><span className="muted">{l?.containers.length ?? ''}</span></div>
        <ul>
          {l?.containers.map(c => (
            <li key={c.id}><button type="button" aria-current={c.id === l.container || undefined} onClick={() => onContainer(c.id)}>
              <span className="lg-k">{c.kind === 'am' ? 'AM' : c.kind === 'executor' ? 'EX' : 'T'}</span>
              <span className="lg-c"><b>{c.label}</b><span className="mono">{c.id.replace(/^container_\d+_/, '…')}</span></span>
            </button></li>
          ))}
        </ul>
      </div>
      <div className="lg-main">
        <div className="lg-bar">
          {l && <Seg value={cur?.name ?? 'syslog'} onChange={setFile} label="Archivo de log" options={l.files.map(f => ({ value: f.name, label: <>{f.name} <span className="muted">{f.lines.length}</span></> }))} />}
          <Seg value={level} onChange={setLevel} label="Nivel" options={[{ value: 'all', label: 'Todo' }, { value: 'warn', label: 'WARN+' }, { value: 'error', label: 'ERROR' }]} />
          <label className="input-search"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrar líneas…" aria-label="Filtrar el log" /></label>
          <span className="muted lg-count">{cur ? `${lines.length} de ${cur.lines.length} líneas` : ''}</span>
        </div>
        {logs.err ? <ErrorLine err={logs.err} onRetry={logs.reload} /> : !l ? <Loading /> : (
          <pre className="log lg-view" aria-label={`Log ${cur?.name ?? ''} de ${l.container}`}>
            {lines.length ? lines.map(x => (
              <div key={x.n} className={/ ERROR /.test(x.text) ? 'e' : / WARN /.test(x.text) ? 'w' : undefined}><span className="t lg-n">{x.n}</span>{x.text}</div>
            )) : <span className="t">{cur?.lines.length ? 'Ninguna línea coincide con el filtro' : `${cur?.name ?? 'el log'} está vacío para este contenedor`}</span>}
          </pre>
        )}
      </div>
    </div>
  );
}

export function AppDetail({ id, res, logs, onContainer, onKill, onClose, now }: {
  id: string; res: Res<YarnAppDetail>; logs: Res<AppLogs>; onContainer: (c: string) => void; onKill: () => void; onClose: () => void; now: number;
}) {
  const a = res.data;
  const live = a && (a.state === 'RUNNING' || a.state === 'ACCEPTED');
  const secs = a?.startedAt ? ((a.finishedAt ?? now) - a.startedAt) / 1000 : null;
  return (
    <section className="panel span-12" aria-label="Detalle del trabajo">
      <div className="panel-h">
        {a && <Dot s={a.state} label={a.state} />}
        <h2>{a?.name ?? shortId(id)}</h2>
        <span className="sub mono">{id}</span>
        {a && <EngineTag engine={a.engine} />}
        {a && <span className="badge" data-k={APP_STATE[a.state]}>{a.state} · {nf(a.progress * 100)} %</span>}
        <span className="end">
          {live && <button className="btn btn-sm btn-danger" type="button" onClick={onKill}><Square size={12} />Cancelar</button>}
          <button className="btn btn-sm btn-ghost btn-icon" type="button" onClick={onClose} aria-label="Cerrar el detalle"><X size={13} /></button>
        </span>
      </div>
      <div className="panel-b">
        {res.err ? <ErrorLine err={res.err} onRetry={res.reload} /> : !a ? <Loading /> : (
          <div className="ad">
            <div className="ops-col">
              <div className="ops-sub-h"><h3>DAG</h3><span className="muted">{a.dag.vertices.length} {a.engine === 'tez' ? 'vértices' : a.engine === 'spark' ? 'etapas' : 'fases'}</span></div>
              <Dag app={a} now={now} />
            </div>
            <div className="ad-top">
              <div className="ops-col">
                {a.counters.length > 0 && (
                  <div className="tbl-wrap ad-counters">
                    <table className="tbl" aria-label="Contadores">
                      <thead><tr><th>Contador</th><th>Grupo</th><th className="r">Valor</th></tr></thead>
                      <tbody>{a.counters.map(x => <tr key={x.group + x.name}><td className="mono">{x.name}</td><td className="muted mono">{x.group}</td><td className="r">{nf(x.value)}</td></tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="ops-col">
                <dl className="kv ops-kv">
                  <dt>Cola</dt><dd className="mono">{a.queue} · {a.user}</dd>
                  <dt>Enviado</dt><dd>{clock(a.submittedAt)}{a.startedAt ? ` · arrancó ${clock(a.startedAt)}` : ' · esperando memoria'}</dd>
                  <dt>Duración</dt><dd>{secs != null ? duration(secs) : '—'}{a.finishedAt ? ` · terminó ${clock(a.finishedAt)}` : ''}</dd>
                  <dt>Contenedores</dt><dd>{a.containers.length ? `${a.containers.length} · ${mbLabel(a.containers.reduce((x, c) => x + c.memoryMb, 0))}` : 'ninguno vivo'} · AM {mbLabel(a.amMemoryMb)}</dd>
                  {a.outputPath && <><dt>Resultado</dt><dd className="mono">{a.outputPath}</dd></>}
                  {a.trackingUrl && <><dt>Seguimiento</dt><dd><a className="mono" href={a.trackingUrl} target="_blank" rel="noreferrer">{a.trackingUrl.replace(/^https?:\/\//, '')}</a></dd></>}
                  {a.diagnostics && <><dt>Diagnóstico</dt><dd className="ops-bad">{a.diagnostics}</dd></>}
                </dl>
                <CodeBlock lines={a.command ? a.command.split('\n') : [`yarn application -status ${a.id}`]} label="Comando" />
                <div className="ops-sub-h"><span className="muted">entra</span><span className="ops-ell">{a.trace.input}</span></div>
                <div className="ops-sub-h"><span className="muted">sale</span><span className="ops-ell">{a.trace.output}</span></div>
              </div>
            </div>
            <Logs logs={logs} onContainer={onContainer} />
          </div>
        )}
      </div>
    </section>
  );
}
