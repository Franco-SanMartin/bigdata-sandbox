/* YARN: memoria por NodeManager partida en contenedores, colas, trabajos en vivo y el detalle de cada uno. */
import { useMemo, useState } from 'react';
import { Cpu, Loader2, Play, Search } from 'lucide-react';
import { api } from '../../api';
import type { ApiEvent, ExampleJob, YarnApp } from '../../api/types';
import { EngineTag } from '../../components/Trace';
import { Dot, Empty, Seg } from '../../components/ui';
import { useSnapshot } from '../../state/store';
import { confirm, toast } from '../../state/ui';
import { clock, mbLabel, nf } from '../../lib/format';
import { ClusterGate, ErrorLine, Loading, Stat, useRes } from '../hdfs/common';
import { AppDetail, APP_STATE } from './AppDetail';
import { ContainerMap, ENGINE, Queues, shortId } from './Containers';
import '../hdfs/ops.css';
import './yarn.css';

const isYarn = (e: ApiEvent) => e.type === 'yarn';
const live = (a: YarnApp) => a.state === 'RUNNING' || a.state === 'ACCEPTED';
type Filter = 'todas' | 'activas' | 'terminadas' | 'fallidas';
const JOBS: { job: ExampleJob; label: string; needs: 'mapreduce' | 'todo' }[] = [
  { job: 'mr-ventas', label: 'MapReduce', needs: 'mapreduce' },
  { job: 'hive-ventas', label: 'Hive sobre Tez', needs: 'todo' },
  { job: 'spark-ventas', label: 'Spark', needs: 'todo' },
];

async function kill(a: { id: string; name: string }) {
  const ok = await confirm({ title: `Cancelar ${shortId(a.id)}`, description: 'YARN mata sus contenedores y libera la memoria. Lo que ya escribió en HDFS queda a medias.', facts: [['Trabajo', a.name], ['Comando', `yarn application -kill ${a.id}`]], confirmLabel: 'Cancelar el trabajo', danger: true });
  if (!ok) return;
  try { await api().killApp(a.id); toast({ kind: 'run', title: `${shortId(a.id)} cancelado` }); }
  catch (e) { toast({ kind: 'bad', title: 'No se pudo cancelar', description: e instanceof Error ? e.message : String(e) }); }
}

