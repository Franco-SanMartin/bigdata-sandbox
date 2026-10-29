/*
 * Contrato entre la interfaz y el backend del contenedor.
 *
 * Las pantallas solo conocen la interfaz SandboxApi. Hay dos implementaciones:
 *   - DemoApi (api/demo): un cluster simulado en el navegador. Es el "modo demo"
 *     y lo que se publica en GitHub Pages.
 *   - HttpApi (api/http.ts): habla con el backend real en :8080 (rutas /api/...).
 * La correspondencia con las rutas HTTP está al lado de cada método.
 */
import type {
  MlCatalogo, MlCodigo, MlCorrerCodigo, MlCorrida, MlDatos, MlExperimento, MlExperimentoFila, MlFuentes, MlLimpieza, MlLimpiezaFila,
  MlLimpiezaGuardada, MlParteCodigo, MlPerfil, MlPerfilOpciones, MlPrediccion, MlReceta, MlRevision, MlVistaLimpieza,
} from './estudio';
export type * from './estudio';

/* ---------- Configuración (las variables de entorno del contenedor) ---------- */

export type Services = 'hdfs' | 'mapreduce' | 'todo';

export interface ClusterConfig {
  /** DATANODES, de 1 a 9 */
  datanodes: number;
  /** REPLICATION, de 1 a 9. Puede ser mayor que datanodes: los bloques quedan sub-replicados */
  replication: number;
  /** BLOCK_SIZE: número + m o g ("1m", "128m", "1g"). Mínimo 1m */
  blockSize: string;
  /** NAMENODES, de 1 a 3. Queda fijo en el volumen la primera vez */
  namenodes: number;
  /** SERVICIOS */
  services: Services;
  /** MONGODB=si|no */
  mongodb: boolean;
  /** JUPYTER=si|no (solo en las versiones ml y full) */
  jupyter: boolean;
  /** PIG_HEAPSIZE en MB */
  pigHeapsize: number;
}

export interface ConfigIssue {
  field: keyof ClusterConfig;
  level: 'error' | 'warning';
  message: string;
}

export interface RamPart { label: string; mb: number }
export interface RamEstimate { totalMb: number; parts: RamPart[]; limitMb: number }

/* ---------- Estado general ---------- */

export type ClusterPhase = 'stopped' | 'starting' | 'running' | 'stopping';

/** Estado de un proceso (lo que ve "jps" y si responde su puerto) */
export type ProcState = 'up' | 'starting' | 'stopping' | 'down' | 'off';

export type ProcKind =
  | 'namenode' | 'secondarynamenode' | 'zookeeper' | 'journalnode' | 'datanode'
  | 'resourcemanager' | 'nodemanager' | 'historyserver'
  | 'mysql' | 'mongodb' | 'metastore' | 'hiveserver2' | 'sparkhistory' | 'jupyter' | 'ui';

export type Layer = 'hdfs' | 'yarn' | 'servicios';

export interface Process {
  /** Identificador estable: nn1, snn, zk, jn2, dn3, rm, nm, jh, mysql, mongodb, metastore, hiveserver2, sparkhistory, jupyter, ui */
  id: string;
  kind: ProcKind;
  name: string;
  layer: Layer;
  state: ProcState;
  /** Solo NameNodes en alta disponibilidad */
  role?: 'active' | 'standby';
  ports: number[];
  webUrl?: string;
  pid?: number;
  /** Memoria residente del proceso */
  memMb?: number;
  /** Epoch ms del último cambio a "up" */
  upSince?: number;
  /** Se puede prender y apagar desde la interfaz */
  controllable: boolean;
}

export interface MemoryInfo {
  /** Lo que Docker le da al contenedor (/proc/meminfo o el límite del cgroup) */
  limitMb: number;
  usedMb: number;
  /** Estimación para la configuración aplicada */
  estimateMb: number;
  /** Últimas muestras, una cada 10 s del cluster */
  history: { t: number; usedMb: number }[];
}

export interface HdfsSummary {
  /** Hay un NameNode activo que responde */
  available: boolean;
  safeMode: boolean;
  liveDataNodes: number;
  staleDataNodes: number;
  deadDataNodes: number;
  files: number;
  blocks: number;
  replicas: number;
  underReplicated: number;
  missing: number;
  overReplicated: number;
  usedMb: number;
}

export interface YarnSummary {
  totalMb: number;
  usedMb: number;
  running: number;
  pending: number;
  finished: number;
}

export interface ClusterStatus {
  phase: ClusterPhase;
  /** La configuración con la que está corriendo (o la última guardada si está apagado) */
  config: ClusterConfig;
  /** NameNodes grabados en el volumen; null si el volumen es nuevo */
  volumeNameNodes: number | null;
  startedAt: number | null;
  /** Reloj del cluster (epoch ms). En modo demo corre más rápido */
  now: number;
  memory: MemoryInfo;
  processes: Process[];
  hdfs: HdfsSummary;
  yarn: YarnSummary;
  boot: BootProgress | null;
  image: { name: string; tag: string; hadoop: string; hive: string; spark: string };
}

/* ---------- Arranque ---------- */

export interface LogLine { t: number; level: 'INFO' | 'WARN' | 'ERROR'; text: string }

export interface BootStep {
  id: string;
  name: string;
  state: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  skipReason?: string;
  description: string;
  commands: string[];
  /** Procesos que quedan arriba al terminar el paso */
  processes: string[];
  expectedSec: number;
  startedAt?: number;
  finishedAt?: number;
  log: LogLine[];
}

export interface BootProgress {
  kind: 'first' | 'restart';
  steps: BootStep[];
  startedAt: number;
  finishedAt?: number;
  expectedSec: number;
}

/* ---------- HDFS ---------- */

