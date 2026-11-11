/* La vista Aula: qué color tiene cada lámpara y cómo se agrupan las PCs por fila (los racks). */
import type { AulaLampara, AulaMedida, AulaPc, AulaTarea } from '../api/types';
import { toCsv } from './csv';

export const LAMPARA: Record<AulaLampara, { k: 'ok' | 'run' | 'bad'; label: string; que: string }> = {
  sumandose: { k: 'run', label: 'Sumándose', que: 'se inscribió y está prendiendo su DataNode y su NodeManager' },
  arriba: { k: 'ok', label: 'Arriba', que: 'guarda bloques y corre trabajos' },
  'sin-respuesta': { k: 'run', label: 'Sin respuesta', que: 'dejó de mandar latidos: a los 40 s el NameNode la da por muerta' },
  caida: { k: 'bad', label: 'Caída', que: 'HDFS copia sus bloques en otras PCs y YARN reintenta sus tareas' },
};

/** Las PCs por fila (/fila1, /fila2...) en orden, y adentro por número. Las que no tienen fila
    (un nodo que no es pcNN) van al final, en "sin fila" */
export function filasDelAula(pcs: AulaPc[]): [string, AulaPc[]][] {
  const m = new Map<string, AulaPc[]>();
  for (const pc of pcs) {
    const f = pc.fila ?? 'sin fila';
    m.set(f, [...(m.get(f) ?? []), pc]);
  }
  const n = (f: string) => (/^\/fila(\d+)$/.exec(f) ? Number(/^\/fila(\d+)$/.exec(f)![1]) : Infinity);
  return [...m.entries()]
    .sort(([a], [b]) => n(a) - n(b) || a.localeCompare(b))
    .map(([f, xs]) => [f, [...xs].sort((a, b) => (a.numero ?? Infinity) - (b.numero ?? Infinity) || a.nodo.localeCompare(b.nodo))]);
}

/* ---------- El plano (el editor de la vista Aula) ---------- */

export interface Plano { filas: (string | null)[][] }

const numeroDe = (nodo: string) => Number(/^pc0*(\d+)$/.exec(nodo)?.[1] ?? NaN);

/** El plano de arranque: las PCs por número, porFila por fila (lo mismo que hace el script de topología sin plano) */
export function planoInicial(nodos: string[], porFila = 5, lugares = 6): Plano {
  const pcs = nodos.filter(n => Number.isFinite(numeroDe(n))).sort((a, b) => numeroDe(a) - numeroDe(b));
  const nFilas = Math.max(2, Math.ceil((Math.max(0, ...pcs.map(numeroDe)) || 1) / porFila));
  const filas: (string | null)[][] = Array.from({ length: Math.min(8, nFilas) }, () => Array(Math.max(lugares, porFila)).fill(null));
  for (const n of pcs) {
    const i = Math.floor((numeroDe(n) - 1) / porFila);
    if (i < filas.length) filas[i][(numeroDe(n) - 1) % porFila] = n;
  }
  return { filas };
}

/** Pone una PC en un lugar (sacándola de donde estaba); si el lugar estaba ocupado, la otra PC va a la bandeja */
export function moverEnPlano(p: Plano, nodo: string, fila: number, lugar: number): Plano {
  const filas = p.filas.map(f => f.map(x => (x === nodo ? null : x)));
  if (fila >= 0 && fila < filas.length && lugar >= 0 && lugar < filas[fila].length) filas[fila][lugar] = nodo;
  return { filas };
}

export const sacarDelPlano = (p: Plano, nodo: string): Plano => ({ filas: p.filas.map(f => f.map(x => (x === nodo ? null : x))) });

export function cambiarForma(p: Plano, filas: number, lugares: number): Plano {
  const f = Math.max(1, Math.min(8, filas)), l = Math.max(1, Math.min(12, lugares));
  return { filas: Array.from({ length: f }, (_, i) => Array.from({ length: l }, (_, j) => p.filas[i]?.[j] ?? null)) };
}

/** Las PCs que están en el aula pero no en el plano (la bandeja "sin ubicar") */
export function sinUbicar(p: Plano, nodos: string[]): string[] {
  const en = new Set(p.filas.flat().filter(Boolean));
  return nodos.filter(n => !en.has(n)).sort((a, b) => numeroDe(a) - numeroDe(b));
}

/** El rack de cada PC según el plano: { pc07: '/fila2' } */
export function racksDelPlano(p: Plano | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (p?.filas ?? []).forEach((f, i) => f.forEach(x => { if (x) out[x] = `/fila${i + 1}`; }));
  return out;
}

/** Leer un plano-aula.json (exportado de otra clase): valida la forma, no las PCs */
export function leerPlano(texto: string): Plano {
  const v = JSON.parse(texto) as unknown;
  const filas = (v as { filas?: unknown })?.filas;
  if (!Array.isArray(filas) || !filas.length || filas.length > 8 || !filas.every(f => Array.isArray(f) && f.length >= 1 && f.length <= 12
    && f.every(x => x === null || (typeof x === 'string' && /^pc\d{1,3}$/.test(x))))) {
    throw new Error('no es un plano del aula: {"filas": [["pc01", null, ...], ...]} con hasta 8 filas de 12 lugares');
  }
  return { filas: filas as (string | null)[][] };
}

/* ---------- Los opcionales: localidad, colas por grupo y escala ---------- */

export type Resalte = 'bloque' | 'corrio' | 'ambos';

/** Qué se prende en el plano al pasar por una tarea: las PCs con una copia de su bloque y la PC donde corrió */
export function resalteDeTarea(t: AulaTarea | null | undefined): Record<string, Resalte> {
  const out: Record<string, Resalte> = {};
  if (!t) return out;
  for (const n of t.bloque ?? []) out[n] = 'bloque';
  if (t.corrio) out[t.corrio] = out[t.corrio] ? 'ambos' : 'corrio';
  return out;
}

const GRUPO_RE = /^[a-z][a-z0-9_]{0,19}$/;
export const GRUPOS_MAX = 12;

/** Los grupos que escribió el profe ("grupo1, grupo2 ..."), con las mismas reglas que el maestro */
export function leerGrupos(texto: string): { grupos: string[]; error?: string } {
  const grupos: string[] = [];
  for (const x of texto.split(/[\s,;]+/).filter(Boolean)) {
    const n = x.toLowerCase();
    if (!GRUPO_RE.test(n) || n === 'default' || n === 'root') {
      return { grupos, error: `${x} no sirve de nombre de grupo: letras, números y _ (hasta 20), sin default ni root` };
    }
    if (grupos.includes(n)) return { grupos, error: `El grupo ${n} está dos veces` };
    grupos.push(n);
  }
  if (grupos.length > GRUPOS_MAX) return { grupos, error: `Hasta ${GRUPOS_MAX} grupos` };
  return { grupos };
}

/** Las medidas del botón «medir» en CSV, por trabajo y cantidad de PCs (para graficarlas en una planilla) */
export function escalaCsv(medidas: AulaMedida[]): string {
  const ms = [...medidas].sort((a, b) => a.trabajo.localeCompare(b.trabajo) || a.pcs - b.pcs || a.inicio - b.inicio);
  return toCsv(['trabajo', 'pcs', 'segundos', 'estado', 'memoria_mb', 'cores', 'cambiaron_pcs', 'app', 'inicio'],
    ms.map(m => [m.trabajo, m.pcs, m.segundos ?? null, m.estado, m.mb, m.vcores, m.cambiaron ? 'si' : 'no', m.app, new Date(m.inicio).toISOString()]));
}