export function YarnPage() {
  const { status, apps } = useSnapshot();
  const up = status?.phase === 'running';
  const services = status?.config.services;
  const [sel, setSel] = useState<string | null>(null);
  const [container, setContainer] = useState<string | undefined>();
  const [sending, setSending] = useState<ExampleJob | null>(null);
  const [filter, setFilter] = useState<Filter>('todas');
  const [q, setQ] = useState('');
  const pick = (id: string | null) => { setSel(id); setContainer(undefined); };

  const cluster = useRes(a => (up ? a.yarnCluster() : null), [up, services], isYarn);
  const forSel = (e: ApiEvent) => e.type === 'yarn' && e.appId === sel;
  const detail = useRes(a => (up && sel ? a.app(sel) : null), [sel, up], forSel);
  const logs = useRes(a => (up && sel ? a.appLogs(sel, container) : null), [sel, container, up], forSel);
  const c = cluster.data;

  // Un submit real puede tardar (el backend espera a que YARN acepte): sin timeout, el botón queda en "mandando…"
  const submit = async (job: ExampleJob) => {
    setSending(job);
    try { const id = await api().submitExample(job); if (id) { toast({ kind: 'run', title: 'Trabajo enviado a YARN', description: shortId(id) }); pick(id); } }
    catch (e) { toast({ kind: 'bad', title: 'No se pudo mandar', description: e instanceof Error ? e.message : String(e) }); }
    finally { setSending(null); }
  };

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return [...apps].sort((a, b) => b.submittedAt - a.submittedAt).filter(a =>
      (filter === 'todas' || (filter === 'activas' ? live(a) : filter === 'terminadas' ? a.state === 'FINISHED' : a.state === 'FAILED' || a.state === 'KILLED'))
      && (!ql || a.name.toLowerCase().includes(ql) || a.id.includes(ql)));
  }, [apps, filter, q]);
  const running = apps.filter(a => a.state === 'RUNNING').length;
  const queued = apps.filter(a => a.state === 'ACCEPTED').length;
  const done = apps.filter(a => !live(a)).length;
  const containers = c ? c.nodes.reduce((x, n) => x + n.containers.length, 0) : 0;

  return (
    <div className="page-in ops">
      <div className="page-head">
        <div>
          <h1>YARN</h1>
          <p>{up && c ? `${c.nodes.length} NodeManager${c.nodes.length > 1 ? 's' : ''} · ${mbLabel(c.totalMb)} y ${c.totalVcores} vcores · ${running} corriendo, ${queued} en cola` : 'ResourceManager y NodeManagers: memoria, contenedores y trabajos'}</p>
        </div>
        {up && services !== 'hdfs' && (
          <div className="page-actions yr-submit">
            <span className="muted">correr ventas con</span>
            {JOBS.map(j => {
              const off = j.needs === 'todo' && services !== 'todo';
              return (
                <button key={j.job} className="btn btn-sm" type="button" disabled={!!sending || off} title={off ? 'Hace falta el cluster con todos los servicios' : undefined} onClick={() => submit(j.job)}>
                  {sending === j.job ? <><Loader2 size={13} className="spin" />mandando…</> : <><Play size={13} />{j.label}</>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <ClusterGate status={status} icon={<Cpu size={20} />} what="La memoria de YARN y sus trabajos">
        {cluster.err ? (
          <section className="panel"><div className="panel-b yr-down">
            <ErrorLine err={cluster.err} onRetry={cluster.reload} />
            {cluster.err.code === 'service_down' && services === 'hdfs' && <p className="muted">El cluster está prendido solo con HDFS. Cambialo a MapReduce o a todo desde Cluster para tener YARN.</p>}
          </div></section>
        ) : !c ? (
          <section className="panel"><div className="panel-b"><Loading label="Pidiendo el estado al ResourceManager" /></div></section>
        ) : (
          <>
            <div className="stats">
              <Stat label="Memoria" value={<>{nf(c.usedMb / c.totalMb * 100)}<small>%</small></>} sub={`${mbLabel(c.usedMb)} de ${mbLabel(c.totalMb)}`} k={c.usedMb / c.totalMb > 0.9 ? 'run' : undefined} />
              <Stat label="Vcores" value={<>{c.usedVcores}<small>/ {c.totalVcores}</small></>} sub="en uso" />
              <Stat label="Corriendo" value={running} sub={running ? 'con contenedores' : 'ningún trabajo'} />
              <Stat label="En cola" value={queued} sub={queued ? 'esperando memoria' : 'nada esperando'} k={queued ? 'run' : undefined} />
              <Stat label="Terminados" value={done} sub={`${apps.filter(a => a.state === 'FAILED' || a.state === 'KILLED').length} fallidos o cancelados`} />
              <Stat label="Contenedores" value={containers} sub={`de ${mbLabel(c.minAllocationMb)} a ${mbLabel(c.maxAllocationMb)}`} />
            </div>
            <div className="grid cols-12">
              <section className="panel span-8" aria-label="Mapa de contenedores">
                <div className="panel-h"><h2>Contenedores</h2><span className="sub">memoria de cada NodeManager</span></div>
                <div className="panel-b"><ContainerMap c={c} apps={apps} sel={sel} onSelect={pick} /></div>
              </section>
              <section className="panel span-4" aria-label="Colas">
                <div className="panel-h"><h2>Colas</h2><span className="sub">capacity scheduler</span></div>
                <div className="panel-b flush"><Queues c={c} /></div>
              </section>
              <section className="panel span-12" aria-label="Trabajos">
                <div className="panel-h">
                  <h2>Trabajos</h2><span className="sub">{apps.length}</span>
                  <span className="end yr-tools">
                    <Seg value={filter} onChange={setFilter} label="Filtrar trabajos" options={(['todas', 'activas', 'terminadas', 'fallidas'] as Filter[]).map(v => ({ value: v, label: v }))} />
                    <label className="input-search"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" aria-label="Buscar trabajos" /></label>
                  </span>
                </div>
                <div className="panel-b flush">
                  {!apps.length ? (
                    <Empty icon={<Play size={20} />} title="Todavía no corrió ningún trabajo">Mandá uno de los ejemplos de arriba y mirá cómo YARN reparte la memoria.</Empty>
                  ) : !rows.length ? <p className="muted ops-pad">Ningún trabajo coincide con el filtro.</p> : (
                    <div className="tbl-wrap">
                      <table className="tbl yr-apps" aria-label="Trabajos de YARN">
                        <thead><tr><th>Aplicación</th><th>Nombre</th><th>Motor</th><th>Estado</th><th>Avance</th><th className="r">Contenedores</th><th>Enviado</th><th /></tr></thead>
                        <tbody>
                          {rows.map(a => (
                            <tr key={a.id} className="clickable" data-sel={sel === a.id ? 'true' : undefined} onClick={() => pick(sel === a.id ? null : a.id)}>
                              <td className="mono">{shortId(a.id)}</td>
                              <td><span className="ops-ell yr-name">{a.name}</span></td>
                              <td><EngineTag engine={ENGINE[a.type]} /></td>
                              <td><span className="ops-name"><Dot s={a.state} label={a.state} /><span className="badge" data-k={APP_STATE[a.state]}>{a.state}</span></span></td>
                              <td><span className="yr-prog"><span className="meter" data-k={APP_STATE[a.state] === 'bad' ? 'bad' : live(a) ? 'run' : 'ok'} role="meter" aria-label={`Avance de ${shortId(a.id)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.progress * 100)}><i style={{ width: `${a.progress * 100}%` }} /></span><span className="num">{nf(a.progress * 100)} %</span></span></td>
                              <td className="r">{a.containers.length || <span className="muted">0</span>}</td>
                              <td className="muted">{clock(a.submittedAt)}</td>
                              <td className="r">{live(a) && <button className="btn btn-sm btn-ghost yr-kill" type="button" aria-label={`Cancelar ${shortId(a.id)}`} onClick={e => { e.stopPropagation(); kill(a); }}>cancelar</button>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
              {sel && <AppDetail key={sel} id={sel} res={detail} logs={logs} onContainer={setContainer} now={status?.now ?? Date.now()}
                onKill={() => kill({ id: sel, name: detail.data?.name ?? sel })} onClose={() => pick(null)} />}
            </div>
          </>
        )}
      </ClusterGate>
    </div>
  );
}
