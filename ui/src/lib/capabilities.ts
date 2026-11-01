/* Qué se puede hacer ahora y, si no se puede, por qué y qué lo arregla.
   Función pura sobre el estado del cluster: la usan Inicio, los botones deshabilitados (Gated)
   y las pantallas para decidir qué mostrar. Ningún botón queda apagado sin pasar por acá. */
import type { ClusterConfig, ClusterStatus, Process } from '../api/types';
import type { PageId } from './route';

export type CapId =
  | 'cluster.start' | 'cluster.stop' | 'config.edit' | 'volume.reset'
  | 'hdfs.read' | 'hdfs.write' | 'yarn.submit' | 'mapreduce' | 'tez' | 'spark' | 'pig' | 'sqoop'
  | 'hive' | 'mysql' | 'mongodb' | 'pipeline' | 'ml.sklearn' | 'ml.mllib' | 'ha' | 'jupyter';

export type CapState = 'ready' | 'starting' | 'blocked';

/** La acción que destraba una capacidad. La ejecuta runFix (state/capabilities.ts) */
export type Fix =
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'wait' }
  | { kind: 'restart' }
  | { kind: 'reset-volume' }
  | { kind: 'process-start'; process: string }
  | { kind: 'config'; change: Partial<ClusterConfig> };

export interface Capability {
  id: CapId;
  state: CapState;
  /** Por qué no está lista (vacío si state = ready) */
  reason?: string;
  fix?: Fix;
  /** Rótulo del botón que ejecuta el fix */
  fixLabel?: string;
}

export type Capabilities = Record<CapId, Capability>;

/** Lo que muestra Inicio de cada capacidad: para qué sirve, en qué pantalla se usa y qué guía la trabaja */
export interface CapInfo { id: CapId; label: string; what: string; page: PageId; arg?: string; guide?: string }

export const CAP_INFO: CapInfo[] = [
  { id: 'hdfs.write', label: 'Subir y explorar HDFS', what: 'Subí archivos, mirá en qué DataNodes quedan sus bloques y cambiá la réplica.', page: 'hdfs', guide: '03' },
  { id: 'mapreduce', label: 'Trabajos MapReduce', what: 'Lanzá WordCount, Pi o tus ventas en YARN y seguí sus contenedores.', page: 'yarn', guide: '04' },
  { id: 'pig', label: 'Pig Latin', what: 'LOAD, FILTER, GROUP y DUMP sobre archivos de HDFS.', page: 'lenguajes', arg: 'pig', guide: '05' },
  { id: 'hive', label: 'Consultas en Hive', what: 'SQL sobre HDFS con tablas externas; las consultas pesadas corren en Tez.', page: 'lenguajes', arg: 'hive', guide: '06' },
  { id: 'mysql', label: 'MariaDB (tienda)', what: 'La base relacional de origen: SELECT, JOIN y Sqoop hacia HDFS.', page: 'bases', arg: 'mariadb', guide: '07' },
  { id: 'spark', label: 'Spark', what: 'El mismo cálculo en memoria: DAG de etapas y Spark History.', page: 'yarn', guide: '08' },
  { id: 'ha', label: 'Alta disponibilidad', what: 'Apagá el NameNode activo y mirá cómo ZooKeeper elige otro.', page: 'cluster', guide: '09' },
  { id: 'mongodb', label: 'MongoDB', what: 'Documentos, find, aggregate e índices.', page: 'bases', arg: 'mongodb', guide: '10' },
  { id: 'pipeline', label: 'Pipeline completo', what: 'De la base al tablero: ingesta, ETL, almacén, análisis y modelo.', page: 'pipeline' },
  { id: 'ml.sklearn', label: 'Machine Learning', what: 'Entrená regresión, clasificación o clustering y compará métricas.', page: 'ml', guide: '11' },
  { id: 'jupyter', label: 'JupyterLab', what: 'Notebooks con PySpark y pandas contra el cluster.', page: 'cluster' },
];

/** Capacidades que la interfaz todavía no implementa (las saca el paquete que las agrega) */
export const NOT_YET: Partial<Record<CapId, string>> = {};

