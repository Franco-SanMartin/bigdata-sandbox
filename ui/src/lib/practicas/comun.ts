/* Piezas que repiten los catálogos: tablas de un ls, esperar un trabajo, armar la salida de una consulta. */
import type { ActionRun, AppLogs, AppState, ClusterStatus, DataSource, HdfsEntry, HdfsListing, QueryResult, SubmitJobRequest, YarnAppDetail } from '../../api/types';
import { errorCode, fail } from '../../api/errors';
import { mbLabel as mbFmt } from '../format';
import type { Capability } from '../capabilities';
import { notThere, waitFor } from './motor';
import type { Check, RawOut, Requirement, StepCtx, StepOut, StepResult } from './tipos';

/** Tamaño legible: los archivos chicos (texto.txt) en KB en vez de "0,0 MB" */
export const mbLabel = (mb: number) => (mb > 0 && mb < 0.1 ? `${Math.max(1, Math.round(mb * 1024)).toLocaleString('es-AR')} KB` : mbFmt(mb));

export const VENTAS_DIR = '/user/root/ventas';
export const VENTAS_FILE = `${VENTAS_DIR}/ventas_grandes.csv`;

/* ---------- Salida cruda (lo que se vería en la terminal) ---------- */

type RawLine = RawOut['lines'][number];

/** Un texto como líneas de stdout (o stderr) */
export const textLines = (text: string, stream: RawLine['stream'] = 'out'): RawLine[] =>
  text === '' ? [] : text.replace(/\n$/, '').split('\n').map(t => ({ stream, text: t }));

/** Salida armada con lo que respondió el servicio. Sin command, el motor le pone el del paso */
export const armada = (lines: RawLine[], nota?: string, command = ''): RawOut =>
  ({ command, lines, exitCode: 0, origen: 'armada', ...(nota ? { nota } : {}) });

/** En el demo no corre ningún proceso: lo que se ve es simulado */
const DEMO = 'Modo demo: salida simulada con el mismo formato que la terminal';

/** Lo que imprimió una acción del servidor (mkdir, put, setrep, datanode start…). En el demo, o si el
    servidor ya no la tiene, una salida armada con la nota de por qué */
export async function actionRaw(c: StepCtx, id: string | undefined, fallback: RawLine[] = []): Promise<RawOut> {
  if (!id || c.api.mode === 'demo') return armada(fallback, c.api.mode === 'demo' ? DEMO : undefined);
  try {
    return runRaw(await c.api.action(id));
  } catch (e) {
    if (notThere(e) || errorCode(e) === 'not_found') return armada(fallback, 'El servidor ya no guarda la salida de esta acción');
    throw e;
  }
}

export const runRaw = (r: ActionRun): RawOut => ({
  command: r.command,
  lines: r.lines.map(l => ({ stream: l.stream === 'err' || l.stream === 'stderr' ? 'err' : 'out', text: l.text })),
  ...(r.exitCode != null ? { exitCode: r.exitCode } : r.state === 'done' ? { exitCode: 0 } : {}),
  origen: 'proceso',
});

/** Espera, sin apurar al servidor, a que termine una acción (un setrep -w, un datanode start…) */
export async function waitAction(c: StepCtx, id: string, seconds: number, what: string): Promise<ActionRun | null> {
  try {
    const w = await waitFor(c, () => c.api.action(id), r => r.state !== 'running', { seconds, what });
    return w.value;
  } catch (e) {
    if (notThere(e) || errorCode(e) === 'not_found') return null;
    throw e;
  }
}

/** La salida de un fsck: la del comando en el servidor, simulada en el demo */
export const fsckRaw = (c: StepCtx, raw: string[]): RawOut =>
  c.api.mode === 'demo' ? armada(raw.map(text => ({ stream: 'out', text })), DEMO)
    : { command: '', lines: raw.map(text => ({ stream: text.startsWith('Connecting to namenode') ? 'err' : 'out', text })), origen: 'proceso' };

