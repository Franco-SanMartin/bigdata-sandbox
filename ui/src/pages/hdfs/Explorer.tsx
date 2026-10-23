/* Explorador de HDFS: migas, filtro, carpeta nueva y una fila por archivo con ver, bajar, mover,
   réplica y borrar. Se puede soltar un archivo encima para subirlo a la carpeta que estás viendo. */
import { useState, type ReactNode } from 'react';
import { ChevronRight, Copy, Download, Eye, File, FileUp, Folder, FolderPlus, MoveRight, RotateCw, Search, Trash2, Upload } from 'lucide-react';
import type { HdfsEntry, HdfsListing } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState, SkeletonLines, useBlock } from '../../components/base';
import { Tip } from '../../components/ui';
import { hdfsDelete, hdfsMkdir, hdfsUpload } from '../../state/actions';
import { useSnapshot } from '../../state/store';
import { clock, sizeLabel } from '../../lib/format';
import { ErrorLine, type Res } from './common';
import { downloadFile } from './Dialogs';

export const FILE_STATE: Record<NonNullable<HdfsEntry['state']>, [string, string]> = {
  ok: ['ok', 'sano'], writing: ['run', 'escribiendo'], under: ['run', 'faltan copias'], missing: ['bad', 'sin copias'],
};

const join = (dir: string, name: string) => (name.startsWith('/') ? name : (dir === '/' ? '' : dir) + '/' + name);

export interface RowActions {
  view: (p: string) => void;
  move: (p: string) => void;
  replica: (e: HdfsEntry) => void;
  upload: (f?: File | null) => void;
}

/** Botón de ícono con su nombre en el tooltip; si la escritura no está, dice por qué */
function Act({ label, onClick, children, block, danger }: { label: string; onClick: () => void; children: ReactNode; block?: string | null; danger?: boolean }) {
  return (
    <Tip content={block ? `${label}: ${block}` : label}>
      <button type="button" className="btn btn-sm btn-ghost btn-icon hd-act" data-danger={danger || undefined} aria-label={label} aria-disabled={block ? 'true' : undefined}
        onClick={e => { e.stopPropagation(); if (!block) onClick(); }}>{children}</button>
    </Tip>
  );
}