const ALL: CapId[] = ['cluster.start', 'cluster.stop', 'config.edit', 'volume.reset', 'hdfs.read', 'hdfs.write', 'yarn.submit',
  'mapreduce', 'tez', 'spark', 'pig', 'sqoop', 'hive', 'mysql', 'mongodb', 'pipeline', 'ml.sklearn', 'ml.mllib', 'ha', 'jupyter'];

const ready = (id: CapId): Capability => ({ id, state: 'ready' });
const blocked = (id: CapId, reason: string, fix?: Fix, fixLabel?: string): Capability => ({ id, state: 'blocked', reason, fix, fixLabel });

/** Lo que necesita cada capacidad: configuración y procesos */
interface Need { services?: 'mapreduce' | 'todo'; mongodb?: boolean; jupyter?: boolean; ha?: boolean; procs: string[]; hdfs?: 'read' | 'write' }
const NEEDS: Partial<Record<CapId, Need>> = {
  'hdfs.read': { procs: [], hdfs: 'read' },
  'hdfs.write': { procs: [], hdfs: 'write' },
  'yarn.submit': { services: 'mapreduce', procs: ['rm', 'nm'], hdfs: 'write' },
  mapreduce: { services: 'mapreduce', procs: ['rm', 'nm'], hdfs: 'write' },
  sqoop: { services: 'mapreduce', procs: ['rm', 'nm', 'mysql'], hdfs: 'write' },
  mysql: { services: 'mapreduce', procs: ['mysql'] },
  pig: { services: 'mapreduce', procs: ['rm', 'nm'], hdfs: 'write' },
  tez: { services: 'todo', procs: ['rm', 'nm', 'metastore', 'hiveserver2'], hdfs: 'write' },
  hive: { services: 'todo', procs: ['metastore', 'hiveserver2'], hdfs: 'read' },
  spark: { services: 'todo', procs: ['rm', 'nm'], hdfs: 'write' },
  'ml.mllib': { services: 'todo', procs: ['rm', 'nm'], hdfs: 'read' },
  'ml.sklearn': { procs: [], hdfs: 'read' },
  pipeline: { services: 'mapreduce', procs: ['rm', 'nm', 'mysql'], hdfs: 'write' },
  mongodb: { mongodb: true, procs: ['mongodb'] },
  jupyter: { jupyter: true, procs: ['jupyter'] },
  ha: { ha: true, procs: ['zk'], hdfs: 'read' },
};

const SERVICES_RANK = { hdfs: 0, mapreduce: 1, todo: 2 } as const;

/** Lo que falta en la configuración para esta capacidad, o null si la configuración alcanza */
function configGap(id: CapId, n: Need, c: ClusterConfig, volumeNN: number | null): Capability | null {
  if (n.services && SERVICES_RANK[c.services] < SERVICES_RANK[n.services])
    return blocked(id, `No está en esta configuración (SERVICIOS=${c.services}). Hace falta SERVICIOS=${n.services === 'todo' ? 'todo' : 'mapreduce o todo'}`,
      { kind: 'config', change: { services: n.services } }, `Usar SERVICIOS=${n.services}`);
  if (n.mongodb && !c.mongodb) return blocked(id, 'MongoDB no está en esta configuración (MONGODB=no)', { kind: 'config', change: { mongodb: true } }, 'Activar MongoDB');
  if (n.jupyter && !c.jupyter) return blocked(id, 'JupyterLab no está en esta configuración (JUPYTER=no)', { kind: 'config', change: { jupyter: true } }, 'Activar JupyterLab');
  if (n.ha && c.namenodes < 2) {
    if (volumeNN !== null && volumeNN < 2)
      return blocked(id, `El volumen se formateó con ${volumeNN} NameNode: para alta disponibilidad hay que borrarlo y arrancar con NAMENODES=2 o 3`, { kind: 'reset-volume' }, 'Borrar el volumen');
    return blocked(id, 'Hace falta NAMENODES=2 o 3 (con 1 NameNode no hay a quién pasarle el mando)', { kind: 'config', change: { namenodes: 2 } }, 'Usar 2 NameNodes');
  }
  return null;
}