export interface DataNode {
  id: number;
  /** live: manda latidos · stale: no manda latidos pero todavía no está muerto · dead · starting · off */
  state: 'live' | 'stale' | 'dead' | 'starting' | 'off';
  httpPort: number;
  dataPort: number;
  blocks: number;
  usedMb: number;
  /** Epoch ms del último latido */
  lastHeartbeat: number | null;
  /** Epoch ms en que el NameNode lo va a dar por muerto (si está stale) */
  deadAt: number | null;
}

export interface Block {
  id: number;
  genStamp: number;
  /** blk_1073741830_1006 */
  name: string;
  /** Posición dentro del archivo, desde 1 */
  index: number;
  sizeMb: number;
  /** DataNodes vivos con una copia */
  locations: number[];
  /** Copias que quedaron en DataNodes muertos */
  stale: number[];
}

export interface HdfsFile {
  path: string;
  sizeMb: number;
  replication: number;
  blockSizeMb: number;
  blocks: Block[];
  state: 'writing' | 'ok' | 'under' | 'missing';
  /** Qué lo escribió: cliente HDFS, Pig, Hive, Spark, pandas */
  writtenBy: string;
  modifiedAt: number;
}

/** Un bloque que se copió de un DataNode a otro (para animar el rack) */
export interface BlockTransfer { block: number; from: number | 'client'; to: number }

/* ---------- YARN ---------- */

export type AppType = 'MAPREDUCE' | 'TEZ' | 'SPARK';
export type AppState = 'ACCEPTED' | 'RUNNING' | 'FINISHED' | 'FAILED' | 'KILLED';

export interface YarnTask {
  id: string;
  index: number;
  state: 'pending' | 'running' | 'done' | 'failed';
  startedAt?: number;
  finishedAt?: number;
  /** Bloque que lee y DataNode que lo sirve (tareas de lectura) */
  block?: string;
  dataNode?: number;
  container?: string;
}

export interface YarnStage {
  id: string;
  /** Map, Reduce, Map 1, Reducer 2, Stage 3 */
  name: string;
  description: string;
  dependsOn: string[];
  /** SCATTER_GATHER, shuffle */
  edge?: string;
  state: 'pending' | 'running' | 'done';
  tasks: YarnTask[];
}

export interface YarnContainer { id: string; memoryMb: number; kind: 'am' | 'task' | 'executor'; label: string }

export interface YarnApp {
  /** application_1792041277726_0003 */
  id: string;
  name: string;
  type: AppType;
  user: string;
  queue: string;
  state: AppState;
  progress: number;
  submittedAt: number;
  startedAt?: number;
  finishedAt?: number;
  amMemoryMb: number;
  containers: YarnContainer[];
  stages: YarnStage[];
  log: LogLine[];
}

export type ExampleJob = 'mr-ventas' | 'hive-ventas' | 'spark-ventas';

/** Parámetro de una plantilla de trabajo. Los valores se validan en el backend: nunca llegan a una shell */
export interface JobParam {
  name: string;
  label: string;
  type: 'hdfs-path' | 'int' | 'text' | 'select' | 'bool';
  default: string | number | boolean;
  help?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  /** Solo text: expresión regular que tiene que cumplir */
  pattern?: string;
  required?: boolean;
}

/** Un trabajo que se puede lanzar en YARN con parámetros (GET /api/yarn/templates) */
export interface JobTemplate {
  id: string;
  label: string;
  engine: 'mr' | 'tez' | 'spark';
  description: string;
  params: JobParam[];
  /** El comando con {param} donde va cada valor, para mostrarlo armado */
  command: string;
  /** Lo que tiene que estar prendido: 'yarn', 'hiveserver2'… */
  needs: string[];
}

export interface SubmitJobRequest { template: string; params: Record<string, string | number | boolean> }

/* ---------- Actividad (lo que muestra la consola) ---------- */

export interface Activity {
  id: string;
  at: number;
  /** Quién: Vos, NameNode, DataNode 2, YARN, ZooKeeper, Cluster… */
  source: string;
  level: 'info' | 'ok' | 'warn' | 'error';
  title: string;
  /** El comando exacto que corrió (o el equivalente en la terminal) */
  command?: string;
  /** Qué entra */
  input?: string;
  /** Qué hace */
  action?: string;
  /** Cómo sale */
  output?: string;
  /** Línea de log técnica */
  tech?: string;
  processId?: string;
  appId?: string;
}

/* ---------- Patrón de toda acción: comando → qué entra → qué hace → cómo quedan los datos ---------- */

export type Cell = string | number | boolean | null;

/** Una muestra de datos: las primeras filas de un archivo, una tabla o un resultado */
export interface DataSample {
  columns: string[];
  rows: Cell[][];
  /** Filas (o documentos, o líneas) que hay en total, no solo las de la muestra */
  total?: number;
  /** Formato: csv, parquet, texto, tabla de Hive, documentos de MongoDB… */
  format?: string;
  note?: string;
}

/**
 * Lo que devuelve toda acción nueva del contrato (y lo que se ve en la consola).
 * Es el mismo patrón que Activity, más la muestra de los datos antes y después.
 */
export interface ActionTrace {
  /** El comando exacto que corre el backend (o el equivalente en la terminal) */
  command: string;
  /** Qué entra: archivo, tabla o parámetros */
  input: string;
  /** Qué hace, en una línea */
  action: string;
  /** Cómo quedan los datos */
  output: string;
  /** Quién hace el trabajo */
  engine?: Engine;
  before?: DataSample;
  after?: DataSample;
  /** Trabajos de YARN que lanzó */
  appIds?: string[];
}

/**
 * Respuesta de las acciones. Si la acción sigue en segundo plano (subir un archivo grande,
 * un paso del pipeline, un entrenamiento), `id` sirve para seguirla y el progreso llega por SSE.
 */
export interface ActionResult {
  id: string;
  /** done: terminó en el momento · running: sigue en segundo plano */
  state: 'done' | 'running';
  trace: ActionTrace;
}