const pad = (n: number) => String(n).padStart(2, '0');
const lsDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** hdfs dfs -ls como lo imprime la terminal (armado con lo que respondió WebHDFS) */
export function lsRaw(c: StepCtx, l: HdfsListing): RawOut {
  const rows = l.entries.map(e => {
    const perm = e.permission.length === 10 ? e.permission : `${e.type === 'dir' ? 'd' : '-'}${e.permission}`;
    const bytes = e.type === 'file' ? Math.round((e.sizeMb ?? 0) * 1024 * 1024) : 0;
    const path = `${l.path.replace(/\/$/, '')}/${e.name}${e.state === 'writing' ? '._COPYING_' : ''}`;
    return `${perm}   ${e.type === 'file' ? (e.replication ?? '-') : '-'} ${e.owner} ${e.group} ${String(bytes).padStart(10)} ${lsDate(e.modifiedAt)} ${path}`;
  });
  return armada(textLines([`Found ${l.entries.length} items`, ...rows].join('\n')), c.api.mode === 'demo' ? DEMO : 'Armada con lo que respondió WebHDFS (LISTSTATUS), con el formato de hdfs dfs -ls');
}

/** Una tabla como la imprime el cliente en modo batch (columnas separadas por tabulador) */
export const tableLines = (columns: string[], rows: QueryResult['rows']): RawLine[] =>
  [columns.join('\t'), ...rows.map(r => r.map(x => (x == null ? 'NULL' : String(x))).join('\t'))].map(text => ({ stream: 'out', text }));

/** La salida de una consulta: la del cliente (beeline, mysql, pig) si el servidor la manda; si no, armada */
export function queryRaw(c: StepCtx, r: QueryResult): RawOut {
  if (r.raw && c.api.mode !== 'demo') return { command: '', lines: r.raw, exitCode: 0, origen: 'proceso' };
  return armada(tableLines(r.columns, r.rows.slice(0, 50)), c.api.mode === 'demo' ? DEMO : 'Armada con el resultado de la consulta');
}

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
  let up;
  if (!had) up = await c.api.hdfsUpload({ dest: dir, example });
  const w = await waitFor(c, () => entry(c, dir, name), e => !!e && e.state !== 'writing',
    { seconds: 240, what: `Esperando a que ${name} termine de escribirse en HDFS…` });
  if (!w.ok) throw new Error(`${name} todavía se está escribiendo: probá Verificar en un rato`);
  const e = w.value!;
  const raw = had ? armada([], 'No corrió nada: el archivo ya estaba en HDFS') : await actionRaw(c, up?.id);
  return {
    summary: had ? `${dir}/${name} ya estaba: ${mbLabel(e.sizeMb ?? 0)} en ${e.blocks ?? '?'} bloque(s)` : `Subido ${dir}/${name}: ${mbLabel(e.sizeMb ?? 0)} en ${e.blocks ?? '?'} bloque(s) × ${e.replication} copia(s)`,
    trace: up?.trace, raw, link: { label: 'Ver en HDFS', page: 'hdfs', arg: `${dir}/${name}` },
  };
}

export async function fileCheck(c: StepCtx, dir: string, name: string): Promise<Check> {
  const e = await entry(c, dir, name);
  if (!e) return { ok: false, detail: `No está ${dir}/${name}` };
  if (e.state === 'writing') return { ok: false, detail: `${name} todavía se está escribiendo` };
  return { ok: true, detail: `${dir}/${name}: ${mbLabel(e.sizeMb ?? 0)}, réplica ${e.replication}` };
}

/** Lanza una plantilla de trabajo. Si el servidor no tiene plantillas (o no esa), contesta unsupported */
export async function submitTemplate(c: StepCtx, template: string, params: SubmitJobRequest['params']): Promise<string> {
  let ids: string[];
  try {
    ids = (await c.api.jobTemplates()).map(t => t.id);
  } catch (e) {
    if (notThere(e)) fail('unsupported', 'Lanzar trabajos todavía no está en este servidor');
    throw e;
  }
  if (!ids.includes(template)) fail('unsupported', `${template}: este servidor no tiene esa plantilla`);
  return c.api.submitJob({ template, params });
}

const ENDED: AppState[] = ['FINISHED', 'FAILED', 'KILLED'];

/** Espera a que un trabajo de YARN termine. Tira si falla o si no termina a tiempo */
export async function waitApp(c: StepCtx, id: string, seconds = 300): Promise<YarnAppDetail> {
  const w = await waitFor(c, () => c.api.app(id), a => ENDED.includes(a.state),
    { seconds, what: `Esperando a que termine ${id}…` });
  const a = w.value;
  if (!w.ok) throw new Error(`${id} sigue en ${a.state} (${Math.round(a.progress * 100)} %): miralo en Trabajos y probá Verificar cuando termine`);
  if (a.state !== 'FINISHED') throw new Error(`${id} terminó en ${a.state}${a.diagnostics ? `: ${a.diagnostics}` : ''}`);
  return a;
}

