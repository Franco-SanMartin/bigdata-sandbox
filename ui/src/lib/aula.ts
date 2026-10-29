/* La vista Aula: qué color tiene cada lámpara y cómo se agrupan las PCs por fila (los racks). */
import type { AulaLampara, AulaPc } from '../api/types';

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