/** GET /api/actions/:id: un comando que corrió el backend, con su salida y la foto de antes y después */
export interface ActionRun {
  id: string;
  title: string;
  command: string;
  input?: string;
  action?: string;
  source?: string;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  before?: unknown;
  after?: unknown;
  /** Últimas líneas de salida (stdout y stderr) */
  lines: { t: number; stream: 'stdout' | 'stderr' | string; text: string }[];
  error?: string;
}

/** Cuerpo de los errores HTTP: { error, code } con status 4xx/5xx */
export type ApiErrorCode =
  /** 409: el cluster no está en marcha */
  | 'cluster_stopped'
  /** 503: el servicio que hace falta está apagado (HiveServer2, MySQL, MongoDB, YARN…) */
  | 'service_down'
  /** 404 */
  | 'not_found'
  /** 403: el pedido no vino de la propia interfaz (otra página, otro host): server/sandbox_server/seguridad.py */
  | 'forbidden'
  /** 400: parámetros inválidos (ruta fuera de HDFS, SQL vacío, porcentaje fuera de rango…) */
  | 'invalid'
  /** 409: ya hay algo corriendo que lo impide (otro paso del pipeline, el mismo archivo escribiéndose) */
  | 'busy'
  /** 501: no disponible en esta versión de la imagen (por ejemplo, ML en base) */
  | 'unsupported'
  /** 500: el comando falló; el mensaje trae la última línea de su salida */
  | 'failed';

export interface ApiError { error: string; code: ApiErrorCode }

/* ---------- HDFS: árbol, archivos, fsck y re-replicación ---------- */

export interface HdfsEntry {
  path: string;
  name: string;
  type: 'dir' | 'file';
  /** Solo archivos */
  sizeMb?: number;
  replication?: number;
  blockSizeMb?: number;
  blocks?: number;
  /** Solo carpetas: cuántas cosas tiene adentro */
  children?: number;
  owner: string;
  group: string;
  /** rwxr-xr-x */
  permission: string;
  modifiedAt: number;
  /** Solo archivos: mismo significado que HdfsFile.state */
  state?: HdfsFile['state'];
}

export interface HdfsListing {
  path: string;
  /** Carpeta de arriba; null en "/" */
  parent: string | null;
  entries: HdfsEntry[];
}

/** Un archivo con sus bloques, cada bloque con sus réplicas por DataNode, y las primeras líneas */
export interface HdfsFileDetail extends HdfsFile {
  owner: string;
  permission: string;
  preview: DataSample;
  /** Salida de hdfs fsck <ruta> -files -blocks -locations, tal cual */
  fsck: string[];
}

export type HdfsExample = 'ventas' | 'numeros' | 'sucias' | 'senal' | 'texto';

/** Un tramo del contenido de un archivo (hdfs dfs -cat, leído por WebHDFS con offset y length) */
export interface HdfsCat {
  path: string;
  offset: number;
  /** Bytes leídos en este tramo */
  length: number;
  totalBytes: number;
  /** Texto del tramo (UTF-8; si es binario viene vacío) */
  text: string;
  /** Quedó contenido después de este tramo */
  truncated: boolean;
  /** El tramo tiene bytes nulos: no se muestra como texto */
  binary: boolean;
  /** El comando equivalente, para la consola */
  command: string;
}

export interface UploadRequest {
  /** Carpeta de destino en HDFS */
  dest: string;
  /** Un archivo de ejemplo de la imagen (/datos/ejemplos) … */
  example?: HdfsExample;
  /** … o uno de tu compu (multipart/form-data) */
  file?: File;
  /** -D dfs.replication=N (si no, la de la configuración) */
  replication?: number;
  /** -D dfs.blocksize=128m (si no, la de la configuración) */
  blockSize?: string;
}

export interface FsckReport {
  path: string;
  healthy: boolean;
  totalSizeMb: number;
  dirs: number;
  files: number;
  blocks: number;
  minimallyReplicated: number;
  underReplicated: number;
  overReplicated: number;
  missing: number;
  corrupt: number;
  defaultReplication: number;
  avgReplication: number;
  liveDataNodes: number;
  /** Bloques con problemas, uno por línea, como los marca fsck */
  problems: { file: string; block: string; issue: 'under' | 'missing' | 'corrupt' | 'over'; replicas: number; expected: number }[];
  /** Salida completa del comando */
  raw: string[];
  trace: ActionTrace;
}

/** Lo que el NameNode está re-replicando (o borrando de más) ahora */
export interface ReplicationTask {
  block: string;
  file: string;
  kind: 'copy' | 'delete';
  from?: number;
  to?: number;
  state: 'pending' | 'running' | 'done';
}

export interface ReplicationState {
  underReplicated: number;
  pending: number;
  missing: number;
  overReplicated: number;
  /** Sub-replicados que no tienen adónde copiarse: piden más copias que DataNodes vivos hay.
      Cuentan en underReplicated pero no entran en la cola (servidores viejos no lo mandan) */
  noRoom?: number;
  /** DataNodes vivos cuando se armó la cola */
  liveDataNodes?: number;
  /** DataNodes sin latidos y segundos que faltan para darlos por muertos */
  stale: { dataNode: number; deadInSec: number }[];
  tasks: ReplicationTask[];
  /** Últimas copias hechas, más nuevas primero */
  recent: (BlockTransfer & { at: number })[];
}

/* ---------- YARN: NodeManagers, colas, detalle de trabajos y logs ---------- */

export interface NodeManager {
  /** host:puerto con que se registró el NodeManager (en la imagen, localhost:45454) */
  id: string;
  state: 'RUNNING' | 'UNHEALTHY' | 'LOST' | 'DECOMMISSIONED';
  memTotalMb: number;
  memUsedMb: number;
  vcoresTotal: number;
  vcoresUsed: number;
  containers: (YarnContainer & { appId: string; vcores: number })[];
  lastHealthUpdate: number;
}