/** Lo que imprimió el cliente que lanzó el trabajo (yarn jar, spark-submit): el servidor guarda las últimas líneas.
    Si el trabajo no lo lanzó la interfaz, o en el demo, solo hay el resumen de YARN */
export function appRaw(mode: 'demo' | 'live', a: YarnAppDetail): RawOut {
  const lines = a.log.map(l => ({ stream: (/^\d{2,4}[-/]\d\d[-/]\d\d.*\b(INFO|WARN|ERROR)\b/.test(l.text) || l.level !== 'INFO' ? 'err' : 'out') as RawLine['stream'], text: l.text }));
  const synthetic = !a.log.length || /^Aplicación enviada a la cola/.test(a.log[0].text);
  if (mode === 'demo') return armada(lines, DEMO, a.command);
  if (synthetic) return armada(lines, 'El trabajo no lo lanzó esta interfaz: es el resumen de YARN, no la salida del cliente', a.command);
  return { command: a.command, lines, origen: 'proceso', ...(a.state === 'FINISHED' ? { exitCode: 0 } : a.state === 'FAILED' || a.state === 'KILLED' ? { exitCode: 1 } : {}) };
}

const when = (ms?: number) => (ms ? String(ms) : '0');

/** yarn application -status como lo imprime la terminal (armado con lo que respondió el ResourceManager) */
export function statusRaw(mode: 'demo' | 'live', a: YarnAppDetail): RawOut {
  const final = a.state === 'FINISHED' ? 'SUCCEEDED' : a.state === 'FAILED' || a.state === 'KILLED' ? a.state : 'UNDEFINED';
  const rows: [string, string][] = [['Application-Id', a.id], ['Application-Name', a.name], ['Application-Type', a.type], ['User', a.user],
    ['Queue', a.queue], ['Start-Time', when(a.startedAt)], ['Finish-Time', when(a.finishedAt)], ['Progress', `${Math.round(a.progress * 100)}%`],
    ['State', a.state], ['Final-State', final], ['Tracking-URL', a.trackingUrl ?? 'N/A'], ['Diagnostics', a.diagnostics ?? '']];
  return armada(textLines(['Application Report : ', ...rows.map(([k, v]) => `\t${k} : ${v}`)].join('\n')),
    mode === 'demo' ? DEMO : 'Armada con lo que respondió el ResourceManager, con el formato de yarn application -status');
}

/** yarn logs: los archivos del contenedor mostrado, con el encabezado que pone yarn logs a cada uno */
export function logsRaw(mode: 'demo' | 'live', l: AppLogs, max = 40): RawOut {
  const lines = l.files.flatMap(f => [`Container: ${l.container}`, `LogType:${f.name}`, `LogLength:${f.lines.join('\n').length}`, 'Log Contents:',
    ...(f.lines.length > max ? [`… (${f.lines.length - max} líneas antes)`, ...f.lines.slice(-max)] : f.lines), `End of LogType:${f.name}`, '']);
  return armada(textLines(lines.join('\n')), mode === 'demo' ? DEMO : `Armada con los logs que guardó YARN del contenedor ${l.container}, con el formato de yarn logs`);
}

export function appResult(a: YarnAppDetail, extra = '', mode: 'demo' | 'live' = 'live'): StepResult {
  const pick = a.counters.filter(x => /MAP_INPUT_RECORDS|REDUCE_OUTPUT_RECORDS|HDFS_BYTES_READ|HDFS_BYTES_WRITTEN|recordsRead|recordsWritten/i.test(x.name)).slice(0, 6);
  const secs = a.finishedAt && a.startedAt ? Math.round((a.finishedAt - a.startedAt) / 1000) : null;
  return {
    summary: `${a.id} terminó bien${secs != null ? ` en ${secs} s` : ''}${extra}`,
    out: { kind: 'kv', items: [['Motor', a.engine], ['Estado', a.state], ...(a.outputPath ? [['Salida', a.outputPath] as [string, string]] : []), ...pick.map(x => [x.name, x.value.toLocaleString('es-AR')] as [string, string])] },
    trace: a.trace, raw: appRaw(mode, a), link: { label: 'Ver el trabajo', page: 'yarn', arg: a.id },
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
    raw: queryRaw(c, r),
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
