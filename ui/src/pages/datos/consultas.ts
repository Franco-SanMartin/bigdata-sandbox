/* Lo que el editor de consultas (Lenguajes y Bases) guarda en el navegador: los documentos abiertos,
   el historial (las últimas 50) y las consultas guardadas. Funciones puras + localStorage.
   Las dos pantallas comparten las mismas listas y cada una muestra las de sus motores. */
import type { DataSource } from '../../api/types';

export const SOURCES: DataSource[] = ['hive', 'mysql', 'mongodb', 'pig'];
export const SOURCE_LABEL: Record<DataSource, string> = { hive: 'Hive', mysql: 'MariaDB', mongodb: 'MongoDB', pig: 'Pig' };
export const HISTORY_MAX = 50;

/** Lo que va en la ruta para cada motor: #lenguajes/pig, #bases/mariadb */
export const SOURCE_ARG: Record<DataSource, string> = { hive: 'hive', pig: 'pig', mysql: 'mariadb', mongodb: 'mongodb' };
export const argSource = (arg: string): DataSource | undefined =>
  (Object.keys(SOURCE_ARG) as DataSource[]).find(s => SOURCE_ARG[s] === arg.split('/')[0] || s === arg.split('/')[0]);

/** Una consulta para abrir al llegar al editor (desde Tablas: "Consultarla en Hive"). Se consume una sola vez */
let pendiente: { source: DataSource; text: string; title?: string } | null = null;
export const dejarParaAbrir = (source: DataSource, text: string, title?: string) => { pendiente = { source, text, title }; };
export function tomarPendiente(sources: DataSource[]) {
  if (!pendiente || !sources.includes(pendiente.source)) return null;
  const p = pendiente;
  pendiente = null;
  return p;
}

export interface QueryDoc { id: string; title: string; source: DataSource; text: string }
export interface HistoryEntry { source: DataSource; text: string; at: number; ok: boolean; rows?: number; ms?: number; error?: string }
export interface SavedQuery { id: string; name: string; source: DataSource; text: string; at: number }

const KEY = { docs: 'consultas.docs', history: 'consultas.historial', saved: 'consultas.guardadas' };

let seq = 0;
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Documento nuevo: "Consulta N" con el primer número libre */
export function newDoc(docs: QueryDoc[], source: DataSource, text = '', title?: string): QueryDoc {
  if (title) return { id: newId(), title, source, text };
  const used = new Set(docs.map(d => d.title));
  let i = 1;
  while (used.has(`Consulta ${i}`)) i++;
  return { id: newId(), title: `Consulta ${i}`, source, text };
}

/** Suma una corrida al historial: la más nueva arriba, sin repetir la misma consulta seguida, hasta HISTORY_MAX */
export function pushHistory(list: HistoryEntry[], e: HistoryEntry, max = HISTORY_MAX): HistoryEntry[] {
  const same = (x: HistoryEntry) => x.source === e.source && x.text.trim() === e.text.trim();
  return [e, ...list.filter(x => !same(x))].slice(0, max);
}

/** Guarda (o pisa, si ya hay una con ese nombre en el mismo motor) una consulta */
export function addSaved(list: SavedQuery[], q: Omit<SavedQuery, 'id' | 'at'>, at = Date.now()): SavedQuery[] {
  const name = q.name.trim() || 'Sin nombre';
  const prev = list.find(x => x.source === q.source && x.name === name);
  const item: SavedQuery = { id: prev?.id ?? newId(), name, source: q.source, text: q.text, at };
  return [item, ...list.filter(x => x !== prev)];
}

export const removeSaved = (list: SavedQuery[], id: string) => list.filter(x => x.id !== id);

/** Nombre sugerido para guardar: la primera línea con algo, recortada */
export function suggestName(text: string): string {
  const line = text.split('\n').map(l => l.replace(/^\s*(--|\/\/)\s*/, '').trim()).find(Boolean) ?? '';
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}

/** Lo que se carga al hacer clic en una tabla del catálogo */
export function starter(source: DataSource, name: string): string {
  const short = name.split('.').slice(1).join('.') || name;
  return source === 'mongodb' ? `db.${short}.find().limit(100)` : `SELECT * FROM ${name} LIMIT 100;`;
}

const isSource = (s: unknown): s is DataSource => typeof s === 'string' && (SOURCES as string[]).includes(s);

function read<T>(key: string, ok: (x: unknown) => x is T, store: Storage | undefined): T[] {
  try {
    const v = JSON.parse(store?.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter(ok) : [];
  } catch { return []; }
}
function write(key: string, v: unknown, store: Storage | undefined) {
  try { store?.setItem(key, JSON.stringify(v)); } catch { /* sin lugar o bloqueado: queda solo en memoria */ }
}
const local = (): Storage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

const okDoc = (x: unknown): x is QueryDoc => { const d = x as QueryDoc; return !!d && typeof d.id === 'string' && typeof d.title === 'string' && typeof d.text === 'string' && isSource(d.source); };
const okHist = (x: unknown): x is HistoryEntry => { const h = x as HistoryEntry; return !!h && typeof h.text === 'string' && typeof h.at === 'number' && isSource(h.source); };
const okSaved = (x: unknown): x is SavedQuery => { const q = x as SavedQuery; return !!q && typeof q.id === 'string' && typeof q.name === 'string' && typeof q.text === 'string' && isSource(q.source); };

export const loadDocs = (store = local()) => read(KEY.docs, okDoc, store);
export const saveDocs = (v: QueryDoc[], store = local()) => write(KEY.docs, v, store);
export const loadHistory = (store = local()) => read(KEY.history, okHist, store).slice(0, HISTORY_MAX);
export const saveHistory = (v: HistoryEntry[], store = local()) => write(KEY.history, v.slice(0, HISTORY_MAX), store);
export const loadSaved = (store = local()) => read(KEY.saved, okSaved, store);
export const saveSaved = (v: SavedQuery[], store = local()) => write(KEY.saved, v, store);

/** "hace 3 min", "ayer 14:05"… para el historial */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  const d = new Date(at);
  const hm = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  if (s < 86400 && new Date(now).getDate() === d.getDate()) return `hoy ${hm}`;
  return `${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${hm}`;
}
