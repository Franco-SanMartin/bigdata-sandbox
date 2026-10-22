/* YARN: memoria por NodeManager, colas, trabajos y el detalle de cada uno (DAG, contadores, logs). Esqueleto. */
import { useState } from 'react';
import { Cpu, Play } from 'lucide-react';
import type { AppType, Engine, YarnApp } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { EngineTag, Slot, TraceView } from '../../components/Trace';
import { Empty, Meter } from '../../components/ui';
import { HELP } from '../../help/content';
import { submitExample } from '../../state/actions';
import { useSnapshot } from '../../state/store';
import { useApi } from '../../state/useApi';
import { clock, mbLabel, nf } from '../../lib/format';

const ENGINE: Record<AppType, Engine> = { MAPREDUCE: 'mr', TEZ: 'tez', SPARK: 'spark' };
const STATE: Record<YarnApp['state'], string> = { ACCEPTED: 'run', RUNNING: 'run', FINISHED: 'ok', FAILED: 'bad', KILLED: 'bad' };

export function YarnPage() {
  const { status, apps } = useSnapshot();
  const up = status?.phase === 'running' && status.config.services !== 'hdfs';
  const [sel, setSel] = useState<string | null>(null);
  const isYarn = (e: { type: string }) => e.type === 'yarn';
  const cluster = useApi(a => (up ? a.yarnCluster() : Promise.resolve(null)), [up], isYarn);
  const detail = useApi(a => (up && sel ? a.app(sel) : Promise.resolve(null)), [sel, up], isYarn);
  const c = cluster.data;

  const cols: Column<YarnApp>[] = [
    { id: 'id', header: 'Aplicación', cell: r => <span className="mono">{r.id.replace(/^application_\d+_/, 'app_')}</span> },
    { id: 'name', header: 'Nombre', sort: r => r.name, cell: r => r.name },
    { id: 'type', header: 'Motor', cell: r => <EngineTag engine={ENGINE[r.type]} /> },
    { id: 'state', header: 'Estado', sort: r => r.state, cell: r => <span className="badge" data-k={STATE[r.state]}>{r.state}</span> },
    { id: 'prog', header: 'Avance', align: 'right', sort: r => r.progress, cell: r => `${nf(r.progress * 100)} %` },
    { id: 'cont', header: 'Contenedores', align: 'right', cell: r => r.containers.length },
    { id: 'sub', header: 'Enviada', sort: r => r.submittedAt, cell: r => <span className="muted">{clock(r.submittedAt)}</span> },
  ];

  return (
    <div className="page-in">
      <div className="page-head">
        <div><h1>YARN</h1><p>{HELP.yarn.intro}</p></div>
        <div className="page-actions">
          <button className="btn" type="button" disabled={!up} onClick={() => submitExample('mr-ventas')}><Play size={14} />Correr ventas con MapReduce</button>
        </div>
      </div>
      {!up ? (
        <section className="panel"><Empty icon={<Cpu size={20} />} title="YARN no está corriendo">Prendé el cluster con MapReduce o con todo para mandar trabajos.</Empty></section>
      ) : (
        <div className="grid cols-12">
          <section className="panel span-12">
            <div className="panel-h"><h2>Memoria del cluster</h2>{c && <span className="sub">{mbLabel(c.usedMb)} de {mbLabel(c.totalMb)} · {c.usedVcores} de {c.totalVcores} vcores · contenedores de {mbLabel(c.minAllocationMb)} a {mbLabel(c.maxAllocationMb)}</span>}</div>
            <div className="panel-b">
              {c ? c.nodes.map(n => (
                <div key={n.id} style={{ display: 'grid', gridTemplateColumns: '160px minmax(0,1fr) 140px', gap: 12, alignItems: 'center' }}>
                  <span className="mono">{n.id}</span>
                  <Meter value={n.memUsedMb} max={n.memTotalMb} kind={n.memUsedMb / n.memTotalMb > 0.9 ? 'run' : 'ok'} label={`Memoria de ${n.id}`} />
                  <span className="muted">{n.containers.length} contenedores</span>
                </div>
              )) : <span className="muted">Cargando…</span>}
              <div style={{ marginTop: 12 }}><Slot title="Acá va el mapa de contenedores:">cada NodeManager con sus contenedores (AM, tareas, ejecutores) por aplicación y las colas (yarnCluster().nodes y .queues).</Slot></div>
            </div>
          </section>
          <section className="panel span-12">
            <div className="panel-h"><h2>Aplicaciones</h2><span className="sub">{apps.length}</span></div>
            <div className="panel-b flush">
              <DataTable label="Aplicaciones de YARN" columns={cols} rows={apps} rowKey={r => r.id} selected={sel} onRowClick={r => setSel(r.id)}
                empty="Todavía no corrió ningún trabajo." initialSort={{ id: 'sub', dir: -1 }} />
            </div>
          </section>
          {sel && (
            <section className="panel span-12">
              <div className="panel-h"><h2>{detail.data?.name ?? sel}</h2>{detail.data && <span className="sub mono">{detail.data.id}</span>}</div>
              <div className="panel-b">
                {detail.data ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <TraceView trace={detail.data.trace} />
                    <Slot title="Acá va el DAG:">{detail.data.dag.vertices.length} vértices con sus operadores y contadores (app().dag y .counters), y los logs de cada contenedor (appLogs()).</Slot>
                  </div>
                ) : <span className="muted">{detail.error ?? 'Cargando…'}</span>}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
