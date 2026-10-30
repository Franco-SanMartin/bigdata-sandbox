/* El ecosistema de la imagen: qué es cada herramienta, en qué capa está, a quién le pide qué
   (las flechas), los recorridos guiados y las comparaciones. El contenido sale de la maqueta
   docs/maquetas/ecosistema.html (ecosistema.json); acá se le suma el estado en vivo de cada
   herramienta según los procesos, las capacidades y los trabajos de YARN. */
import data from './ecosistema.json';
import type { ClusterStatus, Process, YarnApp } from '../api/types';
import type { Capabilities, CapId } from './capabilities';
import type { PageId } from './route';

export type CapaId = 'puertas' | 'lenguajes' | 'motores' | 'recursos' | 'datos' | 'puente' | 'maquina';
export type ToolId =
  | 'hdfs' | 'metastore' | 'yarn' | 'zookeeper' | 'mapreduce' | 'tez' | 'spark' | 'hive' | 'pig' | 'sparksql'
  | 'pyspark' | 'streaming' | 'sqoop' | 'mariadb' | 'mongodb' | 'pandas' | 'sklearn' | 'jupyter' | 'terminal' | 'interfaz';

export interface Herramienta {
  name: string; layer: CapaId; version: string; sub: string; subN: string;
  frase: string; analogia: string; cursada: string;
  confunde: { con: string; dif: string }[];
  ejemplo: string;
  /** [qué es, host:puerto] */
  ui: [string, string][];
}
export type FlechaKind = 'run' | 'read' | 'bridge' | 'puerta';
export interface Flecha { id: string; from: ToolId; to: ToolId; kind: FlechaKind; label: string; hide?: boolean }
export interface Paso { t: string; nodes: ToolId[]; edges: string[]; x: string; code?: string; tip?: string }
export interface Recorrido { name: string; intro: string; steps: Paso[] }
export interface Comparacion { t: string; q: string; cols: [string, CapaId][]; rows: string[][] }

const D = data as unknown as {
  capas: Record<CapaId, { name: string }>;
  herramientas: Record<ToolId, Herramienta>;
  flechas: Flecha[];
  recorridos: Record<string, Recorrido>;
  comparar: Comparacion[];
  glosario: [string, string][];
};

export const CAPAS = D.capas;
export const HERRAMIENTAS = D.herramientas;
export const FLECHAS = D.flechas.filter(f => !f.hide);
export const RECORRIDOS = D.recorridos;
/** 'Dónde quedan' → 'donde-quedan': para enlazar una comparación (#comparar/donde-quedan-los-datos) */
export const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Cada comparación con su pregunta suelta (¿Cómo lo pido?), las herramientas y un id */
export const COMPARAR: (Comparacion & { id: string; pregunta: string; cuales: string })[] = D.comparar.map(c => {
  const m = /^(¿[^?]+\?)\s*(.*)$/.exec(c.t);
  const pregunta = m?.[1] ?? c.t;
  return { ...c, id: slug(pregunta), pregunta, cuales: m?.[2] ?? '' };
});
export const GLOSARIO = D.glosario;

/** Cómo se dibuja el mapa: el cluster en filas (de dónde trabajás arriba a dónde quedan los datos
    abajo) y, al costado, lo que corre en una sola máquina. Sqoop es el puente entre los dos. */
export const FILAS: { capa: CapaId; titulo: string; sub: string; cluster: ToolId[]; costado: ToolId[] }[] = [
  { capa: 'puertas', titulo: 'Desde dónde trabajás', sub: 'puertas', cluster: ['interfaz', 'terminal'], costado: ['jupyter'] },
  { capa: 'lenguajes', titulo: 'Cómo lo pedís', sub: 'lenguajes', cluster: ['streaming', 'pig', 'hive', 'sparksql', 'pyspark'], costado: ['pandas'] },
  { capa: 'motores', titulo: 'Quién hace el trabajo', sub: 'motores', cluster: ['mapreduce', 'tez', 'spark'], costado: ['sklearn'] },
  { capa: 'recursos', titulo: 'Quién reparte', sub: 'recursos', cluster: ['zookeeper', 'yarn'], costado: [] },
  { capa: 'datos', titulo: 'Dónde quedan los datos', sub: 'almacenamiento', cluster: ['metastore', 'hdfs'], costado: ['sqoop', 'mariadb', 'mongodb'] },
];

/* ---------- Estado en vivo ---------- */

