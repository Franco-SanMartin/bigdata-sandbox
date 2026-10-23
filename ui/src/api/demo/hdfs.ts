/* HDFS en el modo demo: árbol de carpetas, detalle de un archivo, subir, ver, bajar, mover, borrar, fsck y re-replicación. */
import type { ActionResult, FsckReport, HdfsCat, HdfsEntry, HdfsExample, HdfsFile, HdfsFileDetail, HdfsListing, ReplicationState, UploadRequest } from '../types';
import { blockSizeMb } from '../../lib/cluster';
import { fail } from '../errors';
import { TS, type DemoEngine, type PutSpec } from './engine';
import { mb, nameOf, needHdfs, parentOf, previewFor, trace } from './common';
import { MAX_DOWNLOAD, sourceOf, store } from './contenido';
import { PROTECTED } from '../../lib/jobs';

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
const CAT_DEFAULT = 64 * 1024, CAT_MAX = 1024 * 1024;
/** Como shlex.quote, para mostrar el comando */
const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'"'"'`)}'`);
function bounded(raw: number | undefined, name: string, lo: number, hi: number, def: number): number {
  if (raw == null) return def;
  if (!Number.isInteger(raw) || raw < lo || raw > hi) fail('invalid', `${name} tiene que ser un entero entre ${lo} y ${hi}`);
  return raw;
}

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
    if (req.file) store(this.e).set(path, req.file); else store(this.e).delete(path);
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
    [...store(this.e).keys()].forEach(k => { if (inside(k, path)) store(this.e).delete(k); });
    [...this.e.dirs].forEach(d => { if (inside(d, path)) this.e.dirs.delete(d); });
    const t = trace(`hdfs dfs -rm${isDir ? ' -r' : ''} -skipTrash ${path}`, isDir ? `${path} con ${gone.length} archivo${gone.length !== 1 ? 's' : ''}` : `${path} · ${mb(total)}`,
      'El NameNode borra la entrada de sus metadatos y en el próximo latido les dice a los DataNodes que borren los bloques',
      `${copies} copia${copies !== 1 ? 's' : ''} de bloque liberada${copies !== 1 ? 's' : ''} · ${mb(total)} menos en HDFS`,
      { engine: 'hdfs', before: { columns: ['ruta', 'tamaño', 'bloques'], rows: gone.map(f => [f.path, mb(f.sizeMb), f.blocks.length]), total: gone.length }, after: { columns: [], rows: [], note: 'Ya no está' } });
    this.e.act('Vos', 'warn', `Borrado ${path}`, { ...t });
    this.e.emit({ type: 'hdfs', path }); this.e.emit();
    return { id: path, state: 'done', trace: t };
  }

  private fileOrFail(path: string): HdfsFile {
    const f = this.view(path);
    if (f) return f;
    if (this.allDirs().has(path)) fail('invalid', `${path} es una carpeta: elegí un archivo`);
    return fail('not_found', `No existe el archivo ${path}`);
  }

  /** hdfs dfs -cat de un tramo: si queda contenido después, corta en el último salto de línea */
  async cat(raw: string, offsetRaw?: number, lengthRaw?: number): Promise<HdfsCat> {
    needHdfs(this.e);
    const path = clean(raw);
    const offset = bounded(offsetRaw, 'offset', 0, 2 ** 50, 0);
    const length = bounded(lengthRaw, 'length', 1, CAT_MAX, CAT_DEFAULT);
    const f = this.fileOrFail(path);
    if (f.state === 'missing') fail('failed', `No se pudo leer ${path}: tiene bloques sin ninguna copia viva`);
    const src = sourceOf(this.e, path, f.sizeMb);
    if (offset > src.total) fail('invalid', `offset ${offset} pasa el final del archivo (${src.total} bytes)`);
    let text = src.binary ? '' : await src.read(offset, length);
    const binary = src.binary || text.includes('\0');
    if (binary) text = '';
    let used = binary ? Math.min(length, src.total - offset) : text.length;
    if (!binary && offset + used < src.total) { const cut = text.lastIndexOf('\n'); if (cut >= 0) { text = text.slice(0, cut + 1); used = text.length; } }
    const command = offset ? `hdfs dfs -cat ${q(path)} | tail -c +${offset + 1} | head -c ${used || length}` : `hdfs dfs -cat ${q(path)} | head -c ${used || length}`;
    return { path, offset, length: used, totalBytes: src.total, text, truncated: offset + used < src.total, binary, command };
  }

  /** hdfs dfs -get: el archivo entero, como URL para bajarlo desde el navegador */
  download(raw: string): { url: string; name: string } {
    needHdfs(this.e);
    const path = clean(raw);
    const f = this.fileOrFail(path);
    if (f.state === 'missing') fail('failed', `No se pudo leer ${path}: tiene bloques sin ninguna copia viva`);
    if (f.state === 'writing') fail('busy', `${path} se está escribiendo: esperá a que termine la subida`);
    const src = sourceOf(this.e, path, f.sizeMb);
    if (src.total > MAX_DOWNLOAD) fail('invalid', `En el modo demo se bajan archivos de hasta ${MAX_DOWNLOAD / 1048576} MB (${path} tiene ${mb(f.sizeMb)})`);
    const url = URL.createObjectURL(src.blob());
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    this.e.act('Vos', 'info', `Bajado ${nameOf(path)}`, { command: `hdfs dfs -get ${q(path)} .`, input: `${path} · ${mb(f.sizeMb)}`, action: 'El cliente le pide al NameNode dónde está cada bloque y los lee en orden de los DataNodes', output: `${nameOf(path)} en tu compu` });
    return { url, name: nameOf(path) };
  }

  /** hdfs dfs -mv: solo cambia metadatos en el NameNode, los bloques no se mueven */
  move(fromRaw: string, toRaw: string): ActionResult & { path: string } {
    needHdfs(this.e);
    const src = clean(fromRaw), dst = clean(toRaw);
    if (PROTECTED.includes(src)) fail('invalid', `${src} la usa el cluster: no se puede mover`);
    if (src === dst) fail('invalid', 'El origen y el destino son la misma ruta');
    const dirs = this.allDirs();
    const isDir = dirs.has(src);
    if (!isDir && !this.view(src)) fail('not_found', `No existe ${src}`);
    if (this.e.files.some(f => f.writing && inside(f.path, src))) fail('busy', `${src} se está escribiendo: esperá a que termine la subida`);
    let final = dst;
    if (dirs.has(dst)) final = (dst === '/' ? '' : dst) + '/' + nameOf(src);
    else if (this.view(dst)) fail('invalid', `Ya existe ${dst}: elegí otro nombre o borralo antes`);
    else if (!dirs.has(parentOf(dst)!)) fail('not_found', `No existe la carpeta ${parentOf(dst)}`);
    if (final !== dst && (dirs.has(final) || this.view(final))) fail('invalid', `Ya existe ${final}: elegí otro nombre o borralo antes`);
    if (isDir && inside(final, src)) fail('invalid', 'No se puede mover una carpeta adentro de sí misma');
    if (PROTECTED.includes(final)) fail('invalid', `${final} la usa el cluster`);
    const re = (p: string) => final + p.slice(src.length);
    const moved = this.e.files.filter(f => inside(f.path, src));
    moved.forEach(f => { f.path = re(f.path); });
    [...this.e.dirs].forEach(d => { if (inside(d, src)) { this.e.dirs.delete(d); this.e.dirs.add(re(d)); } });
    if (isDir) this.e.dirs.add(final);
    const st = store(this.e);
    moved.forEach(f => { const old = src + f.path.slice(final.length); if (!st.has(old)) st.set(old, { from: old }); });
    [...st.entries()].forEach(([k, v]) => { if (inside(k, src)) { st.delete(k); st.set(re(k), v); } });
    const rename = parentOf(src) === parentOf(final);
    const t = trace(`hdfs dfs -mv ${q(src)} ${q(dst)}`, isDir ? `${src} con ${moved.length} archivo${moved.length !== 1 ? 's' : ''}` : src,
      'El NameNode cambia la ruta en sus metadatos: los bloques se quedan en los mismos DataNodes, por eso es instantáneo',
      `${rename ? 'Renombrado' : 'Movido'} a ${final}`, { engine: 'hdfs' });
    this.e.act('Vos', 'info', `${rename ? 'Renombrado' : 'Movido'} ${src} → ${final}`, { ...t });
    this.e.emit({ type: 'hdfs', path: parentOf(src)! }); this.e.emit({ type: 'hdfs', path: parentOf(final)! }); this.e.emit();
    return { id: final, state: 'done', trace: t, path: final };
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
      if (k < f.replication) { under++; for (let i = k; i < Math.min(f.replication, live); i++) tasks.push({ block: b.name, file: f.path, kind: 'copy', from: b.locations[0], state: 'pending' }); }
      if (k > f.replication) { over++; tasks.push({ block: b.name, file: f.path, kind: 'delete', from: b.locations[b.locations.length - 1], state: 'pending' }); }
    }));
    // El NameNode copia de a pocos bloques por latido: el primero va copiando, el resto espera en la cola
    if (this.e.replicating()) tasks.filter(t => t.kind === 'copy').slice(0, 2).forEach(t => { t.state = 'running'; });
    const now = this.e.now();
    return {
      underReplicated: under, missing, overReplicated: over, pending: tasks.length,
      stale: this.e.dataNodes().filter(d => d.state === 'stale' && d.deadAt).map(d => ({ dataNode: d.id, deadInSec: Math.max(0, Math.round((d.deadAt! - now) / 1000)) })),
      tasks, recent: this.e.transfers.slice(),
    };
  }
}

