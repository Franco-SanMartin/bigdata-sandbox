/* Cluster simulado del modo demo. Imita lo que el backend real lee del NameNode (JMX),
   del ResourceManager (REST) y de los logs, con los tiempos acelerados. */
import type {
  Activity, AppType, ApiEvent, BlockTransfer, BootProgress, BootStep, ClusterConfig, ClusterPhase, ClusterStatus,
  DataNode, ExampleJob, HdfsFile, LogLine, Process, ProcState, YarnApp, YarnStage, YarnTask,
} from '../types';
import { DEFAULT_CONFIG, DEFAULT_IMAGE_TAG, DOCKER_LIMIT_MB, blockSizeMb, configSummary, estimateRam, processSpecs, type ProcSpec } from '../../lib/cluster';

import { SPEED } from './speed';
export { SPEED };
export const TS = '1792041277726';       // marca de tiempo del ResourceManager en los ids de YARN
export const DEAD_AFTER = 40;            // s sin latidos hasta que el NameNode da por muerto a un DataNode
export const YARN_MB = 4096;

let seed = 2026;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

interface DnRec { id: number; s: 'up' | 'stopping' | 'dead' | 'starting' | 'off'; since: number; ghosts: number[]; tok: object }
export interface BlockRec { id: number; gs: number; n: number; mb: number; reps: number[]; want: number[] }
export interface FileRec { path: string; sizeMb: number; rep: number; bsMb: number; blocks: BlockRec[]; writing: boolean; by: string; at: number }
interface ProcRec { spec: ProcSpec; state: ProcState; upSince?: number; pid?: number; role?: 'active' | 'standby' }
interface StepRec extends BootStep { lines: { at: number; level: LogLine['level']; text: string }[] }
export interface TaskRec extends YarnTask { dur: number; blockId?: number; slot?: number }
export interface StageRec extends Omit<YarnStage, 'tasks'> { tasks: TaskRec[]; durSec: number; blocks?: number[]; ops?: string[] }
export interface StageDef { id: string; name: string; description: string; dependsOn: string[]; edge?: string; durSec: number; n: number; blocks?: number[]; ops?: string[] }
/** rowsIn/rowsOut/out: filas que lee y escribe y dónde deja el resultado (para el detalle del trabajo) */
export interface AppDef { type: AppType; name: string; am: number; amStart: number; taskMb: number; executors: number; stages: StageDef[]; rowsIn?: number; rowsOut?: number; out?: string }
export interface AppRec { cmd?: string; input?: string; def?: AppDef; id: string; num: string; name: string; type: AppType; state: YarnApp['state']; sub: number; start?: number; end?: number; am: number; amStart: number; taskMb: number; executors: number; slots: { busy: TaskRec | null; cont: string }[]; conts: { id: string; memoryMb: number; kind: 'am' | 'task' | 'executor'; label: string }[]; cseq: number; stages: StageRec[]; log: LogLine[]; onDone?: () => void; amReadyAt?: number }

/** Un archivo para subir a HDFS: de dónde sale y cuánto pesa */
export interface PutSpec { path: string; mb: number; local: string; rows: string; rep?: number; bsMb?: number }

/* Lo que no es privado lo usan los módulos del demo (hdfs.ts, yarn.ts, pipeline.ts, datos.ts, ml.ts) */
export class DemoEngine {
  private t0 = performance.now();
  private epoch = Date.now();
  private queue: { t: number; fn: () => void }[] = [];
  private listeners = new Set<(e: ApiEvent) => void>();

  config: ClusterConfig = { ...DEFAULT_CONFIG };
  applied: ClusterConfig | null = null;
  phase: ClusterPhase = 'stopped';
  volumeNN: number | null = null;
  startedAt: number | null = null;
  procs = new Map<string, ProcRec>();
  dns: DnRec[] = [];
  files: FileRec[] = [];
  jobs: AppRec[] = [];
  private acts: Activity[] = [];
  private mem: { t: number; usedMb: number }[] = [];
  private boot: (Omit<BootProgress, 'steps'> & { steps: StepRec[] }) | null = null;
  hdfsDown = false;
  private libs = false;
  private blk = 1073741825;
  private gs = 1001;
  private appSeq = 0;
  private actSeq = 0;
  private replBusy = false;
  private bootCount = 0;
  /** Carpetas creadas a mano (hdfs dfs -mkdir) */
  dirs = new Set<string>();
  /** Ya se cargaron las carpetas del arranque en dirs */
  dirsReady = false;
  /** Últimas copias de bloques, para la vista de re-replicación */
  transfers: (BlockTransfer & { at: number })[] = [];

  constructor() {
    setInterval(() => this.tick(), 100);
    this.act('Cluster', 'info', 'Interfaz lista. El cluster está apagado', { output: 'Elegí la configuración y arrancalo desde Cluster o Configuración.' });
  }

