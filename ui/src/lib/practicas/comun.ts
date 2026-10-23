/* Piezas que repiten los catálogos: tablas de un ls, esperar un trabajo, armar la salida de una consulta. */
import type { AppState, ClusterStatus, DataSource, HdfsEntry, HdfsListing, QueryResult, YarnAppDetail } from '../../api/types';
import { errorCode } from '../../api/errors';
import { mbLabel } from '../format';
import type { Capability } from '../capabilities';
import { waitFor } from './motor';
import type { Check, Requirement, StepCtx, StepOut, StepResult } from './tipos';

export const VENTAS_DIR = '/user/root/ventas';
export const VENTAS_FILE = `${VENTAS_DIR}/ventas_grandes.csv`;

/** hdfs dfs -ls como tabla */
export function lsOut(l: HdfsListing): StepOut {
  return {
    kind: 'table', columns: ['tipo', 'nombre', 'tamaño', 'réplicas', 'estado'],
    rows: l.entries.map(e => [e.type === 'dir' ? 'carpeta' : 'archivo', e.name, e.type === 'file' ? mbLabel(e.sizeMb ?? 0) : '', e.replication ?? '', e.state ?? '']),
  };
}

/** La entrada de una carpeta, o null si la carpeta o la entrada no existen */
export async function entry(c: StepCtx, dir: string, name: string): Promise<HdfsEntry | null> {
  try {
    return (await c.api.hdfsList(dir)).entries.find(e => e.name === name) ?? null;
  } catch (e) {
    if (errorCode(e) === 'not_found') return null;
    throw e;
  }
}

/** Sube un ejemplo si no está y espera a que termine de escribirse */
export async function ensureExample(c: StepCtx, dir: string, name: string, example: 'ventas' | 'texto'): Promise<StepResult> {
  const had = await entry(c, dir, name);
  let trace;
  if (!had) trace = (await c.api.hdfsUpload({ dest: dir, example })).trace;
  const w = await waitFor(c, () => entry(c, dir, name), e => !!e && e.state !== 'writing',
    { seconds: 240, every: 2000, what: `Esperando a que ${name} termine de escribirse en HDFS…` });
  if (!w.ok) throw new Error(`${name} todavía se está escribiendo: probá Verificar en un rato`);
  const e = w.value!;
  return {
    summary: had ? `${dir}/${name} ya estaba: ${mbLabel(e.sizeMb ?? 0)} en ${e.blocks ?? '?'} bloque(s)` : `Subido ${dir}/${name}: ${mbLabel(e.sizeMb ?? 0)} en ${e.blocks ?? '?'} bloque(s) × ${e.replication} copia(s)`,
    trace, link: { label: 'Ver en HDFS', page: 'hdfs', arg: `${dir}/${name}` },
  };
}

export async function fileCheck(c: StepCtx, dir: string, name: string): Promise<Check> {
  const e = await entry(c, dir, name);
  if (!e) return { ok: false, detail: `No está ${dir}/${name}` };
  if (e.state === 'writing') return { ok: false, detail: `${name} todavía se está escribiendo` };
  return { ok: true, detail: `${dir}/${name}: ${mbLabel(e.sizeMb ?? 0)}, réplica ${e.replication}` };
}

const ENDED: AppState[] = ['FINISHED', 'FAILED', 'KILLED'];

/** Espera a que un trabajo de YARN termine. Tira si falla o si no termina a tiempo */
export async function waitApp(c: StepCtx, id: string, seconds = 300): Promise<YarnAppDetail> {
  const w = await waitFor(c, () => c.api.app(id), a => ENDED.includes(a.state),
    { seconds, every: 2500, what: `Esperando a que termine ${id}…` });
  const a = w.value;
  if (!w.ok) throw new Error(`${id} sigue en ${a.state} (${Math.round(a.progress * 100)} %): miralo en Trabajos y probá Verificar cuando termine`);
  if (a.state !== 'FINISHED') throw new Error(`${id} terminó en ${a.state}${a.diagnostics ? `: ${a.diagnostics}` : ''}`);
  return a;
}

export function appResult(a: YarnAppDetail, extra = ''): StepResult {
  const pick = a.counters.filter(x => /MAP_INPUT_RECORDS|REDUCE_OUTPUT_RECORDS|HDFS_BYTES_READ|HDFS_BYTES_WRITTEN|recordsRead|recordsWritten/i.test(x.name)).slice(0, 6);
  const secs = a.finishedAt && a.startedAt ? Math.round((a.finishedAt - a.startedAt) / 1000) : null;
  return {
    summary: `${a.id} terminó bien${secs != null ? ` en ${secs} s` : ''}${extra}`,
    out: { kind: 'kv', items: [['Motor', a.engine], ['Estado', a.state], ...(a.outputPath ? [['Salida', a.outputPath] as [string, string]] : []), ...pick.map(x => [x.name, x.value.toLocaleString('es-AR')] as [string, string])] },
    trace: a.trace, link: { label: 'Ver el trabajo', page: 'yarn', arg: a.id },
  };
}

export async function appCheck(c: StepCtx, key: string): Promise<Check> {
  const id = c.vars[key];
  if (!id) return { ok: false, detail: 'Todavía no se lanzó el trabajo (paso anterior)' };
  const a = await c.api.app(id);
  return { ok: a.state === 'FINISHED', detail: `${id}: ${a.state}` };
}

/** Corre una consulta y la devuelve como resultado de paso */
export async function runQuery(c: StepCtx, source: DataSource, text: string): Promise<StepResult & { rows: QueryResult['rows'] }> {
  const r = await c.api.query(source, text);
  const n = r.rows.length;
  return {
    rows: r.rows,
    summary: `${n} fila${n === 1 ? '' : 's'} en ${(r.ms / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} s${r.appId ? ` · lanzó ${r.appId} en ${r.engine ?? 'YARN'}` : ''}${r.note ? ` · ${r.note}` : ''}`,
    out: { kind: 'table', columns: r.columns, rows: r.rows },
    trace: r.trace, vars: r.appId ? { [`app.${source}`]: r.appId } : undefined,
    link: r.appId ? { label: 'Ver el trabajo', page: 'yarn', arg: r.appId } : { label: 'Abrir en Consultas', page: 'datos' },
  };
}

/** Que el resultado tenga filas y (si se pide) que alguna celda contenga un texto */
export function rowsCheck(rows: QueryResult['rows'], opts: { min?: number; has?: string } = {}): Check {
  const min = opts.min ?? 1;
  if (rows.length < min) return { ok: false, detail: `Dio ${rows.length} fila(s), se esperaban ${min} o más` };
  if (opts.has && !rows.some(r => r.some(x => String(x).toLowerCase().includes(opts.has!.toLowerCase()))))
    return { ok: false, detail: `No aparece "${opts.has}" en el resultado` };
  return { ok: true, detail: `${rows.length} fila(s)${opts.has ? `, incluye "${opts.has}"` : ''}` };
}

const dnUp = (s: ClusterStatus) => s.processes.filter(p => p.kind === 'datanode' && p.state === 'up').length;

/** Hacen falta al menos n DataNodes configurados (con el arreglo: subir DATANODES) */
export const needDataNodes = (n: number): Requirement => (s: ClusterStatus): Capability | null =>
  s.config.datanodes >= n ? null
    : { id: 'hdfs.write', state: 'blocked', reason: `Hacen falta ${n} DataNodes y la configuración tiene ${s.config.datanodes}`, fix: { kind: 'config', change: { datanodes: n } }, fixLabel: `Aplicar ${n} DataNodes` };

export { dnUp };