function procGap(id: CapId, p: Process | undefined, starting: boolean): Capability | null {
  if (!p || p.state === 'up') return null;
  if (p.state === 'starting' || starting) return { id, state: 'starting', reason: `${p.name} está arrancando`, fix: { kind: 'wait' } };
  if (p.state === 'stopping') return { id, state: 'starting', reason: `${p.name} se está apagando`, fix: { kind: 'wait' } };
  if (p.controllable) return blocked(id, `${p.name} está apagado`, { kind: 'process-start', process: p.id }, `Prender ${p.name}`);
  return blocked(id, `${p.name} no responde`, { kind: 'restart' }, 'Reiniciar el cluster');
}

/** El mapa completo de capacidades para un estado. status null = sin conexión con el contenedor */
export function capabilities(status: ClusterStatus | null): Capabilities {
  const out = {} as Capabilities;
  if (!status) {
    ALL.forEach(id => { out[id] = blocked(id, 'Sin conexión con el contenedor: reintentando', { kind: 'wait' }); });
    return out;
  }
  const { phase, config: c } = status;
  const procs = new Map(status.processes.map(p => [p.id, p]));

  out['cluster.start'] = phase === 'stopped' ? ready('cluster.start') : blocked('cluster.start', phase === 'running' ? 'Ya está en marcha' : phase === 'starting' ? 'Ya está arrancando' : 'Se está apagando', { kind: 'wait' });
  out['cluster.stop'] = phase === 'running' || phase === 'starting' ? ready('cluster.stop') : blocked('cluster.stop', phase === 'stopping' ? 'Ya se está apagando' : 'Ya está apagado');
  out['config.edit'] = phase === 'starting' || phase === 'stopping'
    ? { id: 'config.edit', state: 'starting', reason: phase === 'starting' ? 'Esperá a que termine de arrancar para aplicar cambios' : 'Esperá a que termine de apagarse', fix: { kind: 'wait' } }
    : ready('config.edit');
  out['volume.reset'] = phase === 'stopped' ? ready('volume.reset') : blocked('volume.reset', 'El volumen está en uso: primero detené el cluster', { kind: 'stop' }, 'Detener el cluster');

  for (const id of ALL) {
    const n = NEEDS[id];
    if (!n) continue;
    out[id] = (() => {
      const gap = configGap(id, n, c, status.volumeNameNodes);
      if (gap) return gap;
      if (phase === 'stopped') return blocked(id, 'El cluster está apagado', { kind: 'start' }, 'Iniciar cluster');
      if (phase === 'stopping') return blocked(id, 'El cluster se está apagando', { kind: 'wait' });
      const starting = phase === 'starting';
      if (n.hdfs && !status.hdfs.available) {
        const nn = status.processes.find(p => p.kind === 'namenode' && p.state !== 'up');
        return procGap(id, nn, starting) ?? (starting ? { id, state: 'starting' as const, reason: 'HDFS está arrancando', fix: { kind: 'wait' as const } } : blocked(id, 'No hay un NameNode activo', { kind: 'restart' }, 'Reiniciar el cluster'));
      }
      if (n.hdfs === 'write' && status.hdfs.safeMode)
        return { id, state: 'starting' as const, reason: 'HDFS está en modo seguro: sale solo cuando reporten los DataNodes', fix: { kind: 'wait' as const } };
      if (n.hdfs === 'write' && status.hdfs.liveDataNodes === 0) {
        const dn = status.processes.find(p => p.kind === 'datanode');
        return procGap(id, dn, starting) ?? blocked(id, 'No hay DataNodes vivos', { kind: 'restart' }, 'Reiniciar el cluster');
      }
      for (const pid of n.procs) {
        const g = procGap(id, procs.get(pid), starting);
        if (g) return g;
      }
      return ready(id);
    })();
    const later = NOT_YET[id];
    if (later && out[id].state === 'ready') out[id] = blocked(id, later);
  }
  return out;
}

/** Cuántas capacidades de CAP_INFO están listas, arrancando y bloqueadas */
export function capSummary(caps: Capabilities) {
  const r = { ready: 0, starting: 0, blocked: 0 };
  CAP_INFO.forEach(i => { r[caps[i.id].state]++; });
  return r;
}