/** up/starting/down/off como los procesos; lib: una biblioteca sin proceso propio (siempre está) */
export type Lampara = 'up' | 'starting' | 'down' | 'off' | 'lib';
export interface Vivo { lampara: Lampara; linea: string; corriendo: number }

const PROC_KINDS: Partial<Record<ToolId, Process['kind'][]>> = {
  hdfs: ['namenode', 'datanode'], metastore: ['metastore'], yarn: ['resourcemanager', 'nodemanager'],
  zookeeper: ['zookeeper'], hive: ['hiveserver2', 'metastore'], mariadb: ['mysql'], mongodb: ['mongodb'], jupyter: ['jupyter'],
};
const CAP: Partial<Record<ToolId, CapId>> = {
  mapreduce: 'mapreduce', streaming: 'mapreduce', tez: 'tez', spark: 'spark', sparksql: 'spark', pyspark: 'spark',
  pig: 'pig', sqoop: 'sqoop', hive: 'hive',
};
/** Qué tipo de aplicación de YARN muestra que esa herramienta está trabajando */
const APP_TYPE: Partial<Record<ToolId, YarnApp['type']>> = { mapreduce: 'MAPREDUCE', tez: 'TEZ', spark: 'SPARK' };

export const activa = (a: YarnApp) => a.state === 'RUNNING' || a.state === 'ACCEPTED';

function lamparaDe(procs: Process[]): Lampara {
  const on = procs.filter(p => p.state !== 'off');
  if (!on.length) return 'off';
  if (on.some(p => p.state === 'down')) return 'down';
  if (on.some(p => p.state === 'starting' || p.state === 'stopping')) return 'starting';
  return 'up';
}

export function vivo(id: ToolId, s: ClusterStatus, caps: Capabilities, apps: YarnApp[]): Vivo {
  const corriendo = apps.filter(a => activa(a) && (APP_TYPE[id] ? a.type === APP_TYPE[id] : id === 'yarn')).length;
  const kinds = PROC_KINDS[id];
  const procs = kinds ? s.processes.filter(p => kinds.includes(p.kind)) : [];
  const nTrab = (n: number) => `${n} ${n === 1 ? 'trabajo corriendo' : 'trabajos corriendo'}`;
  switch (id) {
    case 'interfaz': return { lampara: 'up', linea: 'Estás acá', corriendo: 0 };
    case 'terminal': return { lampara: s.phase === 'stopped' ? 'lib' : 'up', linea: 'bash adentro del contenedor', corriendo: 0 };
    case 'pandas': case 'sklearn': return { lampara: 'lib', linea: 'Biblioteca de Python: no necesita el cluster', corriendo: 0 };
    case 'zookeeper':
      if (!procs.some(p => p.state !== 'off') && s.config.namenodes < 2) return { lampara: 'off', linea: 'Solo con NAMENODES=2 o 3', corriendo: 0 };
      return { lampara: lamparaDe(procs), linea: procs.length ? `${procs.length} ${procs.length === 1 ? 'proceso' : 'procesos'}` : '—', corriendo: 0 };
    case 'hdfs': {
      const l = lamparaDe(procs);
      return { lampara: l, linea: s.phase === 'running' ? `${s.hdfs.liveDataNodes} de ${s.config.datanodes} DataNodes · ${s.hdfs.files} ${s.hdfs.files === 1 ? 'archivo' : 'archivos'}` : `${s.config.datanodes} DataNodes configurados`, corriendo: 0 };
    }
    case 'yarn': {
      const l = lamparaDe(procs);
      const nms = s.processes.filter(p => p.kind === 'nodemanager' && p.state === 'up').length;
      return { lampara: l, linea: corriendo ? nTrab(corriendo) : l === 'up' ? `${nms} ${nms === 1 ? 'NodeManager' : 'NodeManagers'} · sin trabajos` : 'ResourceManager apagado', corriendo };
    }
  }
  if (procs.length) {
    const l = lamparaDe(procs);
    const p = procs.find(x => x.state !== 'off') ?? procs[0];
    return { lampara: l, linea: l === 'up' ? `${p.name}${p.ports[0] ? ` · :${p.ports[0]}` : ''}` : l === 'off' ? 'Apagado' : l === 'down' ? 'Caído' : 'Arrancando', corriendo };
  }
  const capId = CAP[id];
  if (capId) {
    const c = caps[capId];
    const l: Lampara = c.state === 'ready' ? 'up' : c.state === 'starting' ? 'starting' : 'off';
    return { lampara: l, linea: corriendo ? nTrab(corriendo) : c.state === 'ready' ? 'Listo para usar' : c.reason ?? 'No disponible', corriendo };
  }
  return { lampara: 'off', linea: '—', corriendo };
}

