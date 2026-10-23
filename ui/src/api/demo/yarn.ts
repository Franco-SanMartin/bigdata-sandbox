/* YARN en el modo demo: NodeManager con memoria y vcores, detalle de cada trabajo con su DAG, los logs por
   contenedor y las plantillas con parámetros (wordcount, pi, grep…), que escriben un resultado de verdad. */
import type { AppLogs, AppType, DagVertex, Engine, ExampleJob, JobTemplate, SubmitJobRequest, YarnApp, YarnAppDetail, YarnCluster } from '../types';
import { fail } from '../errors';
import { TS, YARN_MB, type AppDef, type AppRec, type DemoEngine, type StageDef } from './engine';
import { n, needHdfs, needProc, parentOf, trace } from './common';
import { TEMPLATES, TEXTO, fillCommand, formErrors, inside, toParams } from '../../lib/jobs';
import { sourceOf, store } from './contenido';

const ENGINE: Record<AppType, Engine> = { MAPREDUCE: 'mr', TEZ: 'tez', SPARK: 'spark' };
const VCORES = 4;
const JOBS: Record<string, ExampleJob> = { 'mr-ventas': 'mr-ventas', 'hive-ventas': 'hive-ventas', 'spark-ventas': 'spark-ventas' };
/** Palabras como las separa wordcount (StringTokenizer: espacios) */
const words = (text: string) => text.split(/\s+/).filter(Boolean);
/** La expresión de Java en JavaScript: \w también acepta letras con tilde, como en Java con UNICODE_CHARACTER_CLASS */
function javaRegex(src: string): RegExp {
  let out = '', cls = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\' && src[i + 1] === 'w') { out += cls ? '\\p{L}\\p{N}_' : '[\\p{L}\\p{N}_]'; i++; continue; }
    if (c === '\\') { out += c + (src[i + 1] ?? ''); i++; continue; }
    if (c === '[') cls = true; else if (c === ']') cls = false;
    out += c;
  }
  try { return new RegExp(out, 'gu'); } catch { return fail('invalid', `La expresión regular ${src} no es válida (¿falta cerrar un corchete?)`); }
}
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

  templates(): JobTemplate[] { return structuredClone(TEMPLATES); }

  /** POST /api/yarn/apps { template, params }: valida igual que el servidor y lanza el trabajo simulado */
  async submit(req: SubmitJobRequest): Promise<string> {
    const tpl = TEMPLATES.find(t => t.id === req?.template);
    if (!tpl) return fail('invalid', `No hay una plantilla ${String(req?.template)}`);
    const params = req.params ?? {};
    const extra = Object.keys(params).filter(k => !tpl.params.some(x => x.name === k));
    if (extra.length) fail('invalid', `${tpl.id} no tiene el parámetro ${extra.join(', ')}`);
    const errs = Object.values(formErrors(tpl, params));
    if (errs.length) fail('invalid', errs[0]);
    const v = toParams(tpl, params);
    const e = this.e;
    if (JOBS[tpl.id]) {
      needProc(e, 'rm', 'El ResourceManager'); needProc(e, 'nm', 'El NodeManager');
      if (tpl.id === 'hive-ventas') needProc(e, 'hiveserver2', 'HiveServer2');
      const id = e.submitExample(JOBS[tpl.id]);
      if (!id) fail('unsupported', 'Esta configuración no tiene YARN');
      return id;
    }
    needHdfs(e);
    if (e.applied?.services === 'hdfs') fail('unsupported', 'Esta configuración no tiene YARN: elegí una con YARN en Cluster');
    needProc(e, 'rm', 'El ResourceManager'); needProc(e, 'nm', 'El NodeManager');
    const shown = fillCommand(tpl, v);
    const input = typeof v.in === 'string' ? v.in : undefined;
    const out = typeof v.out === 'string' ? v.out : undefined;
    // La entrada: texto.txt se sube sola si falta; otra cosa tiene que existir
    let blocks: number[] = [];
    let text = '';
    if (input) {
      if (input === TEXTO && !e.files.some(f => f.path === TEXTO)) e.putFile({ path: TEXTO, mb: 138 / 1048576, local: 'texto.txt', rows: '4 líneas' });
      const files = e.files.filter(f => inside(f.path, input) && !f.path.endsWith('/_SUCCESS'));
      if (!files.length) fail('not_found', `No existe ${input} (o está vacía): subí un archivo antes`);
      blocks = files.flatMap(f => f.blocks.map(b => b.id));
      for (const f of files) {
        const src = sourceOf(e, f.path, f.sizeMb);
        if (!src.binary) text += await src.read(0, Math.min(src.total, 1048576));
      }
    }
    if (out) {
      const exists = e.files.some(f => inside(f.path, out)) || [...e.dirs].some(d => inside(d, out));
      if (exists && !v.overwrite) fail('invalid', `Ya existe ${out}: MapReduce no la pisa. Tildá «Pisar la salida» o elegí otra carpeta`);
      e.files = e.files.filter(f => !inside(f.path, out));
      [...e.dirs].forEach(d => { if (inside(d, out)) e.dirs.delete(d); });
      [...store(e).keys()].forEach(k => { if (inside(k, out)) store(e).delete(k); });
      e.dirs.add(parentOf(out)!);
    }
    const nb = Math.max(1, blocks.length);
    const lines = text.split('\n').filter(Boolean);
    let def: AppDef, result = '', counters: string[] = [];
    if (tpl.id === 'mr-wordcount' || tpl.id === 'mr-grep') {
      const counts = new Map<string, number>();
      if (tpl.id === 'mr-wordcount') words(text).forEach(w => counts.set(w, (counts.get(w) || 0) + 1));
      else {
        const rx = javaRegex(String(v.regex));
        for (const m of text.matchAll(rx)) if (m[0]) counts.set(m[0], (counts.get(m[0]) || 0) + 1);
      }
      const rows = [...counts.entries()].sort(tpl.id === 'mr-grep' ? (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]) : (a, b) => (a[0] < b[0] ? -1 : 1));
      result = rows.map(([w, k]) => (tpl.id === 'mr-grep' ? `${k}\t${w}` : `${w}\t${k}`)).join('\n') + (rows.length ? '\n' : '');
      const mapOut = [...counts.values()].reduce((a, b) => a + b, 0);
      const stages: StageDef[] = tpl.id === 'mr-wordcount'
        ? [{ id: 'map', name: 'Map', description: 'Cada mapper parte su bloque en palabras y emite (palabra, 1)', dependsOn: [], durSec: 4, n: nb, blocks, ops: ['TextInputFormat', 'TokenizerMapper', 'IntSumReducer (combiner)'] },
          { id: 'reduce', name: 'Reduce', description: 'Recibe cada palabra con sus unos y los suma', dependsOn: ['map'], edge: 'shuffle + sort', durSec: 3, n: 1, ops: ['merge', 'IntSumReducer', 'TextOutputFormat'] }]
        : [{ id: 'map', name: 'Map (búsqueda)', description: 'Busca la expresión en cada línea y emite (coincidencia, 1)', dependsOn: [], durSec: 4, n: nb, blocks, ops: ['TextInputFormat', 'RegexMapper', 'LongSumReducer (combiner)'] },
          { id: 'reduce', name: 'Reduce (búsqueda)', description: 'Suma cuántas veces aparece cada coincidencia', dependsOn: ['map'], edge: 'shuffle + sort', durSec: 3, n: 1, ops: ['LongSumReducer', 'SequenceFileOutputFormat'] },
          { id: 'sort', name: 'Orden', description: 'Segundo trabajo: ordena de más a menos frecuente', dependsOn: ['reduce'], edge: 'shuffle + sort', durSec: 3, n: 1, ops: ['InverseMapper', 'DecreasingComparator', 'TextOutputFormat'] }];
      def = { type: 'MAPREDUCE', name: tpl.id === 'mr-wordcount' ? 'word count' : 'grep-search', am: 512, amStart: 5, taskMb: 512, executors: 0, stages, rowsIn: lines.length, rowsOut: rows.length, out };
      counters = [`Map input records=${lines.length}`, `Map output records=${mapOut}`, `Reduce output records=${rows.length}`];
    } else if (tpl.id === 'mr-pi') {
      const maps = Number(v.maps), samples = Number(v.samples);
      const pi = (4 * Math.round(Math.PI / 4 * maps * samples + (Math.random() - .5) * Math.sqrt(maps * samples))) / (maps * samples);
      def = { type: 'MAPREDUCE', name: 'QuasiMonteCarlo', am: 512, amStart: 5, taskMb: 512, executors: 0, rowsIn: maps,
        stages: [{ id: 'map', name: 'Map', description: `Cada map tira ${n(samples)} puntos al azar y cuenta cuántos caen en el círculo`, dependsOn: [], durSec: 2 + samples / 20000, n: maps, ops: ['SequenceFileInputFormat', 'QmcMapper'] },
          { id: 'reduce', name: 'Reduce', description: 'Junta los conteos de todos los maps', dependsOn: ['map'], edge: 'shuffle + sort', durSec: 2, n: 1, ops: ['QmcReducer'] }] };
      counters = [`Map input records=${maps}`, `Map output records=${maps * 2}`, `Reduce output records=0`];
      result = `Estimated value of Pi is ${pi.toFixed(20)}`;
    } else {
      const parts = Number(v.partitions);
      const pi = 4 * (Math.PI / 4 + (Math.random() - .5) * .002);
      def = { type: 'SPARK', name: 'Spark Pi', am: 1024, amStart: 10, taskMb: 0, executors: 2,
        stages: [{ id: 's0', name: 'Stage 0', description: `reduce at SparkPi.scala: ${parts} tarea${parts > 1 ? 's' : ''}, una por partición`, dependsOn: [], durSec: 1.5, n: parts, ops: ['parallelize', 'map', 'reduce'] }] };
      result = `Pi is roughly ${pi.toFixed(5)}`;
    }
    let id = '';
    id = e.submitApp(def, {
      command: shown, input: input ? `${input} · ${nb} bloque${nb > 1 ? 's' : ''}` : 'sin entrada en HDFS (genera los datos)',
      onDone: () => {
        const a = e.jobs.find(x => x.id === id);
        if (!a) return;
        if (counters.length) { e.alog(a, 'Counters: ' + counters.length); counters.forEach(c => e.alog(a, `\t\t${c}`)); }
        if (out) {
          const part = `${out}/part-r-00000`;
          e.files = e.files.filter(f => f.path !== `${out}/part-00000`);
          e.putNow(part, result.length / 1048576, 128, 'MapReduce');
          e.putNow(`${out}/_SUCCESS`, 0, 128, 'MapReduce');
          store(e).set(part, result);
          e.emit({ type: 'hdfs', path: out });
          e.alog(a, `Job job_${TS}_${a.num} completed successfully · salida en ${out}`);
        } else {
          e.alog(a, result);
          if (def.type === 'MAPREDUCE') e.alog(a, `Job job_${TS}_${a.num} completed successfully`);
        }
      },
    });
    e.alog(e.jobs.find(x => x.id === id)!, `Comando: ${shown}`);
    return id;
  }
}
