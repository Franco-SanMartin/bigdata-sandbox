/* Trabajos: lanzar plantillas con parámetros, la lista de lo que corrió en YARN y el detalle de cada uno
   (#yarn/<id>). La memoria de los NodeManagers queda en un KPI con el mapa de contenedores plegado. */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Play, Plus, Search, Square } from 'lucide-react';
import { api } from '../../api';
import type { ApiEvent, JobTemplate, YarnApp } from '../../api/types';
import { EmptyState, GatedButton, PageGate, PageHeader, Stat, StatRow, useBlock, type Tone } from '../../components/base';
import { EngineTag } from '../../components/Trace';
import { Seg, Tip } from '../../components/ui';
import { useCapability } from '../../state/capabilities';
import { useSnapshot } from '../../state/store';
import { confirm, navigate, toast, useRouteArg } from '../../state/ui';
import { ago, clock, duration, mbLabel, nf } from '../../lib/format';
import { initialValues } from '../../lib/jobs';
import { ErrorLine, useRes } from '../hdfs/common';
import { AppDetail, APP_STATE, STATE_ES } from './AppDetail';
import { ContainerMap, ENGINE, Queues, shortId } from './Containers';
import { ENGINE_CAP, launch, NewJobSheet, useTemplates } from './NewJob';
import '../hdfs/ops.css';
import '../hdfs/hdfs.css';
import './yarn.css';

const isYarn = (e: ApiEvent) => e.type === 'yarn';
const live = (a: { state: YarnApp['state'] }) => a.state === 'RUNNING' || a.state === 'ACCEPTED';
type Filter = 'todos' | 'activos' | 'terminados' | 'fallidos';
const SUB = 'Lo que corre en YARN: MapReduce, Hive sobre Tez y Spark, con su memoria, sus contenedores y sus logs.';

async function kill(a: { id: string; name: string }) {
  const ok = await confirm({ title: `Cancelar ${shortId(a.id)}`, description: 'YARN mata sus contenedores y libera la memoria. Lo que ya escribió en HDFS queda a medias.', facts: [['Trabajo', a.name], ['Comando', `yarn application -kill ${a.id}`]], confirmLabel: 'Cancelar el trabajo', danger: true });
  if (!ok) return;
  try { await api().killApp(a.id); toast({ kind: 'run', title: `${shortId(a.id)} cancelado` }); }
  catch (e) { toast({ kind: 'bad', title: 'No se pudo cancelar', description: e instanceof Error ? e.message : String(e) }); }
}

/** Las plantillas como catálogo: se ven aunque el cluster esté apagado */
function Catalog({ templates, onPick }: { templates: JobTemplate[]; onPick?: (t: JobTemplate) => void }) {
  return (
    <section className="panel" aria-label="Plantillas">
      <div className="panel-h"><h2>Qué se puede correr</h2><span className="sub">{templates.length} plantillas</span></div>
      <div className="panel-b yr-cat">
        {templates.map(t => <CatalogItem key={t.id} t={t} onPick={onPick} />)}
      </div>
    </section>
  );
}

function CatalogItem({ t, onPick }: { t: JobTemplate; onPick?: (t: JobTemplate) => void }) {
  const block = useBlock(ENGINE_CAP[t.engine]);
  const body = <>
    <span className="yr-cat-h"><b>{t.label}</b><EngineTag engine={t.engine} /></span>
    <span className="yr-cat-d">{t.description}</span>
    {onPick && block && <span className="yr-cat-off">{block.reason}</span>}
  </>;
  return onPick
    ? <button type="button" className="yr-cat-i" data-off={block ? true : undefined} onClick={() => onPick(t)}>{body}</button>
    : <div className="yr-cat-i" data-static>{body}</div>;
}

export function YarnPage() {
  const ready = useCapability('yarn.submit').state === 'ready';
  const templates = useTemplates();
  if (ready) return <Jobs templates={templates} />;
  return (
    <div className="page-in yr">
      <PageHeader title="Trabajos" sub={SUB} />
      <PageGate cap="yarn.submit" title="Trabajos" keep={<Catalog templates={templates} />}
        can={['Lanzar WordCount, Pi, Grep o las ventas con tus parámetros', 'Seguir el avance, el DAG y los logs de cada contenedor en vivo', 'Ver cómo YARN reparte la memoria de los NodeManagers']}>{null}</PageGate>
    </div>
  );
}

function Jobs({ templates }: { templates: JobTemplate[] }) {
  const { status, apps } = useSnapshot();
  const arg = useRouteArg();
  const [sheet, setSheet] = useState<{ tid?: string } | null>(null);
  const openNew = (tid?: string) => setSheet({ tid });
  const sheetEl = <NewJobSheet open={!!sheet} initial={sheet?.tid} templates={templates} onClose={() => setSheet(null)} />;
  if (arg) return <><JobView id={arg} onNew={openNew} />{sheetEl}</>;
  return <><JobList apps={apps} templates={templates} onNew={openNew} now={status?.now ?? Date.now()} />{sheetEl}</>;
}