  /* ---------- Reloj y eventos ---------- */
  now(): number { return this.epoch + (performance.now() - this.t0) * SPEED; }
  at(sec: number, fn: () => void) { this.queue.push({ t: this.now() + sec * 1000, fn }); }
  subscribe(fn: (e: ApiEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  emit(e: ApiEvent = { type: 'status' }) {
    if (e.type === 'transfer') { this.transfers.unshift({ ...e.transfer, at: this.now() }); if (this.transfers.length > 50) this.transfers.pop(); }
    this.listeners.forEach(l => l(e));
  }
  private tick() {
    const n = this.now();
    this.queue.sort((a, b) => a.t - b.t);
    let changed = false;
    while (this.queue.length && this.queue[0].t <= n) { this.queue.shift()!.fn(); changed = true; }
    if (this.boot && !this.boot.finishedAt) changed = this.bootTick(n) || changed;
    if (this.phase === 'running') changed = this.yarnSchedule() || changed;
    if (this.phase === 'running' && (!this.mem.length || n - this.mem[this.mem.length - 1].t >= 10000)) {
      this.mem.push({ t: n, usedMb: this.usedMb() }); if (this.mem.length > 60) this.mem.shift(); changed = true;
    }
    if (changed) this.emit();
  }
  act(source: string, level: Activity['level'], title: string, o: Partial<Activity> = {}) {
    const entry: Activity = { id: 'a' + ++this.actSeq, at: this.now(), source, level, title, ...o };
    this.acts.unshift(entry); if (this.acts.length > 400) this.acts.pop();
    this.emit({ type: 'activity', entry });
  }
  activity(): Activity[] { return this.acts.slice(); }

  /* ---------- Arranque ---------- */
  start(cfg: ClusterConfig) {
    if (this.phase !== 'stopped') return;
    this.config = { ...cfg };
    const first = this.volumeNN == null;
    if (first) this.volumeNN = cfg.namenodes;
    const steps = this.buildSteps(cfg, first);
    const t = this.now();
    this.phase = 'starting'; this.startedAt = null; this.bootCount++;
    this.boot = { kind: first ? 'first' : 'restart', steps, startedAt: t, expectedSec: steps.reduce((a, s) => a + (s.state === 'skipped' ? 0 : s.expectedSec), 0) };
    this.procs = new Map(processSpecs(cfg).map(spec => [spec.id, { spec, state: 'off' as ProcState }]));
    this.act('Vos', 'info', first ? 'Primer arranque del cluster' : 'Arranque del cluster', {
      command: 'docker compose up -d', input: configSummary(cfg),
      action: first ? 'Formatea HDFS, levanta cada proceso en orden y carga las bases de ejemplo' : 'Levanta cada proceso en orden; los datos del volumen quedan como estaban',
      output: `${processSpecs(cfg).length} procesos, unos ${Math.round(this.boot.expectedSec / 60 * 10) / 10} min`,
    });
    this.emit();
  }
  private bootTick(n: number): boolean {
    const b = this.boot!; let changed = false;
    let cur = b.steps.find(s => s.state === 'running');
    if (!cur) {
      cur = b.steps.find(s => s.state === 'pending');
      if (!cur) { this.bootDone(); return true; }
      cur.state = 'running'; cur.startedAt = n; changed = true;
      cur.processes.forEach(id => { const p = this.procs.get(id); if (p) p.state = 'starting'; });
    }
    const el = (n - cur.startedAt!) / 1000;
    const due = cur.lines.filter(l => l.at <= el);
    if (due.length !== cur.log.length) { cur.log = due.map(l => ({ t: cur!.startedAt! + l.at * 1000, level: l.level, text: l.text })); changed = true; }
    if (el >= cur.expectedSec) {
      cur.state = 'done'; cur.finishedAt = n; changed = true;
      cur.processes.forEach(id => this.procUp(id));
      if (cur.id === 'dn') this.dns = this.config.datanodes ? Array.from({ length: this.config.datanodes }, (_, i) => ({ id: i + 1, s: 'up' as const, since: n, ghosts: this.dns.find(d => d.id === i + 1)?.ghosts || [], tok: {} })) : [];
    }
    return changed;
  }
  private procUp(id: string) {
    const p = this.procs.get(id); if (!p) return;
    p.state = 'up'; p.upSince = this.now(); p.pid = 1800 + Math.floor(rnd() * 6000);
    if (p.spec.kind === 'namenode') p.role = this.config.namenodes > 1 ? (id === 'nn1' ? 'active' : 'standby') : 'active';
  }
  private bootDone() {
    const b = this.boot!; const n = this.now();
    b.finishedAt = n;
    const prev = this.applied;
    this.applied = { ...this.config };
    this.phase = 'running'; this.startedAt = n; this.hdfsDown = false;
    this.procs.forEach((p, id) => { if (p.state !== 'up') this.procUp(id); });
    if (prev) this.files.forEach(f => f.blocks.forEach(bl => { bl.reps = bl.reps.filter(id => id <= this.applied!.datanodes); }));
    if (this.applied.services === 'todo' && !this.libs) {
      this.libs = true;
      this.putNow('/apps/tez/tez.tar.gz', 58.4, 128, 'arranque');
      this.putNow('/apps/spark/spark-libs.jar', 291.7, 128, 'arranque');
    }
    this.mem = [{ t: n, usedMb: this.usedMb() }];
    this.act('Cluster', 'ok', 'Cluster LISTO', { command: 'estado', input: configSummary(this.applied), action: 'Todos los procesos responden en sus puertos', output: `Listo en ${Math.round((n - b.startedAt) / 1000)} s · ${this.procs.size} procesos arriba`, tech: '============ Cluster LISTO ============' });
    if (prev) this.at(3, () => this.replicate());
  }
  private buildSteps(c: ClusterConfig, first: boolean): StepRec[] {
    const st: Omit<StepRec, 'state' | 'log'>[] = []; const ha = c.namenodes > 1, yarn = c.services !== 'hdfs', todo = c.services === 'todo';
    const dns = Array.from({ length: c.datanodes }, (_, i) => i + 1), nns = Array.from({ length: c.namenodes }, (_, i) => i + 1);
    const L = (sec: number, text: string, level: LogLine['level'] = 'INFO') => ({ at: sec, level, text });
    if (ha) st.push({ id: 'zk', name: 'ZooKeeper y JournalNodes', expectedSec: 7, processes: ['zk', 'jn1', 'jn2', 'jn3'], description: 'ZooKeeper elige qué NameNode es el activo; los 3 JournalNodes guardan cada cambio de los metadatos para que el que está en espera esté al día.', commands: ['zkServer.sh start', 'hdfs --daemon start journalnode   # jn1, jn2, jn3'], lines: [L(1, 'INFO server.ZooKeeperServer: binding to port 0.0.0.0/0.0.0.0:2181'), L(3, 'INFO server.JournalNode: Starting JournalNode, web :8480'), L(5, 'INFO server.JournalNode: Starting JournalNode, web :8481'), L(6.5, 'INFO server.JournalNode: Starting JournalNode, web :8482')] });
    st.push({ id: 'fmt', name: 'Formatear HDFS', expectedSec: 6, processes: [], skipReason: first ? undefined : 'el volumen ya tiene datos', description: 'Crea los metadatos vacíos del sistema de archivos. Solo la primera vez: formatear de nuevo borraría todo lo que hay en HDFS.', commands: ha ? ['hdfs namenode -format -force -nonInteractive', 'hdfs zkfc -formatZK -force'] : ['hdfs namenode -format -force -nonInteractive'], lines: [L(.5, 'INFO namenode.NameNode: STARTUP_MSG: Starting NameNode'), L(2, `INFO namenode.FSNamesystem: HA Enabled: ${ha}`), L(3, `INFO blockmanagement.BlockManager: defaultReplication = ${c.replication}`), L(5, 'INFO common.Storage: Storage directory /hadoop/dfs/name has been successfully formatted.')] });
    st.push({ id: 'nn', name: ha ? `NameNodes (${c.namenodes})` : 'NameNode y Secondary', expectedSec: 8, processes: ha ? nns.map(i => `nn${i}`) : ['nn1', 'snn'], description: ha ? 'Arranca cada NameNode con su ZKFC, que compite en ZooKeeper: el que gana queda activo y el resto en espera.' : 'El NameNode carga los metadatos y abre su página en el 9870. El Secondary guarda una copia de los metadatos cada 5 minutos.', commands: ha ? nns.map(i => `hdfs --daemon start namenode   # nn${i}, web :${9869 + i}`).concat(['hdfs --daemon start zkfc']) : ['hdfs --daemon start namenode', 'hdfs --daemon start secondarynamenode'], lines: [L(1, 'INFO namenode.NameNode: fs.defaultFS is hdfs://localhost:9000'), L(2.5, 'INFO hdfs.DFSUtil: Starting Web-server for hdfs at: http://0.0.0.0:9870'), L(5, 'INFO namenode.NameNode: NameNode RPC up at: localhost/127.0.0.1:9000'), L(6.5, 'INFO hdfs.StateChange: STATE* Safe mode ON.', 'WARN')] });
    st.push({ id: 'dn', name: `DataNodes (${c.datanodes})`, expectedSec: 6 + c.datanodes * .6, processes: dns.map(i => `dn${i}`), description: 'Cada DataNode arranca con su carpeta en /hadoop/dfs/dnN y se anota en el NameNode. HDFS sale de safe mode cuando se anotaron todos.', commands: dns.map(i => `datanode start ${i}`).concat(['hdfs dfsadmin -safemode wait']), lines: dns.flatMap(i => [L(i * .5, `[dn${i}] INFO datanode.DataNode: Opened streaming server at /0.0.0.0:${9910 + i}`), L(2 + i * .6, `[dn${i}] INFO datanode.DataNode: Block pool BP-1937455046-172.17.0.2 registered with NN`)]).concat([L(5.5 + c.datanodes * .6, 'Safe mode is OFF')]) });
    st.push({ id: 'dirs', name: 'Carpetas en HDFS', expectedSec: 5, processes: [], skipReason: first ? undefined : 'ya existen', description: 'Crea las carpetas que usan Hive, Spark y vos. Cada comando hdfs es un programa Java nuevo: por eso tarda unos segundos.', commands: ['hdfs dfs -mkdir -p /tmp /user/hive/warehouse /user/root /apps/tez /apps/spark /spark-logs', 'hdfs dfs -chmod -R 1777 /tmp'], lines: [L(4.5, '(sin salida: si no hay error, está hecho)')] });
    if (yarn) st.push({ id: 'yarn', name: 'YARN y JobHistory', expectedSec: 10, processes: ['rm', 'nm', 'jh'], description: 'El ResourceManager reparte la memoria entre los trabajos; el NodeManager presta 4 GB y corre los contenedores; JobHistory guarda los trabajos MapReduce terminados.', commands: ['yarn --daemon start resourcemanager', 'yarn --daemon start nodemanager', 'mapred --daemon start historyserver'], lines: [L(3, 'INFO resourcemanager.ResourceManager: Transitioned to active state'), L(4, 'INFO webapp.WebApps: Web app cluster started at 8088'), L(7, 'INFO nodemanager.NodeStatusUpdaterImpl: Registered with ResourceManager with total resource of <memory:4096, vCores:4>'), L(9, 'INFO hs.JobHistoryServer: Web app jobhistory started at 19888')] });
    if (yarn) st.push({ id: 'mysql', name: 'MySQL', expectedSec: first ? 19 : 5, processes: ['mysql'], description: first ? 'Crea la base, el usuario alumno y carga la base tienda con 200.000 ventas, las mismas de ventas_grandes.csv.' : 'Arranca MariaDB con la base tienda que ya estaba en el volumen.', commands: (first ? ['mysql_install_db --user=mysql --datadir=/hadoop/mysql'] : []).concat(['mysqld &', 'mysqladmin ping']).concat(first ? ['mysql < /opt/sandbox/ejemplos/tienda.sql'] : []), lines: [L(2, 'mariadbd: ready for connections.'), L(2.5, "Version: '10.11.13-MariaDB-0ubuntu0.24.04.1'  port: 3306")].concat(first ? [L(8, 'Query OK, 8 rows affected (productos)'), L(9, 'Query OK, 4 rows affected (sucursales)'), L(18, 'Query OK, 200000 rows affected (ventas)')] : [L(4, 'mysqld is alive')]) });
    if (c.mongodb) st.push({ id: 'mongo', name: 'MongoDB', expectedSec: first ? 9 : 4, processes: ['mongodb'], description: first ? 'Arranca la base de documentos y carga la base tienda (20.000 pedidos).' : 'Arranca la base de documentos con lo que ya había en el volumen.', commands: ['runuser -u mongodb -- mongod --config /etc/mongod.conf &'].concat(first ? ['mongosh --quiet /opt/sandbox/ejemplos/tienda_mongo.js'] : []), lines: [L(1, '{"s":"I","c":"CONTROL","msg":"MongoDB starting","attr":{"port":27017,"dbPath":"/hadoop/mongodb"}}'), L(3, '{"s":"I","c":"NETWORK","msg":"Waiting for connections","attr":{"port":27017}}')].concat(first ? [L(8, 'tienda.pedidos: 20000 documentos')] : []) });
    if (todo) st.push({ id: 'libs', name: 'Librerías de Tez y Spark', expectedSec: 14, processes: [], skipReason: first || !this.libs ? undefined : 'ya están en HDFS', description: 'Sube a HDFS los programas que YARN reparte a cada contenedor. Van con bloque de 128 MB aunque hayas elegido otro, para no llenar HDFS de bloques chicos.', commands: ['hdfs dfs -D dfs.blocksize=128m -put $TEZ_HOME/share/tez.tar.gz /apps/tez/', 'hdfs dfs -D dfs.blocksize=128m -put /tmp/spark-libs.jar /apps/spark/'], lines: [L(4, '/apps/tez/tez.tar.gz: 1 bloque'), L(13, '/apps/spark/spark-libs.jar: 3 bloques')] });
    if (todo) st.push({ id: 'hive', name: 'Hive', expectedSec: first ? 58 : 44, processes: ['metastore', 'hiveserver2'], description: 'Arranca el Metastore (qué tablas hay y dónde están sus archivos) y HiveServer2, que recibe el SQL y lo convierte en trabajos Tez. Es lo que más tarda.', commands: (first ? ['schematool -dbType derby -initSchema'] : []).concat(['hive --service metastore &', 'hive --service hiveserver2 &', '# espera a que acepte conexiones en el 10000']), lines: (first ? [L(6, 'schemaTool completed')] : []).concat([L(12, 'INFO metastore.HiveMetaStore: Starting hive metastore on port 9083'), L(20, 'INFO server.HiveServer2: Starting HiveServer2'), L(34, 'INFO http.HttpServer: Started HttpServer[hiveserver2] on port 10002'), L(first ? 56 : 42, 'INFO thrift.ThriftCLIService: Starting ThriftBinaryCLIService on port 10000')]) });
    if (todo) st.push({ id: 'spark', name: 'Spark History Server', expectedSec: 4, processes: ['sparkhistory'], description: 'Spark no queda corriendo: cada trabajo pide sus contenedores a YARN. Lo que arranca es la página de los trabajos terminados.', commands: ['$SPARK_HOME/sbin/start-history-server.sh'], lines: [L(3.5, 'INFO HistoryServer: Bound HistoryServer to 0.0.0.0, and started at http://bigdata:18080')] });
    if (c.jupyter) st.push({ id: 'jupyter', name: 'JupyterLab', expectedSec: 5, processes: ['jupyter'], description: 'Notebooks de Python en el 8888, con pandas, scikit-learn y PySpark.', commands: ['jupyter lab &'], lines: [L(4, 'Jupyter Server is running at: http://127.0.0.1:8888/lab')] });
    st.push({ id: 'ui', name: 'Esta interfaz', expectedSec: 1, processes: ['ui'], description: 'La interfaz ya estaba corriendo: se conecta a cada proceso para leer su estado.', commands: ['estado'], lines: [L(.5, 'Cluster LISTO')] });
    return st.map(s => ({ ...s, state: s.skipReason ? 'skipped' : 'pending', log: [] }));
  }

  /* ---------- Apagar, aplicar, borrar el volumen ---------- */
  stop(then?: () => void) {
    if (this.phase !== 'running') return;
    this.phase = 'stopping';
    this.act('Vos', 'info', 'Apagando el cluster en orden', { command: 'docker compose stop', input: `${this.procs.size} procesos`, action: 'Apaga MySQL, Hive, YARN y al final HDFS, para que nada quede a medio escribir', output: 'Los datos quedan en el volumen bigdata_hadoop' });
    this.jobs.filter(a => a.state === 'RUNNING' || a.state === 'ACCEPTED').forEach(a => { a.state = 'KILLED'; a.end = this.now(); a.conts = []; });
    const order = ['ui', 'jupyter', 'mongodb', 'hiveserver2', 'metastore', 'sparkhistory', 'mysql', 'jh', 'nm', 'rm'];
    const ids = [...this.procs.keys()].sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    ids.forEach((id, i) => this.at(.6 + i * .5, () => { const p = this.procs.get(id); if (p && id !== 'ui') { p.state = 'off'; p.upSince = undefined; } this.emit(); }));
    this.at(1 + ids.length * .5, () => {
      this.phase = 'stopped'; this.startedAt = null; this.boot = null; this.dns.forEach(d => { d.s = 'off'; });
      this.act('Cluster', 'ok', 'Cluster apagado', { output: 'HDFS, las tablas de Hive y las bases quedan en el volumen.' });
      then?.();
    });
    this.emit();
  }
  apply(cfg: ClusterConfig) {
    if (this.phase === 'running') this.stop(() => this.start(cfg));
    else { this.config = { ...cfg }; this.start(cfg); }
  }
  saveConfig(cfg: ClusterConfig) { this.config = { ...cfg }; this.emit(); }
  resetVolume() {
    if (this.phase !== 'stopped') return;
    this.files = []; this.dirs.clear(); this.dirsReady = false; this.transfers = []; this.libs = false; this.volumeNN = null; this.applied = null; this.dns = []; this.jobs = [];
    this.act('Vos', 'warn', 'Volumen borrado', { command: 'docker compose down -v', input: 'volumen bigdata_hadoop', action: 'Borra HDFS, el metastore de Hive, MySQL y MongoDB', output: 'El próximo arranque formatea todo de cero. Ya podés cambiar la cantidad de NameNodes.' });
    this.emit();
  }

  /* ---------- Procesos ---------- */
  processAction(id: string, action: 'start' | 'stop') {
    if (this.phase !== 'running') return;
    if (id.startsWith('dn')) return action === 'stop' ? this.dnStop(+id.slice(2)) : this.dnStart(+id.slice(2));
    if (id.startsWith('nn')) return action === 'stop' ? this.nnStop(+id.slice(2)) : this.nnStart(+id.slice(2));
    const p = this.procs.get(id); if (!p || !p.spec.controllable) return;
    const cmds: Record<string, [string, string]> = { mysql: ['mysqladmin shutdown', 'mysqld &'], hiveserver2: ['pkill -f HiveServer2', 'hive --service hiveserver2 &'], mongodb: ['mongosh admin --eval "db.shutdownServer()"', 'runuser -u mongodb -- mongod --config /etc/mongod.conf &'], jupyter: ['pkill -f jupyter-lab', 'jupyter lab &'] };
    const [stopCmd, startCmd] = cmds[id] || ['kill ' + p.pid, ''];
    if (action === 'stop' && p.state === 'up') {
      p.state = 'stopping';
      this.act('Vos', 'warn', `${p.spec.name} apagado`, { command: stopCmd, input: `${p.spec.name} (pid ${p.pid}, :${p.spec.ports[0]})`, action: 'Se detiene el proceso', output: id === 'hiveserver2' ? 'Hive deja de aceptar consultas en el 10000; las tablas siguen en HDFS' : id === 'mysql' ? 'Sqoop no va a poder leer ni escribir la base tienda' : 'El puerto deja de responder', processId: id });
      this.at(2, () => { p.state = 'down'; p.upSince = undefined; this.emit(); });
    } else if (action === 'start' && (p.state === 'down' || p.state === 'off')) {
      p.state = 'starting';
      this.act('Vos', 'info', `Arrancando ${p.spec.name}`, { command: startCmd, input: p.spec.name, action: 'Levanta el proceso y espera a que responda su puerto', output: `:${p.spec.ports[0]}`, processId: id });
      this.at(id === 'hiveserver2' ? 30 : 5, () => { this.procUp(id); this.act(p.spec.name, 'ok', `${p.spec.name} arriba`, { processId: id }); this.emit(); });
    }
    this.emit();
  }

  /* ---------- HDFS ---------- */
  count(dn: number) { let n = 0; this.files.forEach(f => f.blocks.forEach(b => { if (b.reps.includes(dn)) n++; })); return n; }
  pick(n: number, excl: number[] = []) {
    const c = this.dns.filter(d => d.s === 'up' && !excl.includes(d.id)).map(d => ({ id: d.id, k: this.count(d.id) + rnd() * .9 }));
    c.sort((a, b) => a.k - b.k);
    return c.slice(0, n).map(d => d.id);
  }
  makeFile(path: string, sizeMb: number, bsMb: number, by: string, rep = this.applied?.replication ?? 1): FileRec {
    const nb = Math.max(1, Math.ceil(sizeMb / bsMb));
    const f: FileRec = { path, sizeMb, rep, bsMb, blocks: [], writing: false, by, at: this.now() };
    for (let i = 0; i < nb; i++) f.blocks.push({ id: this.blk++, gs: this.gs++, n: i + 1, mb: Math.min(bsMb, sizeMb - i * bsMb), reps: [], want: [] });
    return f;
  }
  putNow(path: string, sizeMb: number, bsMb: number, by: string, rep?: number) {
    this.files = this.files.filter(x => x.path !== path);
    const f = this.makeFile(path, sizeMb, bsMb, by, rep);
    const live = this.dns.filter(d => d.s === 'up').length;
    f.blocks.forEach(b => { b.reps = this.pick(Math.min(f.rep, live)); });
    this.files.push(f);
    return f;
  }
  putExample(ex: 'ventas' | 'numeros' | 'sucias', onDone?: () => void): FileRec | undefined {
    const spec = ex === 'ventas' ? { path: '/user/root/ventas/ventas_grandes.csv', mb: 5.93, local: 'ventas_grandes.csv', rows: '200.000 filas' } : ex === 'sucias' ? { path: '/user/root/ml/ventas_sucias.csv', mb: 4.45, local: 'ventas_sucias.csv', rows: '103.000 filas' } : { path: '/user/root/numeros.txt', mb: 6.57, local: 'numeros.txt', rows: '1.000.000 líneas' };
    return this.putFile(spec, onDone);
  }
  /** hdfs dfs -put: corta en bloques y los manda por la tubería de DataNodes, con los tiempos del demo */
  putFile(spec: PutSpec, onDone?: (f: FileRec) => void, by = 'Vos'): FileRec | undefined {
    if (this.phase !== 'running' || this.hdfsDown) return;
    this.files = this.files.filter(f => f.path !== spec.path);
    const bs = spec.bsMb || blockSizeMb(this.applied!.blockSize) || 128;
    const f = this.makeFile(spec.path, spec.mb, bs, 'cliente HDFS', spec.rep); f.writing = true;
    this.files.push(f);
    const r = Math.min(f.rep, this.dns.filter(d => d.s === 'up').length);
    const dir = spec.path.slice(0, spec.path.lastIndexOf('/') + 1);
    const flags = (spec.rep ? ` -D dfs.replication=${spec.rep}` : '') + (spec.bsMb ? ` -D dfs.blocksize=${spec.bsMb}m` : '');
    this.act(by, 'info', `Subiendo ${spec.local} a HDFS`, { command: `hdfs dfs${flags} -put -f ${spec.local} ${dir}`, input: `/datos/${spec.local} · ${spec.rows} · ${spec.mb.toLocaleString('es-AR')} MB`, action: `Lo corta en ${f.blocks.length} bloque${f.blocks.length > 1 ? 's' : ''} de ${bs} MB; el NameNode elige los DataNodes y cada bloque viaja al primero, que lo pasa al siguiente`, output: `${f.blocks.length} bloques × ${r} copias = ${f.blocks.length * r} copias` });
    f.blocks.forEach((b, i) => {
      b.want = this.pick(r);
      b.want.forEach((dn, k) => this.at(.9 + i * 1.6 + k * .9, () => {
        if (!this.files.includes(f)) return;
        if (!b.reps.includes(dn)) b.reps.push(dn);
        this.emit({ type: 'transfer', transfer: { block: b.id, from: k === 0 ? 'client' : b.want[k - 1], to: dn } });
        this.emit();
      }));
    });
    this.at(1 + f.blocks.length * 1.6 + r * .9, () => {
      if (!this.files.includes(f)) return;
      f.writing = false;
      this.act('NameNode', 'ok', `${spec.local} cerrado`, { output: `${f.blocks.length} bloques, ${f.blocks.length * r} copias`, tech: `DIR* completeFile: ${spec.path} is closed by DFSClient` });
      this.emit({ type: 'hdfs', path: spec.path });
      onDone?.(f); this.emit();
    });
    this.emit({ type: 'hdfs', path: spec.path });
    this.emit();
    return f;
  }
  setReplication(path: string, n: number) {
    const f = this.files.find(x => x.path === path); if (!f || this.phase !== 'running') return;
    const prev = f.rep; f.rep = n;
    // Como el servidor: -w solo si hay DataNodes vivos para esa replicación (si no, no terminaría nunca)
    const w = n <= this.dns.filter(d => d.s === 'up').length ? '-w ' : '';
    this.act('Vos', 'info', `Replicación de ${path.split('/').pop()}: ${prev} → ${n}`, { command: `hdfs dfs -setrep ${w}${n} ${path}`, input: `${f.blocks.length} bloques con ${prev} copia${prev > 1 ? 's' : ''}`, action: n > prev ? 'El NameNode agrega copias en otros DataNodes' : 'El NameNode borra las copias que sobran', output: `${f.blocks.length * n} copias` });
    this.at(1, () => { if (n > prev) this.replicate(); else this.checkOver(); });
    this.emit();
  }
  replicate() {
    if (this.replBusy || this.hdfsDown || this.phase !== 'running') return;
    const jobs: { f: FileRec; b: BlockRec }[] = [];
    const upCount = this.dns.filter(d => d.s === 'up').length;
    this.files.forEach(f => f.blocks.forEach(b => {
      if (f.writing) return;
      const alive = b.reps.filter(id => this.dns.find(d => d.id === id)?.s !== 'dead');
      for (let k = alive.length; k < Math.min(f.rep, upCount) && alive.length; k++) jobs.push({ f, b });
    }));
    if (!jobs.length) { this.checkOver(); return; }
    this.replBusy = true;
    this.act('NameNode', 'warn', `${jobs.length} bloque${jobs.length > 1 ? 's' : ''} con menos copias de las pedidas: re-replicando`, { action: 'Copia cada bloque desde un DataNode que lo tiene a otro que no, de a poco para no saturar la red', tech: `UnderReplicatedBlocks=${jobs.length}` });
    jobs.forEach((j, i) => this.at(1.5 + i * 1.3, () => {
      const src = j.b.reps.find(id => this.dns.find(d => d.id === id)?.s === 'up');
      const [dst] = this.pick(1, j.b.reps);
      if (src && dst && j.b.reps.length < j.f.rep) {
        j.b.reps.push(dst);
        this.emit({ type: 'transfer', transfer: { block: j.b.id, from: src, to: dst } });
        this.act(`DataNode ${src}`, 'info', `Copió blk_${j.b.id}_${j.b.gs} al DataNode ${dst}`, { tech: `DataTransfer: Transmitted blk_${j.b.id}_${j.b.gs} to /127.0.0.1:${9910 + dst}` });
      }
      if (i === jobs.length - 1) this.at(.6, () => { this.replBusy = false; this.act('NameNode', 'ok', 'Replicación completa otra vez', {}); this.replicate(); });
      this.emit();
    }));
  }
  private checkOver() {
    const upReps = (b: BlockRec) => b.reps.filter(id => this.dns.find(d => d.id === id)?.s === 'up');
    const dels: { f: FileRec; b: BlockRec; dn: number }[] = [];
    this.files.forEach(f => f.blocks.forEach(b => {
      const live = upReps(b);
      if (live.length > f.rep) live.slice().sort((x, y) => this.count(y) - this.count(x)).slice(0, live.length - f.rep).forEach(dn => dels.push({ f, b, dn }));
    }));
    if (!dels.length) return;
    this.act('NameNode', 'warn', `${dels.length} copia${dels.length > 1 ? 's' : ''} de más: se borran de los DataNodes más llenos`, { tech: `OverReplicatedBlocks=${dels.length}` });
    // Se decide de nuevo al borrar: si checkOver corrió dos veces seguidas (o cambió algo en el medio),
    // no se borra de más y un bloque no queda sub-replicado sin que nadie lo vuelva a copiar
    dels.forEach((x, i) => this.at(1 + i * .8, () => {
      if (upReps(x.b).length <= x.f.rep || !x.b.reps.includes(x.dn)) return;
      x.b.reps = x.b.reps.filter(id => id !== x.dn);
      this.emit();
      if (i === dels.length - 1) this.replicate();
    }));
  }
  private dnStop(id: number) {
    const d = this.dns.find(x => x.id === id); if (!d || d.s !== 'up') return;
    const tok = {}; d.s = 'stopping'; d.since = this.now(); d.tok = tok;
    const p = this.procs.get('dn' + id); if (p) { p.state = 'down'; p.upSince = undefined; }
    const n = this.count(id);
    this.act('Vos', 'error', `DataNode ${id} apagado`, { command: `datanode stop ${id}`, input: `DataNode ${id} (dn${id}, :${9900 + id}) con ${n} bloque${n !== 1 ? 's' : ''}`, action: 'Se detiene el proceso. El NameNode no se entera enseguida: espera sus latidos, que llegan cada 3 s', output: `A los ${DEAD_AFTER} s sin latidos lo da por muerto y re-replica lo que tenía (en un Hadoop de fábrica tarda 10,5 min)`, processId: 'dn' + id });
    this.at(DEAD_AFTER, () => {
      if (d.s !== 'stopping' || d.tok !== tok) return;
      d.s = 'dead';
      let lost = 0;
      this.files.forEach(f => f.blocks.forEach(b => { if (b.reps.includes(id)) { b.reps = b.reps.filter(x => x !== id); d.ghosts.push(b.id); lost++; } }));
      const missing = this.files.reduce((a, f) => a + f.blocks.filter(b => !b.reps.length).length, 0);
      this.act('NameNode', 'error', `DataNode ${id} muerto: ${lost} bloque${lost !== 1 ? 's' : ''} perdieron una copia`, { action: 'Lo saca de la lista de nodos vivos y busca qué bloques quedaron con menos copias', output: missing ? `${missing} bloque${missing > 1 ? 's' : ''} sin ninguna copia: perdido${missing > 1 ? 's' : ''} hasta que vuelva el nodo` : 'Ningún bloque se perdió: todos tienen otra copia', tech: `Removing a node: /default-rack/127.0.0.1:${9910 + id}` });
      this.emit(); this.replicate();
    });
    this.emit();
  }
  private dnStart(id: number) {
    let d = this.dns.find(x => x.id === id);
    if (!d) { d = { id, s: 'off', since: this.now(), ghosts: [], tok: {} }; this.dns.push(d); this.dns.sort((a, b) => a.id - b.id); }
    if (d.s === 'up' || d.s === 'starting') return;
    const wasDead = d.s === 'dead', wasStopping = d.s === 'stopping', isNew = d.s === 'off';
    d.s = 'starting';
    if (!this.procs.has('dn' + id)) this.procs.set('dn' + id, { spec: processSpecs({ ...this.applied!, datanodes: id }).find(s => s.id === 'dn' + id)!, state: 'starting' });
    else this.procs.get('dn' + id)!.state = 'starting';
    this.act('Vos', 'info', isNew ? `DataNode ${id} nuevo, en caliente` : `Arrancando el DataNode ${id}`, { command: `datanode start ${id}`, input: isNew ? 'un DataNode vacío' : `DataNode ${id} con los bloques que tenía en /hadoop/dfs/dn${id}`, action: 'Arranca el proceso y se anota en el NameNode con un informe de sus bloques', output: isNew ? 'Aparece vacío: HDFS no mueve bloques viejos solo (para eso está hdfs balancer)' : wasDead ? 'Sus bloques ya se copiaron a otros nodos: van a sobrar copias' : 'Vuelve antes de que lo den por muerto: no pasa nada', processId: 'dn' + id });
    this.at(4, () => {
      d!.s = 'up'; d!.since = this.now(); this.procUp('dn' + id);
      if (wasDead || wasStopping) {
        d!.ghosts.forEach(bid => this.files.forEach(f => f.blocks.forEach(b => { if (b.id === bid && !b.reps.includes(id)) b.reps.push(id); })));
        d!.ghosts = [];
        this.act('NameNode', 'ok', `DataNode ${id} anotado de nuevo`, { tech: `Registered DatanodeRegistration(127.0.0.1:${9910 + id})` });
        this.at(2, () => { this.checkOver(); this.replicate(); });
      } else this.replicate();
      this.emit();
    });
    this.emit();
  }
  addDataNode() { if (this.phase === 'running' && this.dns.length < 9) this.dnStart(this.dns.length + 1); }
  private nnStop(id: number) {
    const p = this.procs.get('nn' + id); if (!p || p.state !== 'up') return;
    const ha = this.applied!.namenodes > 1, wasActive = p.role === 'active';
    p.state = 'down'; p.upSince = undefined;
    if (!ha) {
      this.hdfsDown = true;
      this.act('Vos', 'error', 'NameNode apagado: HDFS deja de responder', { command: `namenode stop ${id}`, input: 'el único NameNode', action: 'Se detiene el proceso que sabe dónde está cada bloque', output: 'Los datos siguen en los DataNodes pero nadie puede leerlos: es el punto único de falla', processId: 'nn' + id });
    } else {
      this.act('Vos', 'error', `NameNode ${id} apagado (${wasActive ? 'era el activo' : 'estaba en espera'})`, { command: `namenode stop ${id}`, input: `nn${id}`, action: 'Se detiene el proceso', output: wasActive ? 'Su ZKFC pierde el lock en ZooKeeper; otro NameNode lo toma en unos segundos' : 'No cambia nada: el activo sigue atendiendo', processId: 'nn' + id });
      if (wasActive) {
        this.hdfsDown = true; p.role = 'standby';
        this.at(5, () => {
          const s = [...this.procs.values()].find(x => x.spec.kind === 'namenode' && x.state === 'up');
          if (s) { s.role = 'active'; this.hdfsDown = false; this.act(`ZKFC de ${s.spec.id}`, 'ok', `${s.spec.name} ganó la elección y pasó a activo`, { output: 'HDFS sigue andando', tech: `Successfully transitioned NameNode at ${s.spec.id} to active state` }); this.emit(); }
        });
      }
    }
    this.emit();
  }
  private nnStart(id: number) {
    const p = this.procs.get('nn' + id); if (!p || p.state !== 'down') return;
    p.state = 'starting';
    this.act('Vos', 'info', `Arrancando ${p.spec.name}`, { command: `namenode start ${id}`, processId: 'nn' + id });
    this.at(6, () => {
      const act = [...this.procs.values()].some(x => x.spec.kind === 'namenode' && x.state === 'up' && x.role === 'active');
      this.procUp('nn' + id); p.role = act ? 'standby' : 'active';
      if (!act) this.hdfsDown = false;
      this.act(p.spec.name, 'ok', act ? `${p.spec.name} volvió en espera` : `${p.spec.name} volvió y está activo`, { processId: 'nn' + id });
      this.emit(); this.replicate();
    });
    this.emit();
  }

  /** Sigue un trabajo de YARN: tick cada segundo del cluster mientras corre, y al final done o fail */
  watch(appId: string, h: { tick?: (progress: number) => void; done: () => void; fail: (why: string) => void }) {
    const loop = () => {
      const a = this.jobs.find(x => x.id === appId);
      if (!a || a.state === 'KILLED' || a.state === 'FAILED') return h.fail(!a ? 'El trabajo desapareció' : a.state === 'KILLED' ? 'Trabajo cancelado' : 'El trabajo falló');
      if (a.state === 'FINISHED') return h.done();
      h.tick?.(this.apps().find(x => x.id === appId)?.progress ?? 0);
      this.at(1, loop);
    };
    this.at(1, loop);
  }
  dnsUp() { return this.dns.filter(d => d.s === 'up').length; }
  replicating() { return this.replBusy; }

  /* ---------- YARN ---------- */
  usedYarn() { return this.jobs.reduce((a, p) => a + p.conts.reduce((x, c) => x + c.memoryMb, 0), 0); }
  private inputBlocks(prefix: string) { return this.files.filter(f => f.path.startsWith(prefix)).flatMap(f => f.blocks.map(b => b.id)); }
  submitExample(job: ExampleJob): string {
    if (this.phase !== 'running' || this.applied!.services === 'hdfs') return '';
    if (!this.files.some(f => f.path.startsWith('/user/root/ventas') && !f.writing)) this.putExample('ventas');
    const bl = this.inputBlocks('/user/root/ventas'); const n = Math.max(1, bl.length || 6);
    const def: AppDef & { cmd: string } = ({
      'mr-ventas': { type: 'MAPREDUCE' as AppType, name: 'ventas por producto (mapper.py + reducer.py)', am: 512, amStart: 6, taskMb: 512, executors: 0, cmd: 'hadoop jar hadoop-streaming-3.3.6.jar -mapper mapper.py -reducer reducer.py -input /user/root/ventas -output /user/root/resultados/mr_por_producto', stages: [
        { id: 'map', name: 'Map', description: 'Cada mapper lee un bloque y emite producto, cantidad, importe', dependsOn: [], durSec: 9, n, blocks: bl, ops: ['TextInputFormat', 'mapper.py', 'sort + spill'] },
        { id: 'reduce', name: 'Reduce', description: 'Recibe los pares ordenados por producto y suma', dependsOn: ['map'], edge: 'shuffle + sort', durSec: 7, n: 1, ops: ['merge', 'reducer.py', 'TextOutputFormat'] }], rowsIn: 200000, rowsOut: 8, out: '/user/root/resultados/mr_por_producto' },
      'hive-ventas': { type: 'TEZ' as AppType, name: 'HIVE: SELECT producto, SUM(cantidad)… GROUP BY producto', am: 1024, amStart: 8, taskMb: 1024, executors: 0, cmd: 'beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql', stages: [
        { id: 'm1', name: 'Map 1', description: 'Lee la tabla ventas, un bloque por tarea, y suma parcial por producto', dependsOn: [], durSec: 4, n, blocks: bl, ops: ['TableScan', 'Select Operator', 'Group By Operator (parcial)', 'Reduce Output Operator'] },
        { id: 'r2', name: 'Reducer 2', description: 'GROUP BY producto: junta las sumas parciales', dependsOn: ['m1'], edge: 'SCATTER_GATHER', durSec: 3, n: 2, ops: ['Group By Operator (final)', 'Reduce Output Operator'] },
        { id: 'r3', name: 'Reducer 3', description: 'ORDER BY facturado DESC: una tarea ordena las 8 filas', dependsOn: ['r2'], edge: 'SCATTER_GATHER', durSec: 2, n: 1, ops: ['Select Operator', 'File Output Operator'] }], rowsIn: 200000, rowsOut: 8 },
      'spark-ventas': { type: 'SPARK' as AppType, name: 'ventas por producto (ventas.py)', am: 1024, amStart: 14, taskMb: 0, executors: 2, cmd: 'spark-submit ejemplos/ventas.py', stages: [
        { id: 's0', name: 'Stage 0', description: 'csv(): lee la primera línea para los nombres de columna', dependsOn: [], durSec: 1.5, n: 1, blocks: bl.slice(0, 1), ops: ['FileScan csv', 'CollectLimit 1'] },
        { id: 's1', name: 'Stage 1', description: 'inferSchema: recorre todo el archivo para adivinar los tipos', dependsOn: ['s0'], durSec: 2.2, n, blocks: bl, ops: ['FileScan csv', 'inferSchema'] },
        { id: 's2', name: 'Stage 2', description: 'withColumn + suma parcial por producto en cada partición', dependsOn: ['s1'], durSec: 2.5, n, blocks: bl, ops: ['FileScan csv', 'Project (importe)', 'HashAggregate (parcial)', 'Exchange hashpartitioning'] },
        { id: 's3', name: 'Stage 3', description: 'Shuffle: suma final por producto (4 particiones)', dependsOn: ['s2'], edge: 'shuffle', durSec: 1.2, n: 4, ops: ['HashAggregate (final)', 'Exchange rangepartitioning'] },
        { id: 's4', name: 'Stage 4', description: 'orderBy + write: ordena y guarda en HDFS', dependsOn: ['s3'], edge: 'shuffle', durSec: 1.5, n: 1, ops: ['Sort', 'WriteFiles csv'] }], rowsIn: 200000, rowsOut: 8, out: '/user/root/resultados/spark_por_producto' },
    } as Record<ExampleJob, AppDef & { cmd: string }>)[job];
    return this.submitApp(def, { command: def.cmd, input: `/user/root/ventas · ${n} bloques` });
  }
  /** Manda un trabajo a la cola de YARN. onDone corre cuando termina bien */
  submitApp(def: AppDef, o: { command?: string; input?: string; quiet?: boolean; onDone?: () => void } = {}): string {
    const num = String(++this.appSeq).padStart(4, '0');
    const app: AppRec = { cmd: o.command, input: o.input, def, id: `application_${TS}_${num}`, num, name: def.name, type: def.type, state: 'ACCEPTED', sub: this.now(), am: def.am, amStart: def.amStart, taskMb: def.taskMb, executors: def.executors, slots: [], conts: [], cseq: 1, log: [], onDone: o.onDone,
      stages: def.stages.map(st => ({ id: st.id, name: st.name, description: st.description, dependsOn: st.dependsOn, edge: st.edge, state: 'pending' as const, durSec: st.durSec, blocks: st.blocks, ops: st.ops,
        tasks: Array.from({ length: st.n }, (_, i) => ({ id: `${st.id}_${String(i).padStart(6, '0')}`, index: i, state: 'pending' as const, dur: st.durSec * (.82 + rnd() * .36), blockId: st.blocks?.[i] })) })) };
    this.jobs.unshift(app);
    this.alog(app, 'Aplicación enviada a la cola default');
    if (!o.quiet) this.act('Vos', 'info', `${def.type}: «${def.name}»`, { command: o.command, input: o.input, action: `YARN la pone en la cola; primero arranca su ApplicationMaster (${def.am} MB)`, output: app.id, appId: app.id });
    this.emit({ type: 'yarn', appId: app.id });
    return app.id;
  }
  killApp(id: string) {
    const a = this.jobs.find(x => x.id === id); if (!a || a.state === 'FINISHED' || a.state === 'KILLED') return;
    a.state = 'KILLED'; a.end = this.now(); a.conts = []; a.slots = [];
    this.act('Vos', 'warn', `Trabajo cancelado: ${a.name}`, { command: `yarn application -kill ${id}`, output: 'YARN liberó su memoria', appId: id });
    this.emit();
  }
  alog(a: AppRec, text: string, level: LogLine['level'] = 'INFO') { a.log.push({ t: this.now(), level, text }); }
  private yarnSchedule(): boolean {
    let changed = false; let free = YARN_MB - this.usedYarn(); const n = this.now();
    for (const a of this.jobs.slice().reverse()) {
      if (a.state === 'ACCEPTED') {
        if (free < a.am) continue;
        a.conts.push({ id: `container_${TS}_${a.num}_01_000001`, memoryMb: a.am, kind: 'am', label: 'AM' }); free -= a.am; a.cseq = 2;
        a.state = 'RUNNING'; a.start = n; a.amReadyAt = n + a.amStart * 1000; changed = true;
        this.alog(a, `ApplicationMaster en container_${TS}_${a.num}_01_000001 (${a.am} MB)`);
        continue;
      }
      if (a.state !== 'RUNNING' || n < (a.amReadyAt || 0)) continue;
      while (a.executors && a.slots.length < a.executors && free >= 1024) {
        const id = `container_${TS}_${a.num}_01_${String(a.cseq++).padStart(6, '0')}`;
        a.conts.push({ id, memoryMb: 1024, kind: 'executor', label: `exec ${a.slots.length + 1}` }); a.slots.push({ busy: null, cont: id }); free -= 1024; changed = true;
        this.alog(a, `Executor ${a.slots.length} en ${id} (512 MB + 384 de overhead, 1 núcleo)`);
      }
      a.stages.forEach(s => { if (s.state === 'pending' && s.dependsOn.every(d => a.stages.find(x => x.id === d)!.state === 'done')) { s.state = 'running'; changed = true; this.alog(a, `${s.name}: ${s.tasks.length} tarea${s.tasks.length > 1 ? 's' : ''}`); } });
      for (const s of a.stages.filter(x => x.state === 'running')) for (const t of s.tasks.filter(x => x.state === 'pending')) {
        if (a.executors) { const sl = a.slots.find(x => !x.busy); if (!sl) break; sl.busy = t; t.container = sl.cont; t.slot = a.slots.indexOf(sl); }
        else { if (free < a.taskMb) break; const id = `container_${TS}_${a.num}_01_${String(a.cseq++).padStart(6, '0')}`; a.conts.push({ id, memoryMb: a.taskMb, kind: 'task', label: (s.name.startsWith('Map') ? 'M' : 'R') + (t.index + 1) }); free -= a.taskMb; t.container = id; }
        t.state = 'running'; t.startedAt = n; changed = true;
        if (t.blockId != null) { const b = this.files.flatMap(f => f.blocks).find(x => x.id === t.blockId); if (b) { t.block = `blk_${b.id}_${b.gs}`; t.dataNode = b.reps.find(id => this.dns.find(d => d.id === id)?.s === 'up'); } }
        this.alog(a, `${s.name} tarea ${t.index + 1} en ${t.container?.replace('container_', '')}${t.block ? ` · lee ${t.block}` : ''}`);
        this.at(t.dur, () => this.finishTask(a, s, t));
      }
    }
    return changed;
  }
  private finishTask(a: AppRec, s: StageRec, t: TaskRec) {
    if (a.state !== 'RUNNING') return;
    t.state = 'done'; t.finishedAt = this.now();
    if (a.executors) { const sl = a.slots.find(x => x.busy === t); if (sl) sl.busy = null; } else a.conts = a.conts.filter(c => c.id !== t.container);
    this.alog(a, `${s.name} tarea ${t.index + 1} terminó (${((t.finishedAt - t.startedAt!) / 1000).toFixed(1)} s)`);
    if (s.tasks.every(x => x.state === 'done')) { s.state = 'done'; this.alog(a, `${s.name} terminó`); }
    if (a.stages.every(x => x.state === 'done')) {
      a.state = 'FINISHED'; a.end = this.now(); a.conts = []; a.slots = [];
      this.alog(a, `Terminó bien en ${((a.end - a.sub) / 1000).toFixed(1)} s`);
      this.act('YARN', 'ok', `Terminó «${a.name}»`, { output: `${Math.round((a.end - a.sub) / 1000)} s · memoria liberada`, tech: `${a.id} State change from RUNNING to FINISHED`, appId: a.id });
      if (a.def?.out) { this.putNow(`${a.def.out}/part-00000`, 0.001, 128, a.type); this.emit({ type: 'hdfs', path: a.def.out }); }
      a.onDone?.();
    }
    this.emit({ type: 'yarn', appId: a.id }); this.emit();
  }
  apps(): YarnApp[] {
    return this.jobs.map(a => {
      const tasks = a.stages.flatMap(s => s.tasks);
      const n = this.now();
      const prog = a.state === 'FINISHED' ? 1 : tasks.length ? tasks.reduce((x, t) => x + (t.state === 'done' ? 1 : t.state === 'running' ? Math.min(.95, (n - t.startedAt!) / (t.dur * 1000)) : 0), 0) / tasks.length : 0;
      return { id: a.id, name: a.name, type: a.type, user: 'root', queue: 'default', state: a.state, progress: prog, submittedAt: a.sub, startedAt: a.start, finishedAt: a.end, amMemoryMb: a.am, containers: a.conts.slice(), log: a.log.slice(),
        stages: a.stages.map(s => ({ id: s.id, name: s.name, description: s.description, dependsOn: s.dependsOn, edge: s.edge, state: s.state, tasks: s.tasks.map(t => ({ id: t.id, index: t.index, state: t.state, startedAt: t.startedAt, finishedAt: t.finishedAt, block: t.block, dataNode: t.dataNode, container: t.container })) })) };
    });
  }

  /* ---------- Lecturas ---------- */
  private usedMb() {
    let mb = 380;
    this.procs.forEach(p => { if (p.state === 'up' || p.state === 'stopping') mb += p.spec.memMb; });
    return Math.round(mb + this.usedYarn() * .85);
  }
  dataNodes(): DataNode[] {
    return this.dns.map(d => {
      const blocks = this.count(d.id);
      const usedMb = this.files.reduce((a, f) => a + f.blocks.filter(b => b.reps.includes(d.id)).reduce((x, b) => x + b.mb, 0), 0);
      const state: DataNode['state'] = d.s === 'up' ? 'live' : d.s === 'stopping' ? 'stale' : d.s === 'dead' ? 'dead' : d.s === 'starting' ? 'starting' : 'off';
      return { id: d.id, state, httpPort: 9900 + d.id, dataPort: 9910 + d.id, blocks, usedMb, lastHeartbeat: d.s === 'up' ? this.now() - (this.now() % 3000) : d.s === 'stopping' ? d.since : null, deadAt: d.s === 'stopping' ? d.since + DEAD_AFTER * 1000 : null };
    });
  }
  filesView(): HdfsFile[] {
    return this.files.map(f => {
      const min = Math.min(...f.blocks.map(b => b.reps.length));
      return { path: f.path, sizeMb: f.sizeMb, replication: f.rep, blockSizeMb: f.bsMb, writtenBy: f.by, modifiedAt: f.at,
        state: f.writing ? 'writing' : min === 0 ? 'missing' : min < f.rep ? 'under' : 'ok',
        blocks: f.blocks.map(b => ({ id: b.id, genStamp: b.gs, name: `blk_${b.id}_${b.gs}`, index: b.n, sizeMb: b.mb, locations: b.reps.slice(), stale: this.dns.filter(d => d.ghosts.includes(b.id)).map(d => d.id) })) };
    });
  }
  status(): ClusterStatus {
    const n = this.now();
    const cfg = this.applied && this.phase !== 'stopped' ? this.applied : this.config;
    const specs = this.phase === 'stopped' ? processSpecs(cfg) : null;
    const processes: Process[] = specs
      ? specs.map(s => ({ id: s.id, kind: s.kind, name: s.name, layer: s.layer, state: s.id === 'ui' ? 'up' : 'off', ports: s.ports, webUrl: s.web ? `http://localhost:${s.web}` : undefined, memMb: s.id === 'ui' ? s.memMb : undefined, controllable: s.controllable }))
      : [...this.procs.values()].map(p => ({ id: p.spec.id, kind: p.spec.kind, name: p.spec.name, layer: p.spec.layer, state: p.spec.id === 'ui' ? 'up' : p.state, role: p.spec.kind === 'namenode' && p.state === 'up' ? p.role : undefined, ports: p.spec.ports, webUrl: p.spec.web ? `http://localhost:${p.spec.web}` : undefined, pid: p.state === 'up' ? p.pid : undefined, memMb: p.state === 'up' ? p.spec.memMb : undefined, upSince: p.upSince, controllable: p.spec.controllable }));
    let blocks = 0, replicas = 0, under = 0, missing = 0, over = 0, usedMb = 0;
    this.files.forEach(f => f.blocks.forEach(b => { if (f.writing && !b.reps.length) return; blocks++; replicas += b.reps.length; usedMb += b.mb * b.reps.length; if (!b.reps.length) missing++; else if (b.reps.length < f.rep) under++; else if (b.reps.length > f.rep) over++; }));
    const running = this.phase === 'running';
    return {
      phase: this.phase, config: { ...cfg }, volumeNameNodes: this.volumeNN, startedAt: this.startedAt, now: n,
      memory: { limitMb: DOCKER_LIMIT_MB, usedMb: running || this.phase === 'starting' || this.phase === 'stopping' ? this.usedMb() : 440, estimateMb: estimateRam(cfg).totalMb, history: this.mem.slice() },
      processes,
      hdfs: { available: running && !this.hdfsDown, safeMode: false, liveDataNodes: this.dns.filter(d => d.s === 'up').length, staleDataNodes: this.dns.filter(d => d.s === 'stopping').length, deadDataNodes: this.dns.filter(d => d.s === 'dead').length, files: this.files.length, blocks, replicas, underReplicated: under, missing, overReplicated: over, usedMb },
      yarn: { totalMb: running && cfg.services !== 'hdfs' ? YARN_MB : 0, usedMb: this.usedYarn(), running: this.jobs.filter(a => a.state === 'RUNNING').length, pending: this.jobs.filter(a => a.state === 'ACCEPTED').length, finished: this.jobs.filter(a => a.state === 'FINISHED').length },
      boot: this.boot ? { kind: this.boot.kind, startedAt: this.boot.startedAt, finishedAt: this.boot.finishedAt, expectedSec: this.boot.expectedSec, steps: this.boot.steps.map(({ lines: _lines, ...s }) => ({ ...s, log: s.log.slice() })) } : null,
      image: { name: 'franki678/bigdata-sandbox', tag: DEFAULT_IMAGE_TAG, hadoop: '3.3.6', hive: '4.0.0', spark: '3.5.9' },
    };
  }
}
