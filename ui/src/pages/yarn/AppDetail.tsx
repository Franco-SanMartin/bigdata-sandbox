/* Detalle de un trabajo: avance, DAG con sus tareas, contadores, resumen y logs en vivo por contenedor. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, FolderOpen, Pause, Play, Search } from 'lucide-react';
import type { AppLogs, DagEdge, DagVertex, YarnAppDetail, YarnStage } from '../../api/types';
import { KeyValue, Panel } from '../../components/base';
import { CodeBlock, Dot, Seg, Tip } from '../../components/ui';
import { navigate } from '../../state/ui';
import { clock, duration, mbLabel, nf } from '../../lib/format';
import { ErrorLine, Loading, type Res } from '../hdfs/common';

export const APP_STATE: Record<YarnAppDetail['state'], 'ok' | 'run' | 'bad'> = { ACCEPTED: 'run', RUNNING: 'run', FINISHED: 'ok', FAILED: 'bad', KILLED: 'bad' };
/** El estado de YARN dicho en castellano (el original queda en el tooltip) */
export const STATE_ES: Record<YarnAppDetail['state'], string> = { ACCEPTED: 'en cola', RUNNING: 'corriendo', FINISHED: 'terminó', FAILED: 'falló', KILLED: 'cancelado' };
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

/** Marca lo que coincide con la búsqueda */
function hl(text: string, q: string) {
  if (!q) return text;
  const out: ReactNode[] = [];
  const low = text.toLowerCase();
  let i = 0, k = 0;
  for (let j = low.indexOf(q); j >= 0; j = low.indexOf(q, i)) { out.push(text.slice(i, j), <mark key={k++}>{text.slice(j, j + q.length)}</mark>); i = j + q.length; }
  out.push(text.slice(i));
  return out;
}

function Logs({ logs, onContainer, live }: { logs: Res<AppLogs>; onContainer: (id: string) => void; live: boolean }) {
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const frozen = useRef<AppLogs | undefined>(undefined);
  if (!paused || !frozen.current) frozen.current = logs.data;
  const l = paused ? frozen.current : logs.data;
  const [file, setFile] = useState<'stdout' | 'stderr' | 'syslog' | null>(null);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all');
  const view = useRef<HTMLPreElement>(null);
  const cur = l ? (file && l.files.find(f => f.name === file)) || l.files.find(f => f.name === 'syslog' && f.lines.length) || l.files.find(f => f.lines.length) || l.files[0] : undefined;
  const ql = q.trim().toLowerCase();
  const lines = useMemo(() => {
    if (!cur) return [];
    return cur.lines.map((text, i) => ({ n: i + 1, text })).filter(x =>
      (level === 'all' || (level === 'warn' ? / (WARN|ERROR) /.test(x.text) : / ERROR /.test(x.text))) && (!ql || x.text.toLowerCase().includes(ql)));
  }, [cur, ql, level]);
  const fresh = paused && logs.data && cur ? (logs.data.files.find(f => f.name === cur.name)?.lines.length ?? 0) - cur.lines.length : 0;

  // Siguiendo: cada línea nueva baja hasta el final, como un tail -f
  useEffect(() => { const el = view.current; if (follow && !paused && el) el.scrollTop = el.scrollHeight; }, [lines.length, follow, paused, cur?.name]);
  const onScroll = () => { const el = view.current; if (el && follow && el.scrollHeight - el.scrollTop - el.clientHeight > 40) setFollow(false); };

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
          <label className="input-search lg-q"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar en el log…" aria-label="Buscar en el log" /></label>
          <span className="lg-acts">
            <Tip content={paused ? 'Volver a mostrar lo que va llegando' : 'Congelar el log para leerlo tranquilo'}>
              <button type="button" className="btn btn-sm" aria-pressed={paused} onClick={() => setPaused(p => !p)} disabled={!live && !paused}>
                {paused ? <><Play size={12} />Seguir{fresh > 0 && <span className="badge" data-k="run">+{fresh}</span>}</> : <><Pause size={12} />Pausar</>}
              </button>
            </Tip>
            <Tip content="Bajar solo al final cuando llegan líneas nuevas">
              <button type="button" className="btn btn-sm btn-ghost" aria-pressed={follow} onClick={() => { setFollow(f => !f); const el = view.current; if (el) el.scrollTop = el.scrollHeight; }}>
                <ArrowDownToLine size={12} />{follow ? 'Al final' : 'Ir al final'}
              </button>
            </Tip>
          </span>
          <span className="muted lg-count">{cur ? (ql || level !== 'all' ? `${lines.length} de ${cur.lines.length} líneas` : `${cur.lines.length} líneas`) : ''}{live && !paused && <span className="lg-live"> · en vivo</span>}</span>
        </div>
        {logs.err && !l ? <ErrorLine err={logs.err} onRetry={logs.reload} /> : !l ? <Loading /> : (
          <pre ref={view} onScroll={onScroll} className="log lg-view" aria-label={`Log ${cur?.name ?? ''} de ${l.container}`}>
            {lines.length ? lines.map(x => (
              <div key={x.n} className={/ ERROR /.test(x.text) ? 'e' : / WARN /.test(x.text) ? 'w' : undefined}><span className="t lg-n">{x.n}</span>{hl(x.text, ql)}</div>
            )) : <span className="t">{cur?.lines.length ? 'Ninguna línea coincide con la búsqueda' : live ? `${cur?.name ?? 'el log'} todavía no tiene nada: el contenedor está arrancando` : `${cur?.name ?? 'el log'} está vacío para este contenedor`}</span>}
          </pre>
        )}
      </div>
    </div>
  );
}

