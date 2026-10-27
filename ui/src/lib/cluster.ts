/* Reglas puras sobre la configuración: validación, RAM estimada, procesos que levanta y
   el docker-compose.yml equivalente. Las usan el modo demo y las vistas previas. */
import type { ClusterConfig, ClusterStatus, ConfigIssue, DataNode, Layer, ProcKind, RamEstimate } from '../api/types';

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
    // JournalNode k: RPC 8484+k, web 8479+k
    for (let i = 1; i <= 3; i++) s.push({ id: `jn${i}`, kind: 'journalnode', name: `JournalNode ${i}`, layer: 'hdfs', ports: [8484 + i, 8479 + i], web: 8479 + i, memMb: 148, controllable: false });
  }
  // Puertos como en sandbox/lib.sh: RPC 8999+n, web 9869+n y, en HA, ZKFC 8018+n
  for (let i = 1; i <= c.namenodes; i++) s.push({ id: `nn${i}`, kind: 'namenode', name: ha ? `NameNode ${i}` : 'NameNode', layer: 'hdfs', ports: ha ? [9869 + i, 8999 + i, 8018 + i] : [9870, 9000], web: 9869 + i, memMb: 384, controllable: true });
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

/** Tag de la imagen cuando no se sabe cuál corre: el mismo default que SANDBOX_VERSION en el backend */
export const DEFAULT_IMAGE_TAG = 'full';

