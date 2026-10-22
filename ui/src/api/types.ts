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

/** Cuerpo de los errores HTTP: { error, code } con status 4xx/5xx */
export type ApiErrorCode =
  /** 409: el cluster no está en marcha */
  | 'cluster_stopped'
  /** 503: el servicio que hace falta está apagado (HiveServer2, MySQL, MongoDB, YARN…) */
  | 'service_down'
  /** 404 */
  | 'not_found'
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
  /** DataNodes sin latidos y segundos que faltan para darlos por muertos */
  stale: { dataNode: number; deadInSec: number }[];
  tasks: ReplicationTask[];
  /** Últimas copias hechas, más nuevas primero */
  recent: (BlockTransfer & { at: number })[];
}

/* ---------- YARN: NodeManagers, colas, detalle de trabajos y logs ---------- */

export interface NodeManager {
  /** bigdata:45454 */
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
}

/* ---------- Eventos en vivo (SSE en GET /api/events) ---------- */

export type ApiEvent =
  | { type: 'status' }
  | { type: 'activity'; entry: Activity }
  | { type: 'transfer'; transfer: BlockTransfer }
  | { type: 'yarn'; appId: string }
  /** Cambió algo en HDFS (se subió, borró o terminó de escribir un archivo) */
  | { type: 'hdfs'; path: string }
  /** Avance de un paso del pipeline */
  | { type: 'step'; step: StepRun }
  /** Avance de un entrenamiento */
  | { type: 'model'; run: ModelRun };

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

  /** GET /api/yarn/apps */
  apps(): Promise<YarnApp[]>;
  /** POST /api/yarn/apps { example } → { id } */
  submitExample(job: ExampleJob): Promise<string>;
  /** POST /api/yarn/apps/:id/kill */
  killApp(id: string): Promise<void>;

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
  /** POST /api/pipeline/reset → vuelve a la primera etapa (no borra lo que hay en HDFS) */
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
  /** POST /api/ml/train { task, model, engine, trainPct, dataset, params } → { id }; avanza por SSE model */
  train(req: TrainRequest): Promise<string>;
  /** GET /api/ml/models */
  models(): Promise<ModelRun[]>;
}
