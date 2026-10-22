/*
 * Contrato entre la interfaz y el backend del contenedor.
 *
 * Las pantallas solo conocen la interfaz SandboxApi. Hay dos implementaciones:
 *   - DemoApi (api/demo): un cluster simulado en el navegador. Es el "modo demo"
 *     y lo que se publica en GitHub Pages.
 *   - HttpApi (api/http.ts): habla con el backend real en :8080 (rutas /api/...).
 * La correspondencia con las rutas HTTP está al lado de cada método.
 */

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

/* ---------- Pipeline ---------- */

export type PipelineStage = 'ingesta' | 'etl' | 'almacen' | 'analisis' | 'ml' | 'resultados';
/** Quién hace el trabajo: el cliente de HDFS, MapReduce (y Pig, Sqoop), Tez (Hive), Spark o una sola máquina (pandas, scikit-learn) */
export type Engine = 'hdfs' | 'mr' | 'tez' | 'spark' | 'uno';

export interface StepRequest {
  stage: PipelineStage;
  /** put, sqoop, pandas, pyspark, pig, hive, hivetab, mysql, mongo, sparksql */
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
}

/* ---------- Datos: Hive, MySQL y MongoDB ---------- */

export type DataSource = 'hive' | 'mysql' | 'mongodb';

export interface CatalogEntry {
  source: DataSource;
  /** base.tabla o base.colección */
  name: string;
  kind: 'tabla' | 'externa' | 'colección';
  rows: number;
  location?: string;
  columns: { name: string; type: string }[];
}

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
  /** Tiempo que tardó */
  ms: number;
  /** Si la consulta lanzó un trabajo en YARN (Hive → Tez) */
  appId?: string;
  note?: string;
}

/* ---------- Machine Learning ---------- */

export type MlTask = 'regresion' | 'clasificacion' | 'clustering';

export interface TrainRequest {
  task: MlTask;
  /** lineal, arbol, logistica, mlp, kmeans, tonto */
  model: string;
  engine: 'sklearn' | 'mllib';
  /** Porcentaje para entrenar (el resto, para probar) */
  trainPct: number;
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
  testRows: number;
  /** r2, error_medio, aciertos, validacion_cruzada, rand_ajustado… */
  metrics: Record<string, number>;
  /** Tiempo de entrenamiento medido y memoria que usó */
  seconds?: number;
  memoryMb?: number;
  /** Lo aprendido: coeficientes, importancias, reglas del árbol, grupos */
  learned?: { title: string; rows: [string, string, string?][] }[];
  appId?: string;
  /** Valores de referencia y no medidos en este momento (modo demo con Spark MLlib) */
  reference?: boolean;
}

/* ---------- Eventos en vivo (SSE en GET /api/events) ---------- */

export type ApiEvent =
  | { type: 'status' }
  | { type: 'activity'; entry: Activity }
  | { type: 'transfer'; transfer: BlockTransfer }
  | { type: 'yarn'; appId: string };

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

  /** POST /api/processes/:id/start | /stop → 202 */
  processAction(id: string, action: 'start' | 'stop'): Promise<void>;

  /** GET /api/hdfs/datanodes */
  dataNodes(): Promise<DataNode[]>;
  /** GET /api/hdfs/files?recursive=1 (con bloques y ubicaciones, como hdfs fsck -files -blocks -locations) */
  files(): Promise<HdfsFile[]>;
  /** POST /api/hdfs/put { example: 'ventas' | 'numeros' | 'sucias' } → 202 */
  putExample(example: 'ventas' | 'numeros' | 'sucias'): Promise<void>;
  /** PATCH /api/hdfs/files { path, replication } (hdfs dfs -setrep) */
  setReplication(path: string, replication: number): Promise<void>;
  /** POST /api/hdfs/datanodes { id } → 202 (datanode start N en caliente) */
  addDataNode(): Promise<void>;

  /** GET /api/yarn/apps */
  apps(): Promise<YarnApp[]>;
  /** POST /api/yarn/apps { example } → { id } */
  submitExample(job: ExampleJob): Promise<string>;
  /** POST /api/yarn/apps/:id/kill */
  killApp(id: string): Promise<void>;

  /** POST /api/pipeline/steps { stage, tool, options } → { id } */
  runStep(req: StepRequest): Promise<string>;
  /** GET /api/pipeline/steps */
  steps(): Promise<StepRun[]>;

  /** GET /api/data/catalog: tablas de Hive y MySQL y colecciones de MongoDB */
  catalog(): Promise<CatalogEntry[]>;
  /** POST /api/data/query { source, text } (SQL para Hive y MySQL, mongosh para MongoDB) */
  query(source: DataSource, text: string): Promise<QueryResult>;

  /** POST /api/ml/train { task, model, engine, trainPct } → { id } */
  train(req: TrainRequest): Promise<string>;
  /** GET /api/ml/models */
  models(): Promise<ModelRun[]>;
}
