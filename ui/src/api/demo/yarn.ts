/* YARN en el modo demo: NodeManager con memoria y vcores, detalle de cada trabajo con su DAG y los logs por contenedor. */
import type { AppLogs, AppType, DagVertex, Engine, YarnApp, YarnAppDetail, YarnCluster } from '../types';
import { fail } from '../errors';
import { TS, YARN_MB, type AppRec, type DemoEngine } from './engine';
import { n, needProc, trace } from './common';

const ENGINE: Record<AppType, Engine> = { MAPREDUCE: 'mr', TEZ: 'tez', SPARK: 'spark' };
const VCORES = 4;
const iso = (t: number) => new Date(t).toISOString().replace('T', ' ').replace('Z', '').replace('.', ',');

export class DemoYarn {
  constructor(private e: DemoEngine) {}

  private rec(id: string): { a: AppRec; v: YarnApp } {
    const a = this.e.jobs.find(x => x.id === id);
    const v = this.e.apps().find(x => x.id === id);
    if (!a || !v) return fail('not_found', `No existe el trabajo ${id}`);
    return { a, v };
  }

  cluster(): YarnCluster {
    needProc(this.e, 'rm', 'El ResourceManager');
    const nm = this.e.procs.get('nm');
    const containers = this.e.jobs.flatMap(a => a.conts.map(c => ({ ...c, appId: a.id, vcores: 1 })));
    const used = this.e.usedYarn();
    const vUsed = Math.min(VCORES, containers.length);
    return {
      totalMb: YARN_MB, usedMb: used, totalVcores: VCORES, usedVcores: vUsed, minAllocationMb: 512, maxAllocationMb: YARN_MB,
      nodes: [{ id: 'localhost:45454', state: nm?.state === 'up' ? 'RUNNING' : 'LOST', memTotalMb: YARN_MB, memUsedMb: used, vcoresTotal: VCORES, vcoresUsed: vUsed, containers, lastHealthUpdate: this.e.now() - (this.e.now() % 1000) }],
      queues: [{ name: 'default', capacity: 100, usedMb: used, running: this.e.jobs.filter(a => a.state === 'RUNNING').length, pending: this.e.jobs.filter(a => a.state === 'ACCEPTED').length }],
    };
  }