/** Las flechas que se animan: el camino de cada motor que tiene trabajos corriendo */
const CAMINO: Record<YarnApp['type'], string[]> = {
  MAPREDUCE: ['e_streaming_mr', 'e_pig_mr', 'e_mr_yarn', 'e_yarn_hdfs'],
  TEZ: ['e_hive_tez', 'e_hive_meta', 'e_tez_yarn', 'e_yarn_hdfs'],
  SPARK: ['e_sparksql_spark', 'e_pyspark_spark', 'e_spark_yarn', 'e_yarn_hdfs'],
};
export function flechasVivas(apps: YarnApp[]): Set<string> {
  const out = new Set<string>();
  for (const a of apps) if (activa(a)) for (const e of CAMINO[a.type]) out.add(e);
  return out;
}

/* ---------- Qué se puede hacer con cada una ---------- */

/** La pantalla de la interfaz donde se trabaja con esa herramienta */
export const PANTALLA: Partial<Record<ToolId, { page: PageId; label: string }>> = {
  hdfs: { page: 'hdfs', label: 'Explorar HDFS' },
  metastore: { page: 'datos', label: 'Ver las tablas' },
  yarn: { page: 'yarn', label: 'Ver los trabajos' },
  zookeeper: { page: 'cluster', label: 'Ver los NameNodes' },
  mapreduce: { page: 'yarn', label: 'Lanzar un MapReduce' },
  streaming: { page: 'yarn', label: 'Lanzar un trabajo' },
  tez: { page: 'datos', label: 'Correr una consulta de Hive' },
  spark: { page: 'yarn', label: 'Lanzar un trabajo de Spark' },
  sparksql: { page: 'yarn', label: 'Lanzar un trabajo de Spark' },
  hive: { page: 'datos', label: 'Escribir una consulta' },
  pig: { page: 'datos', label: 'Escribir un script de Pig' },
  pyspark: { page: 'ml', label: 'Entrenar un modelo' },
  sqoop: { page: 'pipeline', label: 'Importar con el pipeline' },
  mariadb: { page: 'datos', label: 'Consultar la base tienda' },
  mongodb: { page: 'datos', label: 'Consultar MongoDB' },
  pandas: { page: 'ml', label: 'Probar en una muestra' },
  sklearn: { page: 'ml', label: 'Entrenar un modelo' },
  interfaz: { page: 'config', label: 'Configurar el cluster' },
};

/** Dónde se escribe el ejemplo. Los de bash se pueden mandar a la terminal integrada tal cual */
export const DONDE: Record<ToolId, { bash: boolean; donde: string }> = {
  hdfs: { bash: true, donde: 'terminal' }, yarn: { bash: true, donde: 'terminal' }, zookeeper: { bash: true, donde: 'terminal' },
  mapreduce: { bash: true, donde: 'terminal' }, spark: { bash: true, donde: 'terminal' }, hive: { bash: true, donde: 'terminal' },
  sparksql: { bash: true, donde: 'terminal' }, streaming: { bash: true, donde: 'terminal' }, sqoop: { bash: true, donde: 'terminal' },
  mariadb: { bash: true, donde: 'terminal' },
  metastore: { bash: false, donde: 'adentro de beeline' }, tez: { bash: false, donde: 'adentro de beeline' },
  pig: { bash: false, donde: 'adentro de pig (grunt)' }, mongodb: { bash: false, donde: 'en mongosh' },
  pyspark: { bash: false, donde: 'en pyspark o en JupyterLab' }, pandas: { bash: false, donde: 'en Python o JupyterLab' },
  sklearn: { bash: false, donde: 'en Python o JupyterLab' }, jupyter: { bash: false, donde: 'en una celda de JupyterLab' },
  terminal: { bash: false, donde: 'en la terminal de tu compu' }, interfaz: { bash: false, donde: 'en el navegador' },
};

/** Las parecidas: con quién se la confunde (las que también están en el mapa) */
export function parecidas(id: ToolId): ToolId[] {
  const nombres = HERRAMIENTAS[id].confunde.map(c => c.con.toLowerCase());
  return (Object.keys(HERRAMIENTAS) as ToolId[]).filter(o => o !== id && nombres.some(n => n.includes(HERRAMIENTAS[o].name.toLowerCase())));
}

/** Las flechas de una herramienta, para iluminarlas al pasar el mouse */
export const flechasDe = (id: ToolId) => FLECHAS.filter(f => f.from === id || f.to === id);
