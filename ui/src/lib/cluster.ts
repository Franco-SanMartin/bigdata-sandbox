/* Reglas puras sobre la configuración: validación, RAM estimada, procesos que levanta y
   el docker-compose.yml equivalente. Las usan el modo demo y las vistas previas. */
import type { ClusterConfig, ConfigIssue, Layer, ProcKind, RamEstimate } from '../api/types';

export const DEFAULT_CONFIG: ClusterConfig = {
  datanodes: 3, replication: 2, blockSize: '1m', namenodes: 1, services: 'todo', mongodb: false, jupyter: false, pigHeapsize: 512,
};
export const BLOCK_PRESETS = ['1m', '4m', '16m', '32m', '64m', '128m', '256m', '512m', '1g'];
export const DOCKER_LIMIT_MB = 7884; // 7,7 GB: lo que Docker Desktop le da por defecto en una PC de 16 GB

export function blockSizeMb(v: string): number | null {
  const m = /^([1-9][0-9]*)([mMgG])$/.exec(v.trim());
  if (!m) return null;
  return +m[1] * (m[2].toLowerCase() === 'g' ? 1024 : 1);
}
export function blockSizeLabel(v: string): string {
  const mb = blockSizeMb(v);
  if (mb == null) return v;
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

export function validate(c: ClusterConfig, volumeNameNodes: number | null): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  if (!Number.isInteger(c.datanodes) || c.datanodes < 1 || c.datanodes > 9) out.push({ field: 'datanodes', level: 'error', message: 'Tiene que ser un número de 1 a 9.' });
  if (!Number.isInteger(c.replication) || c.replication < 1 || c.replication > 9) out.push({ field: 'replication', level: 'error', message: 'Tiene que ser un número de 1 a 9.' });
  else if (c.replication > c.datanodes) out.push({ field: 'replication', level: 'warning', message: `Hay ${c.datanodes} DataNode${c.datanodes > 1 ? 's' : ''}: cada bloque va a quedar con ${c.datanodes} copia${c.datanodes > 1 ? 's' : ''} y HDFS lo marca sub-replicado.` });
  else if (c.replication === 1) out.push({ field: 'replication', level: 'warning', message: 'Con una sola copia, si se cae un DataNode sus bloques quedan perdidos hasta que vuelva.' });
  const bs = blockSizeMb(c.blockSize);
  if (bs == null) out.push({ field: 'blockSize', level: 'error', message: 'Número seguido de m o g: 1m, 32m, 128m, 1g. Mínimo 1m.' });
  if (![1, 2, 3].includes(c.namenodes)) out.push({ field: 'namenodes', level: 'error', message: 'Tiene que ser 1, 2 o 3.' });
  else if (volumeNameNodes != null && volumeNameNodes !== c.namenodes) out.push({ field: 'namenodes', level: 'error', message: `El volumen se creó con ${volumeNameNodes} NameNode${volumeNameNodes > 1 ? 's' : ''}. Para cambiarlo hay que borrar el volumen.` });
  if (c.services === 'hdfs' && c.mongodb === false && c.jupyter) out.push({ field: 'jupyter', level: 'warning', message: 'Sin YARN, los notebooks solo pueden usar pandas y PySpark local.' });
  if (![256, 512, 1024, 2048].includes(c.pigHeapsize)) out.push({ field: 'pigHeapsize', level: 'error', message: 'Elegí 256, 512, 1024 o 2048 MB.' });
  return out;
}