  app(id: string): YarnAppDetail {
    if (this.e.phase !== 'running') fail('cluster_stopped', 'El cluster está apagado');
    const { a, v } = this.rec(id);
    const blockMb = (bid?: number) => this.e.files.flatMap(f => f.blocks).find(b => b.id === bid)?.mb ?? 0;
    const last = a.stages[a.stages.length - 1];
    const vertices: DagVertex[] = a.stages.map((s, i) => {
      const done = s.tasks.filter(t => t.state === 'done');
      const frac = s.tasks.length ? done.length / s.tasks.length : 0;
      const readMb = done.reduce((x, t) => x + blockMb(t.blockId), 0);
      return {
        id: s.id, name: s.name, state: s.state, tasks: s.tasks.length, tasksDone: done.length, operators: s.ops || [s.description],
        recordsIn: i === 0 && a.def?.rowsIn ? Math.round(a.def.rowsIn * frac) : undefined,
        recordsOut: s === last && a.def?.rowsOut && s.state === 'done' ? a.def.rowsOut : undefined,
        bytesReadMb: readMb || undefined,
        startedAt: s.tasks.map(t => t.startedAt).filter((x): x is number => x != null).sort()[0],
        finishedAt: s.state === 'done' ? Math.max(...s.tasks.map(t => t.finishedAt || 0)) : undefined,
      };
    });
    const edges = a.stages.flatMap(s => s.dependsOn.map(d => ({ from: d, to: s.id, kind: s.edge || 'datos' })));
    const read = vertices.reduce((x, vx) => x + (vx.bytesReadMb || 0), 0);
    const done = a.state === 'FINISHED';
    const eng = ENGINE[a.type];
    const group = eng === 'mr' ? 'org.apache.hadoop.mapreduce.TaskCounter' : eng === 'tez' ? 'org.apache.tez.common.counters.TaskCounter' : 'spark';
    const counters = [
      { group: 'FileSystemCounters', name: 'HDFS_BYTES_READ', value: Math.round(read * 1048576) },
      ...(a.def?.rowsIn ? [{ group, name: eng === 'mr' ? 'MAP_INPUT_RECORDS' : eng === 'tez' ? 'INPUT_RECORDS_PROCESSED' : 'recordsRead', value: vertices[0].recordsIn || 0 }] : []),
      ...(a.def?.rowsOut && done ? [{ group, name: eng === 'mr' ? 'REDUCE_OUTPUT_RECORDS' : eng === 'tez' ? 'OUTPUT_RECORDS' : 'recordsWritten', value: a.def.rowsOut }] : []),
      { group: 'YARN', name: 'TASKS_DONE', value: vertices.reduce((x, vx) => x + vx.tasksDone, 0) },
    ];
    const trackingUrl = a.state === 'RUNNING' ? `http://localhost:8088/proxy/${a.id}/`
      : eng === 'mr' ? `http://localhost:19888/jobhistory/job/job_${TS}_${a.num}` : eng === 'spark' ? `http://localhost:18080/history/${a.id}/` : `http://localhost:8088/cluster/app/${a.id}`;
    const secs = a.end ? Math.round((a.end - a.sub) / 1000) : null;
    return {
      ...v, engine: eng, command: a.cmd || '', trackingUrl, outputPath: a.def?.out,
      diagnostics: a.state === 'KILLED' ? 'Application killed by user.' : a.state === 'FAILED' ? 'Application failed' : undefined,
      dag: { vertices, edges }, counters,
      trace: trace(a.cmd || `yarn application -status ${a.id}`, a.input || '—',
        `${a.stages.length} etapa${a.stages.length > 1 ? 's' : ''}: ${a.stages.map(s => s.name).join(' → ')}`,
        done ? `Terminó en ${secs} s${a.def?.rowsOut ? ` · ${n(a.def.rowsOut)} filas` : ''}${a.def?.out ? ` en ${a.def.out}` : ''}` : a.state === 'KILLED' ? 'Cancelado: no dejó resultado' : 'Todavía corriendo',
        { engine: eng, appIds: [a.id] }),
    };
  }

  logs(id: string, container?: string): AppLogs {
    if (this.e.phase !== 'running') fail('cluster_stopped', 'El cluster está apagado');
    const { a } = this.rec(id);
    const am = `container_${TS}_${a.num}_01_000001`;
    const seen = new Map<string, { id: string; kind: 'am' | 'task' | 'executor'; label: string }>();
    if (a.state !== 'ACCEPTED') seen.set(am, { id: am, kind: 'am', label: a.type === 'SPARK' ? 'AM (driver)' : 'AM' });
    a.stages.forEach(s => s.tasks.forEach(t => {
      if (!t.container || seen.has(t.container)) return;
      const k = a.executors ? 'executor' : 'task';
      seen.set(t.container, { id: t.container, kind: k, label: k === 'executor' ? `exec ${(t.slot ?? 0) + 1}` : `${s.name} tarea ${t.index + 1}` });
    }));
    const containers = [...seen.values()];
    const cur = container && seen.has(container) ? container : am;
    const short = cur.replace('container_', '');
    const lines = (cur === am ? a.log : a.log.filter(l => l.text.includes(short))).map(l => `${iso(l.t)} ${l.level} ${l.text}`);
    const spark = a.type === 'SPARK';
    return {
      appId: id, containers, container: cur,
      files: [
        { name: 'stdout', lines: [] },
        { name: 'stderr', lines: spark ? lines : [] },
        { name: 'syslog', lines: spark ? [] : lines },
      ],
    };
  }
}