export interface YarnQueue {
  name: string;
  /** Porcentaje de la memoria del cluster que le toca */
  capacity: number;
  usedMb: number;
  running: number;
  pending: number;
}

export interface YarnCluster {
  totalMb: number;
  usedMb: number;
  totalVcores: number;
  usedVcores: number;
  /** Mínimo que da YARN por contenedor (yarn.scheduler.minimum-allocation-mb) */
  minAllocationMb: number;
  maxAllocationMb: number;
  nodes: NodeManager[];
  queues: YarnQueue[];
}

/** Un nodo del DAG (vértice de Tez, etapa de Spark, fase de MapReduce) con sus contadores */
export interface DagVertex {
  id: string;
  name: string;
  state: YarnStage['state'];
  tasks: number;
  tasksDone: number;
  /** Lo que hace, en el idioma del motor: "TableScan → Group By", "csv → withColumn → groupBy" */
  operators: string[];
  recordsIn?: number;
  recordsOut?: number;
  bytesReadMb?: number;
  bytesWrittenMb?: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface DagEdge { from: string; to: string; kind: string }

export interface YarnAppDetail extends YarnApp {
  engine: Engine;
  /** Lo que se mandó a correr */
  command: string;
  trackingUrl?: string;
  diagnostics?: string;
  dag: { vertices: DagVertex[]; edges: DagEdge[] };
  /** Contadores de Hadoop (MAP_INPUT_RECORDS, HDFS_BYTES_READ…) o métricas de Spark */
  counters: { group: string; name: string; value: number }[];
  /** Dónde dejó el resultado */
  outputPath?: string;
  trace: ActionTrace;
}

export interface AppLogs {
  appId: string;
  containers: { id: string; kind: YarnContainer['kind']; label: string }[];
  /** Contenedor mostrado (el del ApplicationMaster si no se pide otro) */
  container: string;
  files: { name: 'stdout' | 'stderr' | 'syslog'; lines: string[] }[];
}

/* ---------- Pipeline: Ingesta → ETL → Almacenamiento → Análisis → ML → Resultados ---------- */

export type PipelineStage = 'ingesta' | 'etl' | 'almacen' | 'analisis' | 'ml' | 'resultados';
/** Quién hace el trabajo: el cliente de HDFS, MapReduce (y Pig, Sqoop), Tez (Hive), Spark o una sola máquina (pandas, scikit-learn) */
export type Engine = 'hdfs' | 'mr' | 'tez' | 'spark' | 'uno';

export interface ToolOption {
  id: string;
  label: string;
  kind: 'select' | 'number' | 'boolean' | 'text';
  default: string | number | boolean;
  choices?: { value: string; label: string }[];
  help?: string;
  /** Solo kind number: límites del valor */
  min?: number;
  max?: number;
}

/** Una herramienta que se puede elegir en una etapa, con cuándo conviene */
export interface PipelineTool {
  /** put, sqoop, pandas, pyspark, hivetab, parquet, mysql, hive, sparksql, sklearn, mllib, getmerge, informe */
  id: string;
  label: string;
  engine: Engine;
  whenToUse: string;
  whenNot: string;
  /** El comando que corre, con las opciones por defecto */
  command: string;
  /** Script de ejemplo de la imagen que usa (ejemplos/ml/etl_pandas.py…) */
  script?: string;
  options: ToolOption[];
  /** Se puede usar con la versión y los servicios que están corriendo */
  available: boolean;
  unavailableReason?: string;
  /** La que se sugiere en esta etapa */
  recommended?: boolean;
}

export interface PipelineStageInfo {
  stage: PipelineStage;
  label: string;
  /** Qué se hace en esta etapa, en una línea */
  description: string;
  /** Qué tiene que existir antes (lo deja la etapa anterior) */
  needs: string;
  /** El dato que entra a esta etapa, en una línea (ventas_sucias.csv en HDFS) */
  input?: string;
  /** El dato que deja para la siguiente, en una línea (ventas_limpias, Parquet) */
  output?: string;
  tools: PipelineTool[];
}

export interface StepRequest {
  stage: PipelineStage;
  /** put, sqoop, pandas, pyspark, hivetab, parquet, mysql, hive, sparksql, sklearn, mllib, getmerge, informe */
  tool: string;
  options: Record<string, string | boolean | number>;
}

export interface StepRun {
  id: string;
  stage: PipelineStage;
  tool: string;
  engine: Engine;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  /** 0 a 1 */
  progress: number;
  /** Qué está haciendo ahora, en una línea */
  message: string;
  /** Trabajos de YARN que lanzó (para ver su detalle) */
  appIds: string[];
  /** Lo que dejó: ruta, filas, tamaño y un resumen (por ejemplo, lo que arregló el ETL) */
  output?: { path: string; rows?: number; sizeMb?: number; summary?: [string, string][] };
  /** Comando → qué entra → qué hace → cómo quedan (con antes y después) */
  trace?: ActionTrace;
  /** Si es de ML, el entrenamiento que lanzó */
  modelId?: string;
  error?: string;
}

/** Lo que muestra el riel fijo de la derecha */
export interface PipelineState {
  stages: { stage: PipelineStage; label: string; state: 'pending' | 'running' | 'done' | 'failed'; stepId?: string; tool?: string; engine?: Engine }[];
  /** La etapa en la que estás (la que corre, o la primera sin hacer) */
  current: PipelineStage;
  /** La que sigue y qué hace falta para hacerla */
  next: { stage: PipelineStage; hint: string } | null;
  /** Motor trabajando ahora (null si no corre nada) */
  working: { engine: Engine; stepId: string; message: string } | null;
  /** El dato que viaja por el pipeline, como quedó en la última etapa */
  dataset: { path: string; rows?: number; sizeMb?: number; format: string } | null;
}

/* ---------- Datos: Hive, MySQL y MongoDB ---------- */

/** pig: Pig Latin con pig -x mapreduce (llega con el paquete de Consultas) */
export type DataSource = 'hive' | 'mysql' | 'mongodb' | 'pig';

export interface CatalogEntry {
  source: DataSource;
  /** base.tabla o base.colección */
  name: string;
  kind: 'tabla' | 'externa' | 'colección';
  /** Filas según las estadísticas del motor. Sin estadísticas (tabla externa recién creada en Hive, sin ANALYZE TABLE) no viene */
  rows?: number;
  location?: string;
  columns: { name: string; type: string }[];
}

export interface TableSchema extends CatalogEntry {
  columns: { name: string; type: string; nullable?: boolean; key?: 'PK' | 'índice'; comment?: string;
    /** Solo MongoDB: en qué porcentaje de los documentos aparece el campo */
    presence?: number }[];
  /** textfile, parquet, InnoDB, WiredTiger */
  format?: string;
  sizeMb?: number;
  partitions?: string[];
  indexes?: { name: string; columns: string[]; unique: boolean }[];
  /** SHOW CREATE TABLE (o el validador/índices de la colección) */
  ddl?: string;
  sample: DataSample;
}

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
  /** Tiempo que tardó */
  ms: number;
  /** Si la consulta lanzó un trabajo en YARN (Hive → Tez) */
  appId?: string;
  note?: string;
  /** Quién la resolvió: tez para Hive con trabajo, uno para MySQL/MongoDB o Hive sin trabajo (fetch task) */
  engine?: Engine;
  /** Filas que leyó el motor (no las que devolvió) */
  scanned?: number;
  trace?: ActionTrace;
  /** La salida del comando como en la terminal (Hive, MySQL y Pig; el demo no la tiene) */
  raw?: { stream: 'out' | 'err'; text: string }[];
}

