/* HDFS en el modo demo: árbol de carpetas, detalle de un archivo, subir, borrar, fsck y re-replicación. */
import type { ActionResult, FsckReport, HdfsEntry, HdfsExample, HdfsFile, HdfsFileDetail, HdfsListing, ReplicationState, UploadRequest } from '../types';
import { blockSizeMb } from '../../lib/cluster';
import { fail } from '../errors';
import { TS, type DemoEngine, type PutSpec } from './engine';
import { mb, nameOf, needHdfs, parentOf, previewFor, trace } from './common';

const BP = `BP-1937455046-172.17.0.2-${TS}`;
/* Las carpetas que crea el arranque (paso "Carpetas en HDFS") */
const BOOT_DIRS = ['/tmp', '/user/hive/warehouse', '/user/root', '/apps/tez', '/apps/spark', '/spark-logs'];

const EXAMPLES: Record<HdfsExample, Omit<PutSpec, 'path'>> = {
  ventas: { local: 'ventas_grandes.csv', mb: 5.93, rows: '200.000 filas' },
  sucias: { local: 'ventas_sucias.csv', mb: 4.45, rows: '103.000 filas' },
  numeros: { local: 'numeros.txt', mb: 6.57, rows: '1.000.000 líneas' },
  // 20.000 filas de unos 34 caracteres
  senal: { local: 'clientes_senal.csv', mb: 0.66, rows: '20.000 filas' },
  texto: { local: 'texto.txt', mb: 138 / 1048576, rows: '4 líneas' },
};

const clean = (p: string) => {
  const s = ('/' + p.trim()).replace(/\/+/g, '/').replace(/\/$/, '');
  return s || '/';
};
const inside = (path: string, dir: string) => dir === '/' || path === dir || path.startsWith(dir + '/');
const bytes = (x: number) => Math.round(x * 1048576);

export class DemoHdfs {
  constructor(private e: DemoEngine) {}

  /** Todas las carpetas: las del arranque, las creadas a mano y las que contienen archivos */
  private allDirs(): Set<string> {
    const e = this.e;
    if (!e.dirsReady && e.volumeNN != null) { BOOT_DIRS.forEach(d => e.dirs.add(d)); e.dirsReady = true; }
    const out = new Set<string>(['/']);
    const add = (p: string) => { for (let q: string | null = p; q; q = parentOf(q)) out.add(q); };
    e.dirs.forEach(add);
    e.files.forEach(f => add(parentOf(f.path)!));
    return out;
  }
  private view(path: string): HdfsFile | undefined { return this.e.filesView().find(f => f.path === path); }

  list(raw: string): HdfsListing {
    needHdfs(this.e);
    const path = clean(raw); const dirs = this.allDirs();
    if (!dirs.has(path)) fail(this.view(path) ? 'invalid' : 'not_found', this.view(path) ? `${path} es un archivo, no una carpeta` : `No existe ${path}`);
    const at = this.e.startedAt || this.e.now();
    const child = (p: string) => p !== path && parentOf(p) === path;
    const entries: HdfsEntry[] = [
      ...[...dirs].filter(child).sort().map(d => ({
        path: d, name: nameOf(d), type: 'dir' as const, owner: 'root', group: 'supergroup', permission: d === '/tmp' ? 'rwxrwxrwt' : 'rwxr-xr-x', modifiedAt: at,
        children: [...dirs].filter(x => x !== d && parentOf(x) === d).length + this.e.files.filter(f => parentOf(f.path) === d).length,
      })),
      ...this.e.filesView().filter(f => parentOf(f.path) === path).sort((a, b) => a.path.localeCompare(b.path)).map(f => ({
        path: f.path, name: nameOf(f.path), type: 'file' as const, sizeMb: f.sizeMb, replication: f.replication, blockSizeMb: f.blockSizeMb, blocks: f.blocks.length,
        owner: 'root', group: 'supergroup', permission: 'rw-r--r--', modifiedAt: f.modifiedAt, state: f.state,
      })),
    ];
    return { path, parent: parentOf(path), entries };
  }

