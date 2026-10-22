/* Explorador de HDFS por ruta: migas, carpeta nueva, subir y borrar. */
import { useRef, useState } from 'react';
import { ChevronRight, File, Folder, FolderPlus, HardDrive, RotateCw, Trash2, Upload, X } from 'lucide-react';
import type { ActionResult, HdfsEntry, HdfsExample, HdfsListing } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { TraceView } from '../../components/Trace';
import { Seg } from '../../components/ui';
import { hdfsDelete, hdfsMkdir, hdfsUpload } from '../../state/actions';
import { clock, sizeLabel } from '../../lib/format';
import { ErrorLine, Loading, type Res } from './common';

export const FILE_STATE: Record<NonNullable<HdfsEntry['state']>, [string, string]> = {
  ok: ['ok', 'sano'], writing: ['run', 'escribiendo'], under: ['run', 'faltan copias'], missing: ['bad', 'sin copias'],
};

const EXAMPLES: { value: HdfsExample; label: string }[] = [
  { value: 'ventas', label: 'ventas_grandes.csv · 5,9 MB' },
  { value: 'sucias', label: 'ventas_sucias.csv · 4,5 MB' },
  { value: 'numeros', label: 'numeros.txt · 6,6 MB' },
  { value: 'senal', label: 'clientes_senal.csv · 0,7 MB' },
  { value: 'texto', label: 'texto.txt · 138 bytes' },
];

const join = (dir: string, name: string) => (name.startsWith('/') ? name : (dir === '/' ? '' : dir) + '/' + name);

/** El último comando que corrió desde el explorador, con su traza desplegable */
export function LastAction({ r, onClose }: { r: ActionResult; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ops-last">
      <div className="ops-last-h">
        <span className="badge" data-k={r.state === 'done' ? 'ok' : 'run'}>{r.state === 'done' ? 'hecho' : 'en curso'}</span>
        <code className="mono">$ {r.trace.command}</code>
        <span className="muted ops-ell">→ {r.trace.output}</span>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? 'menos' : 'traza'}</button>
        <button className="btn btn-sm btn-ghost btn-icon" type="button" onClick={onClose} aria-label="Cerrar"><X size={13} /></button>
      </div>
      {open && <div className="ops-last-b"><TraceView trace={r.trace} /></div>}
    </div>
  );
}