export interface QueryPlan {
  source: DataSource;
  engine: Engine;
  /** Árbol del plan: cada nodo con sus hijos por índice */
  nodes: { id: number; label: string; detail?: string; children: number[]; rows?: number }[];
  /** Salida de EXPLAIN / explain("executionStats") tal cual */
  raw: string[];
  /** Si va a lanzar un trabajo en YARN y con cuántas etapas */
  yarnStages?: number;
}

export interface QueryExample { source: DataSource; label: string; text: string; script?: string }

/* ---------- Machine Learning ---------- */

export type MlTask = 'regresion' | 'clasificacion' | 'clustering';

export interface MlDataset {
  /** senal */
  id: string;
  label: string;
  path: string;
  rows: number;
  /** Cómo se generó (ejemplos/ml/generar_senal.py) */
  script?: string;
  columns: { name: string; type: string; role: 'entrada' | 'objetivo' | 'respuesta' | 'ignorar'; note?: string }[];
  /** Qué se puede predecir y qué tipo de problema es */
  targets: { column: string | null; task: MlTask; label: string }[];
  sample: DataSample;
  /** Está en HDFS (MLlib lo necesita ahí; scikit-learn lo lee de /datos) */
  inHdfs: boolean;
}

export interface ModelChoice {
  /** lineal, arbol, logistica, mlp, kmeans, tonto */
  model: string;
  label: string;
  engine: 'sklearn' | 'mllib';
  fit: 'recomendado' | 'sirve' | 'línea base' | 'no conviene';
  why: string;
  /** Costo esperado, medido en el sandbox */
  expected?: { seconds: number; memoryMb: number; metric: string; value: number };
}

export interface MlRecommendation {
  dataset: string;
  task: MlTask;
  /** Por qué es este tipo de problema */
  why: string;
  /** Qué motor conviene con este tamaño de datos */
  engineAdvice: string;
  choices: ModelChoice[];
}

export interface TrainRequest {
  task: MlTask;
  /** lineal, arbol, logistica, mlp, kmeans, tonto */
  model: string;
  engine: 'sklearn' | 'mllib';
  /** Porcentaje para entrenar (el resto, para probar) */
  trainPct: number;
  /** senal si no se dice otro */
  dataset?: string;
  /** Hiperparámetros (profundidad del árbol, k de KMeans, capas de la red…) */
  params?: Record<string, number | string>;
  /** Columna objetivo (null en clustering). Si no viene, la de targets que corresponde a task */
  target?: string | null;
  /** Columnas de entrada. Si no viene, las que tienen role 'entrada' en el dataset */
  features?: string[];
}

export interface ModelRun {
  id: string;
  task: MlTask;
  model: string;
  engine: 'sklearn' | 'mllib';
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  progress: number;
  message: string;
  trainRows: number;
  /** Filas de prueba. En clustering es 0: se entrena con todo y se mide contra segmento_real */
  testRows: number;
  /** r2, error_medio, aciertos, validacion_cruzada, rand_ajustado… */
  metrics: Record<string, number>;
  /** Tiempo de entrenamiento medido y memoria que usó */
  seconds?: number;
  memoryMb?: number;
  /** Lo aprendido: coeficientes, importancias, reglas del árbol, grupos */
  learned?: { title: string; rows: [string, string, string?][] }[];
  appId?: string;
  /** Valores de referencia y no medidos en este momento (modo demo con Spark MLlib; el backend real siempre mide: false) */
  reference?: boolean;
  dataset?: string;
  /** Matriz de confusión (clasificación): filas = real, columnas = predicho */
  confusion?: { labels: string[]; matrix: number[][] };
  /** Algunas filas de prueba con lo real y lo predicho */
  predictions?: DataSample;
  /** Con qué se entrenó: objetivo, columnas de entrada e hiperparámetros (eco de TrainRequest con los valores por defecto aplicados) */
  target?: string | null;
  features?: string[];
  params?: Record<string, number | string>;
  trace?: ActionTrace;
  error?: string;
  /** Hay algo para dibujar en GET /api/ml/models/{id}/viz (los últimos 30 modelos) */
  hasViz?: boolean;
  /** Por qué no se pudo armar el dibujo (el modelo vale igual) */
  vizError?: string;
}