/** `tag` = SANDBOX_VERSION de la imagen que corre (status().image.tag); la empresa sin ROL se usa igual que la full */
export function composeYaml(c: ClusterConfig, tag: string = DEFAULT_IMAGE_TAG): string {
  const yn = (b: boolean) => (b ? 'si' : 'no');
  const L: string[] = [
    `# BigData Sandbox :${tag}, generado desde la interfaz (localhost:8080)`,
    '#   docker compose up -d        crear y prender',
    '#   docker compose logs -f      seguir el arranque hasta "Cluster LISTO"',
    '#   docker compose stop         apagar en orden (los datos quedan)',
    '# Las mismas variables sirven con :base y :ml (sin interfaz): esas arrancan siempre solas.',
    '',
    'name: bigdata',
    '',
    'services:',
    '  bigdata:',
    `    image: franki678/bigdata-sandbox:${tag}`,
    '    container_name: bigdata',
    '    environment:',
    '      AUTOSTART: "1"                 # arranca solo con estas variables; sin ella espera «Iniciar» en la interfaz',
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
  // Siempre: si después se prende JupyterLab desde la interfaz, el puerto ya está publicado
  L.push(`      - "127.0.0.1:8888:8888"             # JupyterLab${c.jupyter ? '' : ' (con JUPYTER: "si")'}`);
  L.push('    volumes:', '      - bigdata_hadoop:/hadoop              # HDFS, metastore, MySQL y MongoDB', '      - ./datos:/datos                      # tu carpeta datos/ adentro', '    stop_grace_period: 20s', '', 'volumes:', '  bigdata_hadoop:', '    name: bigdata_hadoop', '');
  return L.join('\n');
}

export function configSummary(c: ClusterConfig): string {
  return `${c.namenodes > 1 ? `${c.namenodes} NameNodes (HA)` : '1 NameNode'} · ${c.datanodes} DataNode${c.datanodes > 1 ? 's' : ''} · réplica ${c.replication} · bloque ${blockSizeLabel(c.blockSize)} · ${c.services}${c.mongodb ? ' + MongoDB' : ''}`;
}

/* ---------- Salud: una sola lectura para la barra de arriba, Inicio, Cluster y HDFS ---------- */

export type HealthTone = 'off' | 'run' | 'ok' | 'warn' | 'bad';
export interface Health {
  tone: HealthTone;
  /** Dos o tres palabras: "Apagado", "En marcha", "Degradado", "Con fallas" */
  label: string;
  /** Qué pasa, en una línea, y si se pierde algo */
  detail: string;
  /** Lista de problemas concretos, del más grave al menos grave */
  issues: { tone: 'warn' | 'bad'; text: string }[];
}

/** Procesos sin los que algo deja de andar (no solo se achica) */
const CRITICAL = new Set(['rm', 'nm', 'hiveserver2', 'hive', 'metastore', 'mysql', 'mongodb']);

/** Rojo solo si hay datos perdidos o algo deja de responder; amarillo si anda con menos copias o menos
    nodos (es lo que HDFS aguanta a propósito: un DataNode caído con réplica 2 no pierde nada). */
export function clusterHealth(s: ClusterStatus | null, dataNodes: DataNode[] = []): Health {
  if (!s) return { tone: 'off', label: 'Conectando', detail: 'Esperando al contenedor', issues: [] };
  if (s.phase === 'stopped') return { tone: 'off', label: 'Apagado', detail: 'Los datos quedan en el volumen', issues: [] };
  if (s.phase === 'stopping') return { tone: 'run', label: 'Apagando', detail: 'Bajando los procesos en orden', issues: [] };
  if (s.phase === 'starting') {
    const st = s.boot?.steps.filter(x => x.state !== 'skipped') ?? [];
    const done = st.filter(x => x.state === 'done').length;
    return { tone: 'run', label: 'Arrancando', detail: st.length ? `Paso ${Math.min(done + 1, st.length)} de ${st.length}` : 'Levantando los procesos', issues: [] };
  }
  const issues: Health['issues'] = [];
  const h = s.hdfs;
  if (!h.available) issues.push({ tone: 'bad', text: s.config.namenodes > 1 ? 'HDFS sin NameNode activo' : 'HDFS no responde: el NameNode está apagado' });
  if (h.missing) issues.push({ tone: 'bad', text: `${h.missing} bloque${h.missing > 1 ? 's' : ''} sin ninguna copia` });
  const down = s.processes.filter(p => p.state === 'down');
  down.filter(p => CRITICAL.has(p.id)).forEach(p => issues.push({ tone: 'bad', text: `${p.name} caído` }));
  const dnDown = new Set(down.filter(p => p.kind === 'datanode').map(p => p.id));
  dataNodes.filter(d => d.state === 'dead').forEach(d => dnDown.add(`dn${d.id}`));
  if (dnDown.size) issues.push({ tone: 'warn', text: `${dnDown.size === 1 ? `DataNode ${[...dnDown][0].slice(2)} caído` : `${dnDown.size} DataNodes caídos`}` });
  const stale = dataNodes.filter(d => d.state === 'stale');
  if (stale.length) issues.push({ tone: 'warn', text: `${stale.length === 1 ? `DataNode ${stale[0].id}` : `${stale.length} DataNodes`} sin latidos` });
  if (h.underReplicated) issues.push({ tone: 'warn', text: `${h.underReplicated} bloque${h.underReplicated > 1 ? 's' : ''} con copias de menos` });
  down.filter(p => !CRITICAL.has(p.id) && p.kind !== 'datanode' && !(p.kind === 'namenode' && !h.available && s.config.namenodes === 1))
    .forEach(p => issues.push({ tone: 'warn', text: `${p.name} apagado` }));
  issues.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1));
  if (issues.some(i => i.tone === 'bad')) return { tone: 'bad', label: 'Con fallas', detail: issues[0].text, issues };
  if (issues.length) {
    const safe = !h.missing && h.available;
    return { tone: 'warn', label: 'Degradado', detail: `${issues[0].text}${safe ? ' · sin pérdida de datos' : ''}`, issues };
  }
  return { tone: 'ok', label: 'En marcha', detail: 'Todo responde', issues };
}

/** Lo que cambia entre dos configuraciones, campo por campo, en palabras */
export function configDiff(a: ClusterConfig, b: ClusterConfig): { field: keyof ClusterConfig; label: string; from: string; to: string }[] {
  const f: [keyof ClusterConfig, string, (c: ClusterConfig) => string][] = [
    ['namenodes', 'NameNodes', c => (c.namenodes > 1 ? `${c.namenodes} (HA)` : '1')],
    ['datanodes', 'DataNodes', c => String(c.datanodes)],
    ['replication', 'Réplica', c => String(c.replication)],
    ['blockSize', 'Bloque', c => blockSizeLabel(c.blockSize)],
    ['services', 'Servicios', c => c.services],
    ['mongodb', 'MongoDB', c => (c.mongodb ? 'sí' : 'no')],
    ['jupyter', 'JupyterLab', c => (c.jupyter ? 'sí' : 'no')],
    ['pigHeapsize', 'Memoria de pig', c => `${c.pigHeapsize} MB`],
  ];
  return f.filter(([k]) => a[k] !== b[k]).map(([field, label, fmt]) => ({ field, label, from: fmt(a), to: fmt(b) }));
}
