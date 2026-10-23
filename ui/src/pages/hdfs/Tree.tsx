/* Árbol de carpetas de HDFS: cada carpeta lista sus subcarpetas recién cuando la abrís.
   Las que están en el camino de la carpeta actual quedan abiertas solas. */
import { useEffect, useState } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import type { ApiEvent } from '../../api/types';
import { useRes } from './common';

const isHdfs = (e: ApiEvent) => e.type === 'hdfs';
const onPath = (dir: string, path: string) => dir === '/' || path === dir || path.startsWith(dir + '/');

function Node({ dir, name, depth, path, onOpen }: { dir: string; name: string; depth: number; path: string; onOpen: (p: string) => void }) {
  const [open, setOpen] = useState(onPath(dir, path));
  // Si navegás a una carpeta de adentro (desde la tabla o las migas), se abre el camino
  useEffect(() => { if (onPath(dir, path)) setOpen(true); }, [dir, path]);
  const ls = useRes(a => (open ? a.hdfsList(dir) : null), [dir, open], isHdfs);
  const subs = (ls.data?.entries ?? []).filter(e => e.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const leaf = ls.data && !subs.length;
  const current = dir === path;
  return (
    <li role="treeitem" aria-expanded={leaf ? undefined : open} aria-selected={current}>
      <div className="hd-tn" data-current={current || undefined} style={{ paddingLeft: 6 + depth * 14 }}>
        <button type="button" className="hd-tn-x" aria-label={open ? `Cerrar ${name}` : `Abrir ${name}`} onClick={() => setOpen(o => !o)} data-hidden={leaf || undefined} tabIndex={leaf ? -1 : 0}>
          <ChevronRight size={12} data-open={open || undefined} />
        </button>
        <button type="button" className="hd-tn-n" onClick={() => { onOpen(dir); setOpen(true); }} title={dir}>
          {open && !leaf ? <FolderOpen size={14} /> : <Folder size={14} />}<span>{name}</span>
        </button>
      </div>
      {open && subs.length > 0 && (
        <ul role="group">
          {subs.map(s => <Node key={s.path} dir={s.path} name={s.name} depth={depth + 1} path={path} onOpen={onOpen} />)}
        </ul>
      )}
    </li>
  );
}

export function FolderTree({ path, onOpen }: { path: string; onOpen: (p: string) => void }) {
  return (
    <nav className="hd-tree" aria-label="Carpetas">
      <ul role="tree" aria-label="Carpetas de HDFS">
        <Node dir="/" name="/" depth={0} path={path} onOpen={onOpen} />
      </ul>
    </nav>
  );
}