/* ---------- Lo de adentro de un modelo (GET /api/ml/models/{id}/viz, server/sandbox_server/jobs/viz.py) ---------- */

/** Filas de muestra con lo que predijo el modelo de verdad (la interfaz rehace la cuenta y tiene que dar lo mismo) */
export interface VizSample {
  rows: number[][];
  /** Lo real: 0/1 en clasificación, el gasto en regresión, el segmento en KMeans */
  real?: (number | string)[];
  pred?: number[];
  /** Probabilidad de cada clase (clasificación) */
  proba?: number[][];
}
/** Cómo se escalan las entradas: (x − mean) / scale. zeroScale: qué pasa si scale es 0 ('zero' = Spark da 0, 'one' = scikit-learn divide por 1) */
export interface VizScaler { mean: number[]; scale: number[]; zeroScale?: 'zero' | 'one' }
interface VizBase { v: number; engine: 'sklearn' | 'mllib'; features: string[]; sample?: VizSample; truncated?: string }
export interface VizEpochFrame { epoch: number; weights: number[][][]; biases: number[][] }
export interface MlpViz extends VizBase {
  kind: 'mlp';
  classes: string[];
  /** Neuronas por capa, de la entrada a la salida */
  layers: number[];
  hidden: 'relu' | 'logistic' | 'tanh' | 'identity';
  /** logistic: una salida (scikit-learn, binaria); softmax: una por clase (Spark) */
  out: 'logistic' | 'softmax';
  scaler: VizScaler;
  /** weights[k][i][j]: de la neurona i de la capa k a la j de la capa k+1. null si la red pasa del tope */
  weights: number[][][] | null;
  biases: number[][] | null;
  /** Cómo fue aprendiendo (solo scikit-learn): pérdida y validación por época, y los pesos de algunas épocas */
  epochs?: { loss: number[]; val: number[] | null; best: number | null; frames: VizEpochFrame[]; chosen: string; note?: string } | null;
  epochsNote?: string;
}
/** Nodo del árbol (a lo ancho): f = columna (−1 hoja), t = umbral (va a la izquierda si x ≤ t), p = proporción de cada clase */
export interface TreeNode { f: number; t: number | null; imp: number; n: number; p: number[]; d: number; l: number; r: number; cut: boolean }
export interface TreeViz extends VizBase {
  kind: 'tree';
  classes: string[];
  impurity: string;
  nodes: TreeNode[];
  /** scikit-learn compara en float32 */
  float32: boolean;
}
export interface KMeansViz extends VizBase {
  kind: 'kmeans';
  k: number;
  /** log: columnas que se pasan a logaritmo antes de escalar (ticket_promedio) */
  transform: { log: boolean[]; mean: number[]; scale: number[]; zeroScale?: 'zero' | 'one' };
  /** Centros de cada iteración (en el espacio escalado); el último son los del modelo */
  frames: { it: number; centers: number[][] }[];
  /** Si el recorrido rehecho desde k-means++ llegó a los centros del modelo */
  replaySame: boolean;
  /** Para dibujar más de 3 columnas: media y 3 direcciones principales */
  pca: { mean: number[]; comps: number[][] } | null;
}
export interface Ranges { mean: number[]; min: number[]; max: number[] }
export interface LinearViz extends VizBase { kind: 'linear'; target: string; coef: number[]; intercept: number; ranges: Ranges }
export interface LogisticViz extends VizBase { kind: 'logistic'; classes: string[]; coef: number[]; intercept: number; scaler: VizScaler; ranges: Ranges }
export interface DummyViz extends VizBase { kind: 'dummy'; classes: string[]; prior: number[]; strategy: string }
export type ModelViz = MlpViz | TreeViz | KMeansViz | LinearViz | LogisticViz | DummyViz;

/* ---------- Eventos en vivo (SSE en GET /api/events) ---------- */

export type ApiEvent =
  | { type: 'status' }
  | { type: 'activity'; entry: Activity }
  | { type: 'transfer'; transfer: BlockTransfer }
  | { type: 'yarn'; appId: string }
  /** Cambió algo en HDFS (se subió, borró o terminó de escribir un archivo) */
  | { type: 'hdfs'; path: string }
  /** Avance de un paso del pipeline. Sin step: se reinició el pipeline (POST /api/pipeline/reset) */
  | { type: 'step'; step?: StepRun }
  /** Avance de un entrenamiento */
  | { type: 'model'; run: ModelRun }
  /** Avance de una corrida del estudio de ML (avance, ajustes de la búsqueda, memoria) */
  | { type: 'mlrun'; run: MlCorrida }
  /** Empezó o terminó una acción del backend (GET /api/actions/:id). El backend también manda una por
      cada línea de salida ({ id, t, stream, text }), pero el cliente solo reenvía las que traen state */
  | { type: 'action'; id: string; state: ActionRun['state']; exitCode?: number };

/* ---------- La interfaz ---------- */

export interface SandboxApi {
  readonly mode: 'demo' | 'live';
  /** Reloj del cluster en epoch ms */
  now(): number;

  /** GET /api/status */
  status(): Promise<ClusterStatus>;
  /** GET /api/activity?limit=200 */
  activity(): Promise<Activity[]>;
  /** GET /api/events (Server-Sent Events). Devuelve la función para desuscribirse */
  subscribe(fn: (e: ApiEvent) => void): () => void;