  private fsckLines(f: HdfsFile): string[] {
    const st = f.state === 'missing' ? 'MISSING ' + f.blocks.filter(b => !b.locations.length).length + ' blocks' : f.state === 'under' ? 'Under replicated' : f.state === 'writing' ? 'OPENFORWRITE' : 'OK';
    const out = [`${f.path} ${bytes(f.sizeMb)} bytes, replicated: replication=${f.replication}, ${f.blocks.length} block(s):  ${st}`];
    f.blocks.forEach((b, i) => {
      if (b.locations.length && b.locations.length < f.replication) out.push(`${f.path}:  Under replicated ${BP}:${b.name}. Target Replicas is ${f.replication} but found ${b.locations.length} live replica(s), 0 decommissioned replica(s), 0 decommissioning replica(s).`);
      out.push(`${i}. ${BP}:${b.name} len=${bytes(b.sizeMb)} ${b.locations.length ? `Live_repl=${b.locations.length}  [${b.locations.map(id => `DatanodeInfoWithStorage[127.0.0.1:${9910 + id},DS-dn${id},DISK]`).join(', ')}]` : 'MISSING!'}`);
    });
    return out;
  }

  file(raw: string): HdfsFileDetail {
    needHdfs(this.e);
    const path = clean(raw); const f = this.view(path);
    if (!f) fail('not_found', `No existe el archivo ${path}`);
    return { ...f, owner: 'root', permission: 'rw-r--r--', preview: previewFor(path), fsck: this.fsckLines(f) };
  }

  upload(req: UploadRequest): ActionResult {
    needHdfs(this.e);
    const dest = clean(req.dest);
    if (this.view(dest)) fail('invalid', `${dest} es un archivo: elegí una carpeta`);
    const bsMb = req.blockSize ? blockSizeMb(req.blockSize) : null;
    if (req.blockSize && !bsMb) fail('invalid', `Tamaño de bloque inválido: ${req.blockSize} (por ejemplo 128m o 2m)`);
    if (req.replication != null && (req.replication < 1 || req.replication > 9)) fail('invalid', 'La replicación va de 1 a 9');
    let spec: Omit<PutSpec, 'path'>;
    if (req.example) spec = EXAMPLES[req.example];
    else if (req.file) spec = { local: req.file.name, mb: req.file.size / 1048576, rows: 'archivo de tu compu' };
    else return fail('invalid', 'Falta el archivo: example o file');
    const path = (dest === '/' ? '' : dest) + '/' + spec.local;
    if (this.e.files.some(f => f.path === path && f.writing)) fail('busy', `${path} se está escribiendo`);
    this.e.dirs.add(dest);
    const f = this.e.putFile({ ...spec, path, rep: req.replication, bsMb: bsMb || undefined })!;
    const live = Math.min(f.rep, this.e.dnsUp());
    const flags = (req.replication ? ` -D dfs.replication=${req.replication}` : '') + (bsMb ? ` -D dfs.blocksize=${req.blockSize}` : '');
    return {
      id: path, state: 'running',
      trace: trace(`hdfs dfs${flags} -put -f ${spec.local} ${dest}/`, `${spec.local} · ${spec.rows} · ${mb(spec.mb)}`,
        `Lo corta en bloques de ${f.bsMb} MB; cada bloque va a un DataNode, que lo pasa al siguiente hasta tener ${live} copia${live > 1 ? 's' : ''}`,
        `${path}: ${f.blocks.length} bloque${f.blocks.length > 1 ? 's' : ''} × ${live} copia${live > 1 ? 's' : ''}`,
        { engine: 'hdfs', after: req.example ? previewFor(path) : undefined }),
    };
  }

