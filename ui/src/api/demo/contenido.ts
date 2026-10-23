/* El contenido de los archivos del modo demo: lo que subiste desde tu compu (el archivo de verdad),
   lo que escribieron los trabajos (texto calculado) o, para los ejemplos, filas de muestra repetidas
   hasta el tamaño del archivo. */
import type { DemoEngine } from './engine';
import { TEXTO, previewFor } from './common';

export interface Source {
  total: number;
  binary: boolean;
  /** Un tramo del contenido */
  read(offset: number, length: number): Promise<string>;
  /** Todo, para bajarlo */
  blob(): Blob;
}

/** Texto escrito por un trabajo, el archivo que subiste, o de qué ruta viene un archivo movido */
type Kept = string | Blob | { from: string };
const stores = new WeakMap<DemoEngine, Map<string, Kept>>();
export const store = (e: DemoEngine) => { let m = stores.get(e); if (!m) stores.set(e, m = new Map()); return m; };

/** Para los archivos generados: el demo cuenta caracteres como bytes (es texto ASCII) */
const fromText = (s: string): Source => ({
  total: s.length, binary: false,
  read: (o, n) => Promise.resolve(s.slice(o, o + n)),
  blob: () => new Blob([s], { type: 'text/plain' }),
});

/** Encabezado + un ciclo de filas repetido hasta total bytes */
function repeated(head: string, cycle: string, total: number): Source {
  const at = (o: number, n: number) => {
    let out = '';
    if (o < head.length) { out = head.slice(o, o + n); o = head.length; }
    while (out.length < n && o < total) {
      const k = (o - head.length) % cycle.length;
      const piece = cycle.slice(k, k + Math.min(n - out.length, total - o));
      out += piece; o += piece.length;
    }
    return out;
  };
  return { total, binary: false, read: (o, n) => Promise.resolve(at(o, n)), blob: () => new Blob([at(0, total)], { type: 'text/plain' }) };
}

export const MAX_DOWNLOAD = 32 * 1048576;

export function sourceOf(e: DemoEngine, path: string, sizeMb: number): Source {
  const total = Math.round(sizeMb * 1048576);
  const kept = store(e).get(path);
  if (typeof kept === 'string') return fromText(kept);
  if (kept && 'from' in kept) path = kept.from;
  else if (kept) {
    const b = kept;
    return {
      total: b.size, binary: false,
      read: async (o, n) => b.slice(o, o + n).text(),
      blob: () => b,
    };
  }
  if (path === '/user/root/texto.txt') return fromText(TEXTO.join('\n') + '\n');
  if (path.startsWith('/apps/') || path.endsWith('.parquet') || path.endsWith('.jar') || path.endsWith('.gz')) {
    return { total, binary: true, read: () => Promise.resolve(''), blob: () => new Blob([new Uint8Array(Math.min(total, MAX_DOWNLOAD))]) };
  }
  if (path.endsWith('/_SUCCESS')) return fromText('');
  const s = previewFor(path);
  if (!s.rows.length) return fromText(`${s.note || 'Sin contenido'} (modo demo)\n`);
  const csv = /csv/.test(s.format || '');
  const row = (r: unknown[]) => r.map(c => (c == null ? '' : String(c))).join(csv ? ',' : '\t') + '\n';
  const head = csv && !/sqoop/.test(s.format || '') ? s.columns.join(',') + '\n' : '';
  const cycle = s.rows.map(row).join('');
  // Resultados chicos (part-00000 de un trabajo): las filas, sin repetir
  if (total < 4096 || s.rows.length >= (s.total ?? Infinity)) return fromText(head + cycle);
  return repeated(head, cycle, Math.max(total, head.length + cycle.length));
}
