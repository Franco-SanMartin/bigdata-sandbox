/* Cómo se cuenta la salud de la re-replicación, en un solo lugar para que el resumen de HDFS y el
   panel de la cola digan lo mismo. Un bloque sub-replicado no siempre se está copiando: si pide más
   copias que DataNodes vivos hay, no tiene adónde ir y el NameNode ni lo encola. */
import type { ReplicationState } from '../api/types';
import { plural } from './format';

export interface ReplicationView {
  k: 'ok' | 'run' | 'bad';
  /** Lo que va en el chip del panel */
  label: string;
  /** Sub-replicados que no tienen adónde copiarse */
  stuck: number;
  /** Sub-replicados que sí se pueden copiar (están o van a estar en la cola) */
  copying: number;
  /** Explicación cuando hay bloques trabados, para no dejar al alumno esperando algo que no pasa */
  note?: string;
  /** Texto de la tabla cuando la cola está vacía */
  empty: string;
  /** Texto corto para la tarjeta "Sub-replicados" */
  sub: string;
}

export function replicationView(r: ReplicationState): ReplicationView {
  const stuck = Math.min(r.noRoom ?? 0, r.underReplicated);
  const copying = r.underReplicated - stuck;
  const live = r.liveDataNodes;
  const running = r.tasks.some(t => t.state === 'running');
  const k: ReplicationView['k'] = r.missing ? 'bad' : r.underReplicated || r.tasks.length || r.stale.length ? 'run' : 'ok';
  const label = r.missing && !r.tasks.length ? 'bloques perdidos'
    : running ? 're-replicando'
    : r.tasks.length ? 'en cola'
    : r.stale.length ? 'esperando latidos'
    : r.underReplicated ? (r.noRoom === 0 ? 'por encolar' : 'faltan DataNodes')
    : 'sano';
  const pide = stuck === 1 ? 'pide' : 'piden';
  const porque = live != null ? `hay ${plural(live, 'DataNode vivo', 'DataNodes vivos')} y ${pide} más copias que eso` : `${pide} más copias que DataNodes vivos hay`;
  const note = stuck
    ? `${plural(stuck, 'bloque sub-replicado', 'bloques sub-replicados')} sin adónde copiarse: ${porque}. `
      + 'No entran a la cola: cada copia tiene que ir a un DataNode distinto. Se arregla prendiendo DataNodes o bajando la réplica.'
    : undefined;
  const empty = r.missing ? `${plural(r.missing, 'bloque')} sin ninguna copia: no hay de dónde copiar hasta que vuelva el DataNode`
    : stuck ? 'Cola vacía, pero no porque esté todo bien: lo que falta no tiene adónde copiarse (mirá el aviso de arriba)'
    : r.underReplicated ? 'Cola vacía por ahora: el NameNode encola lo que falta en el próximo latido'
    : 'Cola vacía: todos los bloques tienen las copias que piden';
  const sub = !r.underReplicated ? 'ninguno'
    : stuck === r.underReplicated ? 'sin adónde copiarse'
    : stuck ? `${stuck} sin adónde copiarse`
    : 'el NameNode los copia';
  return { k, label, stuck, copying, note, empty, sub };
}