  mkdir(raw: string): ActionResult {
    needHdfs(this.e);
    const path = clean(raw);
    if (this.view(path)) fail('invalid', `Ya hay un archivo en ${path}`);
    const existed = this.allDirs().has(path);
    this.e.dirs.add(path);
    const t = trace(`hdfs dfs -mkdir -p ${path}`, path, 'Crea la carpeta (y las de arriba que falten). Solo cambia los metadatos del NameNode: no toca ningún DataNode', existed ? 'Ya existía: no cambia nada' : 'Carpeta vacía', { engine: 'hdfs' });
    this.e.act('Vos', 'info', `Carpeta ${path}`, { ...t });
    this.e.emit({ type: 'hdfs', path }); this.e.emit();
    return { id: path, state: 'done', trace: t };
  }

  remove(raw: string, recursive: boolean): ActionResult {
    needHdfs(this.e);
    const path = clean(raw);
    if (path === '/') fail('invalid', 'No se puede borrar la raíz');
    const isDir = this.allDirs().has(path);
    const file = this.view(path);
    if (!isDir && !file) fail('not_found', `No existe ${path}`);
    const gone = this.e.filesView().filter(f => inside(f.path, path));
    if (isDir && !recursive && (gone.length || [...this.allDirs()].some(d => d !== path && inside(d, path)))) fail('invalid', `${path} no está vacía: hace falta borrar con -r`);
    const copies = gone.reduce((a, f) => a + f.blocks.reduce((x, b) => x + b.locations.length, 0), 0);
    const total = gone.reduce((a, f) => a + f.sizeMb, 0);
    this.e.files = this.e.files.filter(f => !inside(f.path, path));
    [...this.e.dirs].forEach(d => { if (inside(d, path)) this.e.dirs.delete(d); });
    const t = trace(`hdfs dfs -rm${isDir ? ' -r' : ''} -skipTrash ${path}`, isDir ? `${path} con ${gone.length} archivo${gone.length !== 1 ? 's' : ''}` : `${path} · ${mb(total)}`,
      'El NameNode borra la entrada de sus metadatos y en el próximo latido les dice a los DataNodes que borren los bloques',
      `${copies} copia${copies !== 1 ? 's' : ''} de bloque liberada${copies !== 1 ? 's' : ''} · ${mb(total)} menos en HDFS`,
      { engine: 'hdfs', before: { columns: ['ruta', 'tamaño', 'bloques'], rows: gone.map(f => [f.path, mb(f.sizeMb), f.blocks.length]), total: gone.length }, after: { columns: [], rows: [], note: 'Ya no está' } });
    this.e.act('Vos', 'warn', `Borrado ${path}`, { ...t });
    this.e.emit({ type: 'hdfs', path }); this.e.emit();
    return { id: path, state: 'done', trace: t };
  }