  /** POST /api/config/validate  { config } → ConfigIssue[] */
  validate(config: ClusterConfig): Promise<ConfigIssue[]>;
  /** POST /api/config/estimate { config } → RamEstimate */
  estimate(config: ClusterConfig): Promise<RamEstimate>;
  /** POST /api/config/compose { config } → text/yaml */
  compose(config: ClusterConfig): Promise<string>;
  /** PUT /api/config { config }: guarda sin aplicar */
  saveConfig(config: ClusterConfig): Promise<void>;

  /** POST /api/cluster/start { config } → 202; el progreso llega por status().boot */
  start(config: ClusterConfig): Promise<void>;
  /** POST /api/cluster/stop → 202 (apagado en orden, como docker stop) */
  stop(): Promise<void>;
  /** POST /api/cluster/apply { config } → 202: reinicia con la nueva configuración */
  apply(config: ClusterConfig): Promise<void>;
  /** POST /api/cluster/reset → 202: borra el volumen (docker compose down -v) */
  resetVolume(): Promise<void>;

  /** POST /api/processes/:id/start | /stop → 202 { id } (el id de la acción, para action(id)) */
  processAction(id: string, action: 'start' | 'stop'): Promise<{ id: string } | void>;
  /** GET /api/actions/:id → la acción con su salida (sirve para ver qué pasó con un comando) */
  action(id: string): Promise<ActionRun>;

  /** GET /api/hdfs/datanodes */
  dataNodes(): Promise<DataNode[]>;
  /** GET /api/hdfs/files?recursive=1 (con bloques y ubicaciones, como hdfs fsck -files -blocks -locations) */
  files(): Promise<HdfsFile[]>;
  /** POST /api/hdfs/put { example: 'ventas' | 'numeros' | 'sucias' } → 202 */
  putExample(example: 'ventas' | 'numeros' | 'sucias'): Promise<void>;
  /** PATCH /api/hdfs/files { path, replication } (hdfs dfs -setrep; con -w solo si hay DataNodes vivos para esa replicación) */
  setReplication(path: string, replication: number): Promise<{ id: string } | void>;
  /** POST /api/hdfs/datanodes { id } → 202 (datanode start N en caliente) */
  addDataNode(): Promise<void>;

  /** GET /api/hdfs/ls?path=/user/root → una carpeta, para armar el árbol de a un nivel */
  hdfsList(path: string): Promise<HdfsListing>;
  /** GET /api/hdfs/file?path=… → bloques, réplicas por DataNode, primeras líneas y fsck del archivo */
  hdfsFile(path: string): Promise<HdfsFileDetail>;
  /** POST /api/hdfs/upload (JSON { dest, example, replication, blockSize } o multipart con file) → 202 ActionResult; avanza por SSE transfer/hdfs */
  hdfsUpload(req: UploadRequest): Promise<ActionResult>;
  /** POST /api/hdfs/mkdir { path } → ActionResult */
  hdfsMkdir(path: string): Promise<ActionResult>;
  /** DELETE /api/hdfs/files?path=…&recursive=1 → ActionResult (hdfs dfs -rm -r -skipTrash) */
  hdfsDelete(path: string, recursive: boolean): Promise<ActionResult>;
  /** GET /api/hdfs/fsck?path=/ → informe de hdfs fsck */
  fsck(path: string): Promise<FsckReport>;
  /** GET /api/hdfs/replication → lo que el NameNode está re-replicando ahora */
  replication(): Promise<ReplicationState>;
  /** GET /api/hdfs/cat?path=…&offset=0&length=65536 (máx. 1 MiB por tramo) */
  hdfsCat(path: string, offset?: number, length?: number): Promise<HdfsCat>;
  /** GET /api/hdfs/download?path=… (attachment). Devuelve la URL para bajarlo y el nombre del archivo */
  hdfsDownload(path: string): Promise<{ url: string; name: string }>;
  /** POST /api/hdfs/move { from, to } → ActionResult (hdfs dfs -mv) y la ruta final (con destino carpeta, queda adentro) */
  hdfsMove(from: string, to: string): Promise<ActionResult & { path: string }>;

  /** GET /api/yarn/apps */
  apps(): Promise<YarnApp[]>;
  /** POST /api/yarn/apps { example } → { id } */
  submitExample(job: ExampleJob): Promise<string>;
  /** POST /api/yarn/apps/:id/kill */
  killApp(id: string): Promise<void>;
  /** GET /api/yarn/templates → trabajos que se pueden lanzar con parámetros */
  jobTemplates(): Promise<JobTemplate[]>;
  /** POST /api/yarn/apps { template, params } → { id } */
  submitJob(req: SubmitJobRequest): Promise<string>;

  /** GET /api/yarn/cluster → memoria y vcores por NodeManager, contenedores y colas */
  yarnCluster(): Promise<YarnCluster>;
  /** GET /api/yarn/apps/:id → detalle con el DAG (Tez, Spark o MapReduce), contadores y comando */
  app(id: string): Promise<YarnAppDetail>;
  /** GET /api/yarn/apps/:id/logs?container=… → stdout, stderr y syslog de un contenedor */
  appLogs(id: string, container?: string): Promise<AppLogs>;

  /** GET /api/pipeline/catalog → etapas y herramientas, con cuándo conviene cada una */
  pipelineCatalog(): Promise<PipelineStageInfo[]>;
  /** GET /api/pipeline → el riel: etapa actual, qué sigue, motor trabajando, dato que viaja */
  pipelineState(): Promise<PipelineState>;
  /** POST /api/pipeline/steps { stage, tool, options } → { id }; avanza por SSE step */
  runStep(req: StepRequest): Promise<string>;
  /** GET /api/pipeline/steps */
  steps(): Promise<StepRun[]>;
  /** POST /api/pipeline/reset → vuelve a la primera etapa y vacía el historial (no borra lo que hay en HDFS); manda un evento step sin step */
  pipelineReset(): Promise<void>;