export function estimateRam(c: ClusterConfig): RamEstimate {
  const parts = [{ label: 'HDFS y sistema', mb: 4096 }];
  if (c.datanodes > 1) parts.push({ label: `${c.datanodes - 1} DataNode${c.datanodes > 2 ? 's' : ''} más`, mb: 256 * (c.datanodes - 1) });
  if (c.services !== 'hdfs') parts.push({ label: 'YARN, MapReduce y MySQL', mb: 1024 });
  if (c.services === 'todo') parts.push({ label: 'Hive y Spark', mb: 1024 });
  if (c.namenodes > 1) parts.push({ label: `Alta disponibilidad (${c.namenodes} NameNodes)`, mb: c.namenodes === 2 ? 2048 : 2560 });
  if (c.mongodb) parts.push({ label: 'MongoDB', mb: 512 });
  if (c.jupyter) parts.push({ label: 'JupyterLab', mb: 384 });
  parts.push({ label: 'Esta interfaz', mb: 128 });
  return { totalMb: parts.reduce((a, p) => a + p.mb, 0), parts, limitMb: DOCKER_LIMIT_MB };
}

/* ---------- Procesos que levanta una configuración ---------- */

export interface ProcSpec { id: string; kind: ProcKind; name: string; layer: Layer; ports: number[]; web?: number; memMb: number; controllable: boolean }

export function processSpecs(c: ClusterConfig): ProcSpec[] {
  const s: ProcSpec[] = [];
  const ha = c.namenodes > 1;
  if (ha) {
    s.push({ id: 'zk', kind: 'zookeeper', name: 'ZooKeeper', layer: 'hdfs', ports: [2181], memMb: 92, controllable: false });
    for (let i = 1; i <= 3; i++) s.push({ id: `jn${i}`, kind: 'journalnode', name: `JournalNode ${i}`, layer: 'hdfs', ports: [8484 + i, 8479 + i], web: 8479 + i, memMb: 148, controllable: false });
  }
  for (let i = 1; i <= c.namenodes; i++) s.push({ id: `nn${i}`, kind: 'namenode', name: ha ? `NameNode ${i}` : 'NameNode', layer: 'hdfs', ports: [9869 + i, ha ? 9000 + i * 10 : 9000], web: 9869 + i, memMb: 384, controllable: true });
  if (!ha) s.push({ id: 'snn', kind: 'secondarynamenode', name: 'Secondary NameNode', layer: 'hdfs', ports: [9868], web: 9868, memMb: 256, controllable: false });
  for (let i = 1; i <= c.datanodes; i++) s.push({ id: `dn${i}`, kind: 'datanode', name: `DataNode ${i}`, layer: 'hdfs', ports: [9900 + i, 9910 + i], web: 9900 + i, memMb: 236, controllable: true });
  if (c.services !== 'hdfs') {
    s.push({ id: 'rm', kind: 'resourcemanager', name: 'ResourceManager', layer: 'yarn', ports: [8088], web: 8088, memMb: 420, controllable: false });
    s.push({ id: 'nm', kind: 'nodemanager', name: 'NodeManager', layer: 'yarn', ports: [8042], web: 8042, memMb: 330, controllable: false });
    s.push({ id: 'jh', kind: 'historyserver', name: 'MapReduce JobHistory', layer: 'yarn', ports: [19888], web: 19888, memMb: 296, controllable: false });
    s.push({ id: 'mysql', kind: 'mysql', name: 'MySQL (MariaDB)', layer: 'servicios', ports: [3306], memMb: 158, controllable: true });
  }
  if (c.services === 'todo') {
    s.push({ id: 'metastore', kind: 'metastore', name: 'Hive Metastore', layer: 'servicios', ports: [9083], memMb: 410, controllable: false });
    s.push({ id: 'hiveserver2', kind: 'hiveserver2', name: 'HiveServer2', layer: 'servicios', ports: [10000, 10002], web: 10002, memMb: 716, controllable: true });
    s.push({ id: 'sparkhistory', kind: 'sparkhistory', name: 'Spark History', layer: 'servicios', ports: [18080], web: 18080, memMb: 262, controllable: false });
  }
  if (c.mongodb) s.push({ id: 'mongodb', kind: 'mongodb', name: 'MongoDB', layer: 'servicios', ports: [27017], memMb: 284, controllable: true });
  if (c.jupyter) s.push({ id: 'jupyter', kind: 'jupyter', name: 'JupyterLab', layer: 'servicios', ports: [8888], web: 8888, memMb: 142, controllable: true });
  s.push({ id: 'ui', kind: 'ui', name: 'Esta interfaz', layer: 'servicios', ports: [8080], memMb: 64, controllable: false });
  return s;
}