  fsck(raw: string): FsckReport {
    needHdfs(this.e);
    const path = clean(raw); const dirs = this.allDirs();
    if (!dirs.has(path) && !this.view(path)) fail('not_found', `No existe ${path}`);
    const files = this.e.filesView().filter(f => inside(f.path, path));
    const blocks = files.flatMap(f => f.blocks.map(b => ({ f, b })));
    const live = this.e.dnsUp();
    const cnt = (fn: (x: { f: HdfsFile; b: HdfsFile['blocks'][number] }) => boolean) => blocks.filter(fn).length;
    const missing = cnt(x => !x.b.locations.length), under = cnt(x => x.b.locations.length > 0 && x.b.locations.length < x.f.replication), over = cnt(x => x.b.locations.length > x.f.replication);
    const reps = blocks.reduce((a, x) => a + x.b.locations.length, 0);
    const size = files.reduce((a, f) => a + f.sizeMb, 0);
    const pct = (k: number) => `${k} (${blocks.length ? (k / blocks.length * 100).toFixed(1) : '0.0'} %)`;
    const healthy = !missing;
    const def = this.e.applied?.replication ?? 1;
    const problems: FsckReport['problems'] = blocks.filter(x => !x.b.locations.length || x.b.locations.length !== x.f.replication).map(x => ({
      file: x.f.path, block: x.b.name, issue: !x.b.locations.length ? 'missing' : x.b.locations.length < x.f.replication ? 'under' : 'over', replicas: x.b.locations.length, expected: x.f.replication,
    }));
    const raw2 = [
      `Connecting to namenode via http://localhost:9870/fsck?ugi=root&files=1&blocks=1&locations=1&path=${encodeURIComponent(path)}`,
      `FSCK started by root (auth:SIMPLE) from /127.0.0.1 for path ${path}`,
      ...files.flatMap(f => this.fsckLines(f)), '',
      `Status: ${healthy ? 'HEALTHY' : 'CORRUPT'}`,
      ` Number of data-nodes:\t${live}`, ' Number of racks:\t\t1', ` Total dirs:\t\t\t${[...dirs].filter(d => inside(d, path)).length}`, ' Total symlinks:\t\t0', '',
      'Replicated Blocks:', ` Total size:\t${bytes(size)} B`, ` Total files:\t${files.length}`,
      ` Total blocks (validated):\t${blocks.length}${blocks.length ? ` (avg. block size ${Math.round(bytes(size) / blocks.length)} B)` : ''}`,
      ` Minimally replicated blocks:\t${pct(blocks.length - missing)}`, ` Over-replicated blocks:\t${pct(over)}`, ` Under-replicated blocks:\t${pct(under)}`, ' Mis-replicated blocks:\t\t0 (0.0 %)',
      ` Default replication factor:\t${def}`, ` Average block replication:\t${blocks.length ? (reps / blocks.length).toFixed(1) : '0.0'}`,
      ` Missing blocks:\t\t${missing}`, ' Corrupt blocks:\t\t0', '',
      `The filesystem under path '${path}' is ${healthy ? 'HEALTHY' : 'CORRUPT'}`,
    ];
    const t = trace(`hdfs fsck ${path} -files -blocks -locations`, `${files.length} archivo${files.length !== 1 ? 's' : ''} bajo ${path}`,
      'Le pregunta al NameNode, bloque por bloque, cuántas copias vivas tiene y en qué DataNode está cada una. No lee los datos',
      healthy ? (under ? `Sano, pero ${under} bloque${under > 1 ? 's' : ''} con menos copias de las pedidas` : 'Sano: todos los bloques con sus copias') : `${missing} bloque${missing > 1 ? 's' : ''} sin ninguna copia`, { engine: 'hdfs' });
    this.e.act('Vos', healthy ? 'info' : 'error', `fsck de ${path}: ${healthy ? 'HEALTHY' : 'CORRUPT'}`, { ...t });
    return {
      path, healthy, totalSizeMb: size, dirs: [...dirs].filter(d => inside(d, path)).length, files: files.length, blocks: blocks.length,
      minimallyReplicated: blocks.length - missing, underReplicated: under, overReplicated: over, missing, corrupt: 0,
      defaultReplication: def, avgReplication: blocks.length ? reps / blocks.length : 0, liveDataNodes: live, problems, raw: raw2, trace: t,
    };
  }

  replication(): ReplicationState {
    needHdfs(this.e);
    const files = this.e.filesView().filter(f => f.state !== 'writing');
    const live = this.e.dnsUp();
    const tasks: ReplicationState['tasks'] = [];
    let under = 0, missing = 0, over = 0;
    files.forEach(f => f.blocks.forEach(b => {
      const k = b.locations.length;
      if (!k) { missing++; return; }
      if (k < f.replication) { under++; for (let i = k; i < Math.min(f.replication, live); i++) tasks.push({ block: b.name, file: f.path, kind: 'copy', from: b.locations[0], state: this.e.replicating() ? 'running' : 'pending' }); }
      if (k > f.replication) { over++; tasks.push({ block: b.name, file: f.path, kind: 'delete', from: b.locations[b.locations.length - 1], state: 'pending' }); }
    }));
    const now = this.e.now();
    return {
      underReplicated: under, missing, overReplicated: over, pending: tasks.length,
      stale: this.e.dataNodes().filter(d => d.state === 'stale' && d.deadAt).map(d => ({ dataNode: d.id, deadInSec: Math.max(0, Math.round((d.deadAt! - now) / 1000)) })),
      tasks, recent: this.e.transfers.slice(),
    };
  }
}