export function Explorer({ path, setPath, ls, sel, setSel, act, compact }: {
  path: string; setPath: (p: string) => void; ls: Res<HdfsListing>; sel: string | null; setSel: (p: string | null) => void; act: RowActions;
  /** Con el detalle abierto al costado: menos columnas */
  compact?: boolean;
}) {
  const [mk, setMk] = useState(false);
  const [dirName, setDirName] = useState('');
  const [q, setQ] = useState('');
  const [over, setOver] = useState(false);
  const write = useBlock('hdfs.write');
  const wb = write?.reason ?? null;
  const crumbs = path.split('/').filter(Boolean);

  const mkdir = async () => {
    if (!dirName.trim()) return;
    if (await hdfsMkdir(join(path, dirName.trim()))) { setDirName(''); setMk(false); ls.reload(); }
  };
  const remove = async (e: HdfsEntry) => {
    if (await hdfsDelete(e.path, e.type === 'dir')) { if (sel && (sel === e.path || sel.startsWith(e.path + '/'))) setSel(null); ls.reload(); }
  };
  const copyPath = async (p: string) => { try { await navigator.clipboard.writeText(p); } catch { /* sin portapapeles: no pasa nada */ } };

  const all: Column<HdfsEntry>[] = [
    { id: 'name', header: 'Nombre', sort: r => (r.type === 'dir' ? '0' : '1') + r.name, cell: r => (
      <span className="hd-name">{r.type === 'dir' ? <Folder size={14} /> : <File size={14} />}<span className="mono">{r.name}</span></span>
    ) },
    { id: 'size', header: 'Tamaño', align: 'right', sort: r => r.sizeMb ?? -1, cell: r => (r.type === 'dir' ? <span className="muted">{r.children} adentro</span> : sizeLabel(r.sizeMb ?? 0)) },
    { id: 'rep', header: 'Réplica', align: 'right', cell: r => r.replication ?? <span className="dim">—</span> },
    { id: 'blocks', header: 'Bloques', align: 'right', cell: r => (r.blocks != null ? <>{r.blocks} <span className="muted">× {r.blockSizeMb} MB</span></> : <span className="dim">—</span>) },
    { id: 'state', header: 'Estado', cell: r => (r.state && r.state !== 'ok' ? <span className="badge" data-k={FILE_STATE[r.state][0]}>{FILE_STATE[r.state][1]}</span> : null) },
    { id: 'mod', header: 'Modificado', sort: r => r.modifiedAt, cell: r => <span className="muted">{clock(r.modifiedAt)}</span> },
    { id: 'x', header: '', width: 176, align: 'right', cell: r => (
      <span className="hd-acts">
        {r.type === 'file' ? <>
          <Act label="Ver contenido" onClick={() => act.view(r.path)}><Eye size={14} /></Act>
          <Act label="Bajar a tu compu" onClick={() => downloadFile(r.path)} block={r.state === 'writing' ? 'se está escribiendo' : null}><Download size={14} /></Act>
          <Act label="Cambiar réplica" onClick={() => act.replica(r)} block={wb ?? (r.state === 'writing' ? 'se está escribiendo' : null)}><Copy size={14} /></Act>
        </> : <Act label="Copiar la ruta" onClick={() => copyPath(r.path)}><Copy size={14} /></Act>}
        <Act label="Mover o renombrar" onClick={() => act.move(r.path)} block={wb}><MoveRight size={14} /></Act>
        <Act label={r.type === 'dir' ? 'Borrar la carpeta y lo de adentro' : 'Borrar'} onClick={() => remove(r)} block={wb} danger><Trash2 size={14} /></Act>
      </span>
    ) },
  ];

  const cols = compact ? all.filter(c => !['blocks', 'mod', 'rep'].includes(c.id)) : all;
  const rows = (ls.data?.entries ?? []).filter(e => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase()));
  const empty = ls.data && !ls.data.entries.length;
  // Carpeta vacía pero HDFS cuenta archivos: dónde están (si no, parece que el resumen miente)
  const { files } = useSnapshot();
  const others = empty ? files.filter(f => !f.path.startsWith(path === '/' ? '/' : path + '/')) : [];
  const otherDirs = [...new Set(others.map(f => f.path.slice(0, f.path.lastIndexOf('/')) || '/'))].sort().slice(0, 3);

  return (
    <section className="panel hd-main" aria-label="Explorador"
      onDragOver={e => { if (!wb && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={e => { if (wb) return; e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) act.upload(f); }}>
      <div className="panel-h">
        <nav aria-label="Ruta" className="hd-crumbs">
          <button className="btn btn-sm btn-ghost mono" type="button" onClick={() => setPath('/')} aria-current={!crumbs.length ? 'page' : undefined}>/</button>
          {crumbs.map((c, i) => (
            <span key={i} className="hd-crumb">
              {i > 0 && <ChevronRight size={12} className="dim" />}
              <button className="btn btn-sm btn-ghost mono" type="button" aria-current={i === crumbs.length - 1 ? 'page' : undefined} onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</button>
            </span>
          ))}
        </nav>
        <span className="end">
          {!empty && <label className="input-search hd-q"><Search size={13} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrar por nombre" aria-label="Filtrar por nombre" /></label>}
          <Tip content={wb ?? 'hdfs dfs -mkdir -p'}><button className="btn btn-sm" type="button" aria-pressed={mk} aria-disabled={wb ? 'true' : undefined} onClick={() => !wb && setMk(m => !m)}><FolderPlus size={13} />Carpeta</button></Tip>
          <Tip content="Volver a listar"><button className="btn btn-sm btn-ghost btn-icon" type="button" onClick={ls.reload} aria-label="Recargar"><RotateCw size={13} /></button></Tip>
        </span>
      </div>
      {mk && (
        <form className="toolbar" onSubmit={e => { e.preventDefault(); void mkdir(); }}>
          <span className="mono muted">hdfs dfs -mkdir -p {path === '/' ? '' : path}/</span>
          <input className="input hd-in mono" autoFocus value={dirName} onChange={e => setDirName(e.target.value)} placeholder="nueva" aria-label="Nombre de la carpeta" spellCheck={false} />
          <button className="btn btn-sm btn-primary" type="submit" disabled={!dirName.trim()}>Crear</button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => setMk(false)}>Cancelar</button>
        </form>
      )}
      {ls.err && <div className="panel-b"><ErrorLine err={ls.err} onRetry={ls.err.code === 'not_found' ? () => setPath('/user/root') : ls.reload} /></div>}
      <div className="panel-b flush hd-body">
        {!ls.data && !ls.err ? <div className="hd-sk" aria-busy="true"><SkeletonLines n={6} /></div>
          : empty ? (
            <EmptyState icon={<Folder size={20} />} title={`${path} está vacía`} compact
              actions={<>
                <button type="button" className="btn btn-primary" aria-disabled={wb ? 'true' : undefined} title={wb ?? undefined} onClick={() => !wb && hdfsUpload({ dest: path, example: 'ventas' }).then(r => r && ls.reload())}><Upload size={14} />Subir ventas_grandes.csv de ejemplo</button>
                <button type="button" className="btn" aria-disabled={wb ? 'true' : undefined} onClick={() => !wb && act.upload(null)}><FileUp size={14} />Subir desde tu compu</button>
                <button type="button" className="btn" aria-disabled={wb ? 'true' : undefined} onClick={() => !wb && setMk(true)}><FolderPlus size={14} />Crear carpeta</button>
              </>}
              foot={wb ? `No se puede escribir: ${wb}` : 'También podés soltar un archivo acá encima.'}>
              Subí un archivo para ver cómo HDFS lo parte en bloques y reparte las copias entre los DataNodes.
              {others.length > 0 && <> {others.length === 1 ? 'El único archivo que cuenta HDFS está en' : `Los ${others.length} archivos que cuenta HDFS están en`}{' '}
                {otherDirs.map((d, i) => <span key={d}>{i > 0 && ', '}<button type="button" className="link mono" onClick={() => setPath(d)}>{d}</button></span>)}.</>}
            </EmptyState>
          ) : ls.data && (
            <DataTable label={`Contenido de ${path}`} columns={cols} rows={rows} rowKey={r => r.path} selected={sel}
              onRowClick={r => (r.type === 'dir' ? setPath(r.path) : setSel(sel === r.path ? null : r.path))}
              empty={<span className="muted">Nada coincide con «{q}»</span>} initialSort={{ id: 'name', dir: 1 }} />
          )}
        {over && <div className="hd-dropping" aria-hidden="true"><FileUp size={22} /><b>Soltá para subir a {path}</b></div>}
      </div>
    </section>
  );
}