/** Avance grande del trabajo con lo que está haciendo ahora */
function Progress({ a, now }: { a: YarnAppDetail; now: number }) {
  const k = APP_STATE[a.state];
  const pct = a.progress * 100;
  const secs = a.startedAt ? ((a.finishedAt ?? now) - a.startedAt) / 1000 : null;
  const runV = a.dag.vertices.find(v => v.state === 'running');
  const what = a.state === 'ACCEPTED' ? 'Esperando memoria para el ApplicationMaster'
    : a.state === 'RUNNING' ? (runV ? `Corriendo ${runV.name}: ${runV.tasksDone} de ${runV.tasks} tareas` : 'Corriendo')
    : a.state === 'FINISHED' ? `Terminó bien${secs != null ? ` en ${duration(secs)}` : ''}`
    : a.state === 'KILLED' ? 'Lo cancelaron' : 'Falló: mirá el diagnóstico y el syslog del contenedor';
  return (
    <div className="ad-prog" data-k={k}>
      <div className="ad-prog-h">
        <b className="num">{nf(pct)} %</b>
        <span>{what}</span>
        <span className="muted end">{secs != null ? duration(secs) : 'sin arrancar'} · {a.containers.length ? `${a.containers.length} contenedores vivos` : 'sin contenedores'}</span>
      </div>
      <span className="meter" data-k={k} role="meter" aria-label="Avance del trabajo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

export function AppDetail({ res, logs, onContainer, now }: { res: Res<YarnAppDetail>; logs: Res<AppLogs>; onContainer: (c: string) => void; now: number }) {
  const a = res.data;
  if (res.err && !a) return <section className="panel"><div className="panel-b"><ErrorLine err={res.err} onRetry={res.reload} /></div></section>;
  if (!a) return <section className="panel"><div className="panel-b"><Loading label="Pidiendo el trabajo al ResourceManager" /></div></section>;
  const live = a.state === 'RUNNING' || a.state === 'ACCEPTED';
  const unit = a.engine === 'tez' ? 'vértices' : a.engine === 'spark' ? 'etapas' : 'fases';
  return (
    <div className="ad">
      <Progress a={a} now={now} />
      {a.diagnostics && <div className="callout" data-k={APP_STATE[a.state] === 'bad' ? 'bad' : 'run'}>{a.diagnostics}</div>}
      <div className="ad-top">
        <Panel title="DAG" sub={`${a.dag.vertices.length} ${unit}`}><Dag app={a} now={now} /></Panel>
        <Panel title="Resumen" end={a.outputPath && a.state === 'FINISHED' ? (
          <button type="button" className="btn btn-sm" onClick={() => navigate('hdfs', a.outputPath!.replace(/^\/+/, ''))}><FolderOpen size={13} />Ver resultado</button>
        ) : undefined}>
          <KeyValue items={[
            ['Cola', <span className="mono">{a.queue} · {a.user}</span>],
            ['Enviado', <>{clock(a.submittedAt)}{a.startedAt ? ` · arrancó ${clock(a.startedAt)}` : ' · esperando memoria'}</>],
            ['Terminó', a.finishedAt ? clock(a.finishedAt) : <span className="muted">todavía no</span>],
            ['Memoria', <>{a.containers.length ? `${a.containers.length} contenedores · ${mbLabel(a.containers.reduce((x, c) => x + c.memoryMb, 0))}` : 'ningún contenedor vivo'} · AM {mbLabel(a.amMemoryMb)}</>],
            ...(a.outputPath ? [['Resultado', <span className="mono">{a.outputPath}</span>] as [string, ReactNode]] : []),
            ['Entra', <span className="ad-ell">{a.trace.input}</span>],
            ['Sale', <span className="ad-ell">{a.trace.output}</span>],
            ...(a.trackingUrl ? [['Seguimiento', <a className="mono" href={a.trackingUrl} target="_blank" rel="noreferrer">{a.trackingUrl.replace(/^https?:\/\//, '')}</a>] as [string, ReactNode]] : []),
          ]} />
          <CodeBlock lines={a.command ? a.command.split('\n') : [`yarn application -status ${a.id}`]} label="Comando" />
        </Panel>
      </div>
      <Panel title="Logs" sub={live ? 'se actualizan solos mientras corre' : 'de cada contenedor'} flush>
        <Logs logs={logs} onContainer={onContainer} live={live} />
      </Panel>
      {a.counters.length > 0 && (
        <details className="panel ad-cnt">
          <summary className="panel-h"><h2>Contadores</h2><span className="sub">{a.counters.length} · lo que midió {a.engine === 'spark' ? 'Spark' : 'Hadoop'}</span></summary>
          <div className="panel-b flush">
            <div className="tbl-wrap">
              <table className="tbl" aria-label="Contadores">
                <thead><tr><th>Contador</th><th>Grupo</th><th className="r">Valor</th></tr></thead>
                <tbody>{a.counters.map(x => <tr key={x.group + x.name}><td className="mono">{x.name}</td><td className="muted mono">{x.group}</td><td className="r">{nf(x.value)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