  /** GET /api/data/catalog: tablas de Hive y MySQL y colecciones de MongoDB */
  catalog(): Promise<CatalogEntry[]>;
  /** GET /api/data/schema?source=hive&name=default.ventas → columnas, formato, índices, DDL y muestra */
  schema(source: DataSource, name: string): Promise<TableSchema>;
  /** POST /api/data/query { source, text } (SQL para Hive y MySQL, mongosh para MongoDB) */
  query(source: DataSource, text: string): Promise<QueryResult>;
  /** POST /api/data/explain { source, text } → plan (EXPLAIN de Hive y MySQL, explain() de MongoDB) */
  explain(source: DataSource, text: string): Promise<QueryPlan>;
  /** GET /api/data/examples → consultas de ejemplo de la imagen (ventas.hql, tienda.hql, consultas_mongo.js) */
  queryExamples(): Promise<QueryExample[]>;

  /** GET /api/ml/datasets → datos para entrenar, con columnas y qué se puede predecir */
  mlDatasets(): Promise<MlDataset[]>;
  /** POST /api/ml/recommend { dataset, task } → tipo de problema y modelos recomendados, con su costo */
  recommend(dataset: string, task: MlTask): Promise<MlRecommendation>;
  /** POST /api/ml/train { task, model, engine, trainPct, dataset, params, target, features } → 202 { id }; avanza por SSE model */
  train(req: TrainRequest): Promise<string>;
  /** GET /api/ml/models */
  models(): Promise<ModelRun[]>;
  /** GET /api/ml/models/{id}/viz → lo de adentro del modelo, para dibujarlo */
  modelViz(id: string): Promise<ModelViz>;

  /* Estudio de ML (server/sandbox_server/ml_estudio.py, tipos en estudio.ts) */
  /** GET /api/ml/catalog → modelos con sus hiperparámetros, métricas, validaciones y búsquedas */
  mlCatalog(): Promise<MlCatalogo>;
  /** GET /api/ml/sources → archivos de /datos y de HDFS en cualquier formato (comprimidos, particionados) y tablas de Hive */
  mlSources(): Promise<MlFuentes>;
  /** POST /api/ml/sources/example { ejemplo: senal | sucias } → genera el dataset de ejemplo en /datos y devuelve sus datos */
  mlExample(ejemplo: 'senal' | 'sucias'): Promise<MlDatos>;
  /** POST /api/ml/profile { datos, objetivo?, motor?, modo?, filas? } → perfil de columnas con pandas o con Spark en YARN
   *  (con el objetivo: balance y, con pandas, la asociación de cada columna) */
  mlProfile(datos: MlDatos, objetivo?: string | null, opciones?: MlPerfilOpciones): Promise<MlPerfil>;
  /** POST /api/ml/cleaning/preview { datos, limpieza, objetivo?, filas? } → cada paso sobre una muestra, en Spark local */
  mlCleaningPreview(datos: MlDatos, limpieza: MlLimpieza, objetivo?: string | null, filas?: number): Promise<MlVistaLimpieza>;
  /** GET /api/ml/cleaning → las recetas de limpieza guardadas */
  mlCleanings(): Promise<MlLimpiezaFila[]>;
  /** GET /api/ml/cleaning/{nombre} → una receta de limpieza con todas sus versiones */
  mlCleaning(nombre: string): Promise<MlLimpiezaGuardada>;
  /** POST /api/ml/cleaning { nombre, limpieza, nota? } → la guarda como versión nueva (si cambió) */
  mlSaveCleaning(nombre: string, limpieza: MlLimpieza, nota?: string | null): Promise<{ nombre: string; version: number; huella: string; creado: string; nueva: boolean }>;
  /** POST /api/ml/check { receta } → receta completa, errores y avisos */
  mlCheck(receta: MlReceta): Promise<MlRevision>;
  /** POST /api/ml/code { receta, parte?, opciones? } → el script que reproduce el entrenamiento, el perfil o la limpieza */
  mlCode(receta: MlReceta, parte?: MlParteCodigo, opciones?: MlPerfilOpciones): Promise<MlCodigo>;
  /** POST /api/ml/experiments { receta } → 202 { id (experimento), run (corrida) }; avanza por SSE mlrun */
  mlTrain(receta: MlReceta): Promise<{ id: string; run: string }>;
  /** POST /api/ml/runs { codigo, motor, receta?, minutos?, memoriaMb? } → 202: corre código editado */
  mlRunCode(req: MlCorrerCodigo): Promise<{ id: string; run: string }>;
  /** GET /api/ml/runs → corridas recientes */
  mlRuns(): Promise<MlCorrida[]>;
  /** GET /api/ml/runs/{id}?desde=N → estado y las líneas de salida desde la N */
  mlRun(id: string, desde?: number): Promise<MlCorrida>;
  /** POST /api/ml/runs/{id}/cancel */
  mlCancel(id: string): Promise<MlCorrida>;
  /** GET /api/ml/experiments → tabla de posiciones */
  mlExperiments(): Promise<MlExperimentoFila[]>;
  /** GET /api/ml/experiments/{id} → experimento con su informe (lo que dibujan los gráficos) */
  mlExperiment(id: string): Promise<MlExperimento>;
  /** DELETE /api/ml/experiments/{id} */
  mlDeleteExperiment(id: string): Promise<void>;
  /** GET /api/ml/experiments/{id}/download?formato=py|ipynb|modelo|log: la URL para bajarlo */
  mlDownload(id: string, formato: 'py' | 'ipynb' | 'modelo' | 'log'): Promise<{ url: string; name: string }>;
  /** POST /api/ml/experiments/{id}/jupyter → copia el notebook a /datos/experimentos */
  mlToJupyter(id: string): Promise<{ ruta: string; jupyter: boolean; url: string }>;
  /** POST /api/ml/experiments/{id}/predict { filas } o { archivo } */
  mlPredict(id: string, req: { filas?: Record<string, unknown>[]; archivo?: string }): Promise<MlPrediccion>;
}