export function Explorer({ path, setPath, ls, sel, setSel, defRep, defBlock }: {
  path: string; setPath: (p: string) => void; ls: Res<HdfsListing>; sel: string | null; setSel: (p: string | null) => void; defRep: number; defBlock: string;
}) {
  const [form, setForm] = useState<'mkdir' | 'upload' | null>(null);
  const [last, setLast] = useState<ActionResult | null>(null);
  const [dirName, setDirName] = useState('');
  const [src, setSrc] = useState<'example' | 'local'>('example');
  const [example, setExample] = useState<HdfsExample>('ventas');
  const [rep, setRep] = useState<string>('');
  const [bs, setBs] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const crumbs = path.split('/').filter(Boolean);

  const done = (r: ActionResult | undefined) => { if (r) { setLast(r); setForm(null); ls.reload(); } };
  const mkdir = async () => {
    if (!dirName.trim()) return;
    setBusy(true); done(await hdfsMkdir(join(path, dirName.trim()))); setBusy(false); setDirName('');
  };
  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (src === 'local' && !file) return;
    setBusy(true);
    done(await hdfsUpload({ dest: path, ...(src === 'example' ? { example } : { file }), replication: rep ? +rep : undefined, blockSize: bs.trim() || undefined }));
    setBusy(false);
  };
  const remove = async (e: HdfsEntry) => {
    const r = await hdfsDelete(e.path, e.type === 'dir');
    if (r) { if (sel && (sel === e.path || sel.startsWith(e.path + '/'))) setSel(null); done(r); }
  };

  const cols: Column<HdfsEntry>[] = [
    { id: 'name', header: 'Nombre', sort: r => (r.type === 'dir' ? '0' : '1') + r.name, cell: r => <span className="ops-name">{r.type === 'dir' ? <Folder size={14} /> : <File size={14} />}{r.name}</span> },
    { id: 'size', header: 'Tamaño', align: 'right', sort: r => r.sizeMb ?? -1, cell: r => (r.type === 'dir' ? <span className="muted">{r.children} adentro</span> : sizeLabel(r.sizeMb ?? 0)) },
    { id: 'rep', header: 'Réplica', align: 'right', cell: r => r.replication ?? <span className="dim">—</span> },
    { id: 'blocks', header: 'Bloques', align: 'right', cell: r => (r.blocks != null ? <>{r.blocks} <span className="muted">× {r.blockSizeMb} MB</span></> : <span className="dim">—</span>) },
    { id: 'state', header: 'Estado', cell: r => (r.state ? <span className="badge" data-k={FILE_STATE[r.state][0]}>{FILE_STATE[r.state][1]}</span> : null) },
    { id: 'perm', header: 'Permisos', cell: r => <span className="mono muted">{r.type === 'dir' ? 'd' : '-'}{r.permission} {r.owner}</span> },
    { id: 'mod', header: 'Modificado', sort: r => r.modifiedAt, cell: r => <span className="muted">{clock(r.modifiedAt)}</span> },
    { id: 'x', header: '', width: 40, cell: r => (
      <button className="btn btn-sm btn-ghost btn-icon ops-del" type="button" aria-label={`Borrar ${r.name}`} onClick={ev => { ev.stopPropagation(); void remove(r); }}><Trash2 size={13} /></button>
    ) },
  ];

  return (
    <section className="panel span-8">
      <div className="panel-h">
        <h2>Explorador</h2>
        <nav aria-label="Ruta" className="ops-crumbs">
          <button className="btn btn-sm btn-ghost mono" type="button" onClick={() => setPath('/')}>/</button>
          {crumbs.map((c, i) => (
            <span key={i} className="ops-crumb">
              {i > 0 && <ChevronRight size={12} className="dim" />}
              <button className="btn btn-sm btn-ghost mono" type="button" aria-current={i === crumbs.length - 1 ? 'page' : undefined} onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</button>
            </span>
          ))}
        </nav>
        <span className="end">
          <button className="btn btn-sm" type="button" aria-pressed={form === 'mkdir'} onClick={() => setForm(f => (f === 'mkdir' ? null : 'mkdir'))}><FolderPlus size={13} />Carpeta</button>
          <button className="btn btn-sm" type="button" aria-pressed={form === 'upload'} onClick={() => setForm(f => (f === 'upload' ? null : 'upload'))}><Upload size={13} />Subir</button>
          <button className="btn btn-sm btn-ghost btn-icon" type="button" onClick={ls.reload} aria-label="Recargar"><RotateCw size={13} /></button>
        </span>
      </div>
      {form === 'mkdir' && (
        <form className="toolbar" onSubmit={e => { e.preventDefault(); void mkdir(); }}>
          <span className="mono muted">hdfs dfs -mkdir -p</span>
          <input className="input ops-in mono" autoFocus value={dirName} onChange={e => setDirName(e.target.value)} placeholder={`${path === '/' ? '' : path}/nueva`} aria-label="Nombre de la carpeta" />
          <button className="btn btn-sm btn-primary" type="submit" disabled={busy || !dirName.trim()}>Crear</button>
        </form>
      )}
      {form === 'upload' && (
        <form className="toolbar" onSubmit={e => { e.preventDefault(); void upload(); }}>
          <Seg value={src} onChange={setSrc} label="Origen" options={[{ value: 'example', label: 'Ejemplo' }, { value: 'local', label: 'De tu compu' }]} />
          {src === 'example'
            ? <select className="input ops-sel" value={example} onChange={e => setExample(e.target.value as HdfsExample)} aria-label="Archivo de ejemplo">{EXAMPLES.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
            : <input ref={fileRef} className="input ops-file" type="file" aria-label="Archivo" />}
          <label className="ops-lbl">réplica
            <select className="input ops-sel sm" value={rep} onChange={e => setRep(e.target.value)} aria-label="Réplica">
              <option value="">{defRep} (conf)</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="ops-lbl">bloque
            <input className="input ops-in sm mono" value={bs} onChange={e => setBs(e.target.value)} placeholder={defBlock} aria-label="Tamaño de bloque" />
          </label>
          <span className="mono muted ops-ell">→ {path}</span>
          <button className="btn btn-sm btn-primary" type="submit" disabled={busy}><Upload size={13} />Subir</button>
        </form>
      )}
      {last && <LastAction r={last} onClose={() => setLast(null)} />}
      {ls.err && <div className="panel-b"><ErrorLine err={ls.err} onRetry={ls.err.code === 'not_found' ? () => setPath('/') : ls.reload} /></div>}
      <div className="panel-b flush">
        {!ls.data && !ls.err ? <div className="panel-b"><Loading /></div> : ls.data && (
          <DataTable label="Contenido de la carpeta" columns={cols} rows={ls.data.entries} rowKey={r => r.path} selected={sel}
            onRowClick={r => (r.type === 'dir' ? setPath(r.path) : setSel(r.path))}
            empty={<span className="ops-empty-row"><HardDrive size={14} />Carpeta vacía: subí un archivo o creá una carpeta</span>} initialSort={{ id: 'name', dir: 1 }} />
        )}
      </div>
    </section>
  );
}