function JobList({ apps, templates, onNew, now }: { apps: YarnApp[]; templates: JobTemplate[]; onNew: (tid?: string) => void; now: number }) {
  const { status } = useSnapshot();
  const services = status?.config.services;
  const [filter, setFilter] = useState<Filter>('todos');
  const [q, setQ] = useState('');
  const [mem, setMem] = useState(false);
  const cluster = useRes(a => a.yarnCluster(), [services], isYarn);
  const c = cluster.data;

  const n = {
    todos: apps.length,
    activos: apps.filter(live).length,
    terminados: apps.filter(a => a.state === 'FINISHED').length,
    fallidos: apps.filter(a => a.state === 'FAILED' || a.state === 'KILLED').length,
  };
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return [...apps].sort((a, b) => b.submittedAt - a.submittedAt).filter(a =>
      (filter === 'todos' || (filter === 'activos' ? live(a) : filter === 'terminados' ? a.state === 'FINISHED' : a.state === 'FAILED' || a.state === 'KILLED'))
      && (!ql || a.name.toLowerCase().includes(ql) || a.id.toLowerCase().includes(ql)));
  }, [apps, filter, q]);
  const running = apps.filter(a => a.state === 'RUNNING').length;
  const queued = apps.filter(a => a.state === 'ACCEPTED').length;
  const containers = c ? c.nodes.reduce((x, nm) => x + nm.containers.length, 0) : 0;
  const memPct = c && c.totalMb ? c.usedMb / c.totalMb * 100 : 0;
  const chip: { k: Tone; label: string } = cluster.err ? { k: 'bad', label: 'ResourceManager no responde' }
    : running ? { k: 'run', label: `${running} corriendo` } : queued ? { k: 'run', label: `${queued} en cola` } : { k: 'ok', label: 'listo' };
  const wc = templates.find(t => t.id === 'mr-wordcount');

  return (
    <div className="page-in yr ops">
      <PageHeader title="Trabajos" status={chip}
        sub={c ? `${c.nodes.length} NodeManager${c.nodes.length > 1 ? 's' : ''} · ${mbLabel(c.totalMb)} y ${c.totalVcores} vcores para contenedores` : SUB}
        help={<>Cada trabajo pide <b>contenedores</b> a YARN: uno para su ApplicationMaster y uno por tarea. Si no hay memoria libre en los NodeManagers, espera en la cola.</>}
        actions={<GatedButton cap="yarn.submit" className="btn btn-primary" onClick={() => onNew()}><Plus size={15} />Nuevo trabajo</GatedButton>} />

      {cluster.err ? (
        <section className="panel"><div className="panel-b yr-down">
          <ErrorLine err={cluster.err} onRetry={cluster.reload} />
          {cluster.err.code === 'service_down' && services === 'hdfs' && <p className="muted">El cluster está prendido solo con HDFS. Cambialo a MapReduce o a todo desde Configuración para tener YARN.</p>}
        </div></section>
      ) : (
        <>
          <StatRow label="Resumen de YARN">
            <Stat label="Memoria en uso" value={c ? nf(memPct) : '—'} unit="%" k={memPct > 90 ? 'run' : undefined} sub={c ? `${mbLabel(c.usedMb)} de ${mbLabel(c.totalMb)} · ${c.usedVcores}/${c.totalVcores} vcores` : 'pidiendo…'} />
            <Stat label="Corriendo" value={running} sub={running ? `${containers} contenedores` : 'ningún trabajo'} k={running ? 'run' : undefined} />
            <Stat label="En cola" value={queued} sub={queued ? 'esperando memoria' : 'nada esperando'} k={queued ? 'run' : undefined} />
            <Stat label="Terminados" value={n.terminados} sub={n.fallidos ? `${n.fallidos} fallidos o cancelados` : 'ninguno falló'} k={n.fallidos ? 'bad' : undefined} />
          </StatRow>
          {c && (
            <section className="panel yr-mem" data-open={mem || undefined}>
              <button type="button" className="panel-h yr-mem-h" aria-expanded={mem} onClick={() => setMem(m => !m)}>
                <ChevronRight size={14} className="yr-chev" />
                <h2>Memoria y contenedores</h2>
                <span className="sub">{containers ? `${containers} contenedores en ${c.nodes.length} NodeManager${c.nodes.length > 1 ? 's' : ''}` : 'todo libre'}</span>
                <span className="end yr-mem-bar" aria-hidden="true"><span className="meter" data-k={memPct > 90 ? 'run' : 'ok'}><i style={{ width: `${memPct}%` }} /></span></span>
              </button>
              {mem && (
                <div className="panel-b yr-mem-b">
                  <ContainerMap c={c} apps={apps} sel={null} onSelect={id => navigate('yarn', id)} />
                  <div><h3 className="yr-h3">Colas</h3><Queues c={c} /></div>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <section className="panel" aria-label="Trabajos">
        <div className="panel-h">
          <Seg value={filter} onChange={setFilter} label="Filtrar trabajos" options={(['todos', 'activos', 'terminados', 'fallidos'] as Filter[]).map(v => ({ value: v, label: <>{v} <span className="muted">{n[v]}</span></> }))} />
          <span className="end">
            <label className="input-search yr-q"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o id" aria-label="Buscar trabajos" /></label>
          </span>
        </div>
        <div className="panel-b flush">
          {!apps.length ? (
            <EmptyState icon={<Play size={20} />} title="Todavía no corrió ningún trabajo" compact
              actions={<>
                {wc && <GatedButton cap="mapreduce" className="btn btn-primary" onClick={() => void launch(wc, initialValues(wc)).then(e => e && toast({ kind: 'bad', title: 'No se pudo lanzar', description: e }))}><Play size={14} />Contar palabras de texto.txt</GatedButton>}
                <GatedButton cap="yarn.submit" className="btn" onClick={() => onNew()}><Plus size={14} />Elegir otro trabajo</GatedButton>
              </>}
              foot="El texto de ejemplo se sube solo a HDFS si falta.">
              Lanzá uno y mirá cómo YARN le da contenedores, cómo avanza cada tarea y qué escribe en los logs.
            </EmptyState>
          ) : !rows.length ? <p className="muted ops-pad">Ningún trabajo coincide con el filtro.</p> : (
            <div className="tbl-wrap">
              <table className="tbl yr-apps" aria-label="Trabajos de YARN">
                <thead><tr><th>Trabajo</th><th>Motor</th><th>Estado</th><th>Avance</th><th className="r">Contenedores</th><th>Enviado</th><th>Duración</th><th /></tr></thead>
                <tbody>
                  {rows.map(a => (
                    <tr key={a.id} className="clickable" tabIndex={0} onClick={() => navigate('yarn', a.id)} onKeyDown={e => { if (e.key === 'Enter') navigate('yarn', a.id); }}>
                      <td><span className="yr-job"><span className="ops-ell yr-name">{a.name}</span><span className="mono dim">{shortId(a.id)}</span></span></td>
                      <td><EngineTag engine={ENGINE[a.type]} /></td>
                      <td><Tip content={a.state}><span className="badge" data-k={APP_STATE[a.state]}>{STATE_ES[a.state]}</span></Tip></td>
                      <td><span className="yr-prog"><span className="meter" data-k={APP_STATE[a.state] === 'bad' ? 'bad' : live(a) ? 'run' : 'ok'} role="meter" aria-label={`Avance de ${shortId(a.id)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.progress * 100)}><i style={{ width: `${a.progress * 100}%` }} /></span><span className="num">{nf(a.progress * 100)} %</span></span></td>
                      <td className="r">{a.containers.length || <span className="muted">0</span>}</td>
                      <td className="muted"><Tip content={clock(a.submittedAt)}><span>{ago(now, a.submittedAt)}</span></Tip></td>
                      <td className="muted num">{a.startedAt ? duration(((a.finishedAt ?? now) - a.startedAt) / 1000) : '—'}</td>
                      <td className="r">{live(a) && <button className="btn btn-sm btn-ghost yr-kill" type="button" aria-label={`Cancelar ${shortId(a.id)}`} onClick={e => { e.stopPropagation(); void kill(a); }}>cancelar</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {apps.length > 0 && <Catalog templates={templates} onPick={t => onNew(t.id)} />}
    </div>
  );
}

function JobView({ id, onNew }: { id: string; onNew: (tid?: string) => void }) {
  const { status, apps } = useSnapshot();
  const [container, setContainer] = useState<string | undefined>();
  const row = apps.find(a => a.id === id);
  const forMe = (e: ApiEvent) => e.type === 'yarn' && e.appId === id;
  // Los eventos traen el avance; mientras corre se vuelve a pedir igual cada 3 s por si alguno se pierde
  const every = row && live(row) ? 3000 : undefined;
  const detail = useRes(a => a.app(id), [id], forMe, every);
  const logs = useRes(a => a.appLogs(id, container), [id, container], forMe, every);
  // Cuando la lista ve que cambió de estado (arrancó, terminó…), se pide el detalle de nuevo
  const rowState = row?.state;
  useEffect(() => { if (rowState) { detail.reload(); logs.reload(); } }, [rowState]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = detail.data;
  const st = row?.state ?? a?.state;
  const name = a?.name ?? row?.name ?? shortId(id);
  return (
    <div className="page-in yr ops">
      <div className="yr-back"><button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('yarn')}><ArrowLeft size={13} />Trabajos</button></div>
      <PageHeader title={name}
        status={st ? { k: APP_STATE[st], label: STATE_ES[st] } : undefined}
        sub={<span className="yr-sub"><span className="mono">{id}</span>{a && <EngineTag engine={a.engine} />}{a && <span>cola {a.queue}</span>}</span>}
        actions={st && live({ state: st })
          ? <button className="btn btn-danger" type="button" onClick={() => void kill({ id, name })}><Square size={13} />Cancelar</button>
          : <GatedButton cap="yarn.submit" className="btn" onClick={() => onNew()}><Plus size={15} />Nuevo trabajo</GatedButton>} />
      <AppDetail res={detail} logs={logs} onContainer={setContainer} now={status?.now ?? Date.now()} />
    </div>
  );
}