/* ---------- docker-compose.yml ---------- */

export function composeYaml(c: ClusterConfig): string {
  const yn = (b: boolean) => (b ? 'si' : 'no');
  const L: string[] = [
    '# BigData Sandbox :full, generado desde la interfaz (localhost:8080)',
    '#   docker compose up -d        crear y prender',
    '#   docker compose logs -f      seguir el arranque hasta "Cluster LISTO"',
    '#   docker compose stop         apagar en orden (los datos quedan)',
    '',
    'name: bigdata',
    '',
    'services:',
    '  bigdata:',
    '    image: franki678/bigdata-sandbox:full',
    '    container_name: bigdata',
    '    environment:',
    `      DATANODES: "${c.datanodes}"`,
    `      REPLICATION: "${c.replication}"${c.replication > c.datanodes ? '   # mayor que DATANODES: sub-replicado' : ''}`,
    `      BLOCK_SIZE: "${c.blockSize}"`,
    `      NAMENODES: "${c.namenodes}"${c.namenodes > 1 ? '   # alta disponibilidad: queda fijo en el volumen' : ''}`,
    `      SERVICIOS: "${c.services}"`,
    `      MONGODB: "${yn(c.mongodb)}"`,
    `      JUPYTER: "${yn(c.jupyter)}"`,
    c.pigHeapsize !== 512 ? `      PIG_HEAPSIZE: "${c.pigHeapsize}"` : '      # PIG_HEAPSIZE: "512"',
    '    ports:',
    '      - "127.0.0.1:8080:8080"             # esta interfaz',
    '      - "127.0.0.1:9870:9870"             # NameNode 1',
  ];
  if (c.namenodes > 1) {
    L.push(`      - "127.0.0.1:9871-${9869 + c.namenodes}:9871-${9869 + c.namenodes}"   # NameNodes 2${c.namenodes > 2 ? ' y 3' : ''}`);
    L.push('      - "127.0.0.1:8480-8482:8480-8482"   # JournalNodes');
  } else L.push('      - "127.0.0.1:9868:9868"             # Secondary NameNode');
  L.push('      - "127.0.0.1:9901-9909:9901-9909"   # DataNode N en 990N');
  if (c.services !== 'hdfs') L.push('      - "127.0.0.1:8088:8088"             # YARN ResourceManager', '      - "127.0.0.1:8042:8042"             # NodeManager', '      - "127.0.0.1:19888:19888"           # JobHistory');
  if (c.services === 'todo') L.push('      - "127.0.0.1:10000:10000"           # HiveServer2 (JDBC)', '      - "127.0.0.1:10002:10002"           # HiveServer2 (web)', '      - "127.0.0.1:18080:18080"           # Spark History', '      - "127.0.0.1:4040:4040"             # trabajo de Spark activo');
  if (c.mongodb) L.push('      - "127.0.0.1:27017:27017"           # MongoDB');
  if (c.jupyter) L.push('      - "127.0.0.1:8888:8888"             # JupyterLab');
  L.push('    volumes:', '      - bigdata_hadoop:/hadoop              # HDFS, metastore, MySQL y MongoDB', '      - ./datos:/datos                      # tu carpeta datos/ adentro', '    stop_grace_period: 20s', '', 'volumes:', '  bigdata_hadoop:', '    name: bigdata_hadoop', '');
  return L.join('\n');
}

export function configSummary(c: ClusterConfig): string {
  return `${c.namenodes > 1 ? `${c.namenodes} NameNodes (HA)` : '1 NameNode'} · ${c.datanodes} DataNode${c.datanodes > 1 ? 's' : ''} · réplica ${c.replication} · bloque ${blockSizeLabel(c.blockSize)} · ${c.services}${c.mongodb ? ' + MongoDB' : ''}`;
}
