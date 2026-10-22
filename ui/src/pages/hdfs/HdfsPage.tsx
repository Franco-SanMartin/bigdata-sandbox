/* HDFS: explorador de carpetas, detalle de un archivo con sus bloques, fsck y re-replicación. Esqueleto. */
import { useState } from 'react';
import { ChevronRight, File, Folder, ShieldCheck, Upload } from 'lucide-react';
import type { HdfsEntry } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { SampleTable, Slot } from '../../components/Trace';
import { Empty } from '../../components/ui';
import { HELP } from '../../help/content';
import { putExample } from '../../state/actions';
import { useStatus } from '../../state/store';
import { useApi } from '../../state/useApi';
import { clock, nf, sizeLabel } from '../../lib/format';

const STATE: Record<NonNullable<HdfsEntry['state']>, [string, string]> = {
  ok: ['ok', 'Sano'], writing: ['run', 'Escribiendo'], under: ['run', 'Faltan copias'], missing: ['bad', 'Sin copias'],
};

export function HdfsPage() {
  const status = useStatus();
  const up = status?.phase === 'running';
  const [path, setPath] = useState('/user/root');
  const [sel, setSel] = useState<string | null>(null);
  const isHdfs = (e: { type: string }) => e.type === 'hdfs' || e.type === 'transfer';
  const ls = useApi(a => (up ? a.hdfsList(path) : Promise.resolve(null)), [path, up], isHdfs);
  const file = useApi(a => (up && sel ? a.hdfsFile(sel) : Promise.resolve(null)), [sel, up], isHdfs);
  const fsck = useApi(a => (up ? a.fsck('/') : Promise.resolve(null)), [up], isHdfs);

  const crumbs = path.split('/').filter(Boolean);
  const cols: Column<HdfsEntry>[] = [
    { id: 'name', header: 'Nombre', sort: r => (r.type === 'dir' ? '0' : '1') + r.name, cell: r => <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>{r.type === 'dir' ? <Folder size={14} /> : <File size={14} />}{r.name}</span> },
    { id: 'size', header: 'Tamaño', align: 'right', sort: r => r.sizeMb ?? -1, cell: r => (r.type === 'dir' ? <span className="muted">{r.children} adentro</span> : sizeLabel(r.sizeMb ?? 0)) },
    { id: 'rep', header: 'Réplicas', align: 'right', cell: r => r.replication ?? '—' },
    { id: 'blocks', header: 'Bloques', align: 'right', cell: r => r.blocks ?? '—' },
    { id: 'state', header: 'Estado', cell: r => (r.state ? <span className="badge" data-k={STATE[r.state][0]}>{STATE[r.state][1]}</span> : null) },
    { id: 'perm', header: 'Permisos', cell: r => <span className="mono muted">{r.permission}</span> },
    { id: 'mod', header: 'Modificado', sort: r => r.modifiedAt, cell: r => <span className="muted">{clock(r.modifiedAt)}</span> },
  ];

  return (
    <div className="page-in">
      <div className="page-head">
        <div><h1>HDFS</h1><p>{HELP.hdfs.intro}</p></div>
        <div className="page-actions">
          <button className="btn" type="button" disabled={!up} onClick={() => putExample('sucias')}><Upload size={14} />Subir ventas_sucias</button>
        </div>
      </div>
      {!up ? (
        <section className="panel"><Empty icon={<Folder size={20} />} title="El cluster está apagado">Prendelo desde Cluster para ver qué hay en HDFS.</Empty></section>
      ) : (
        <div className="grid cols-12">
          <section className="panel span-8">
            <div className="panel-h">
              <h2>Explorador</h2>
              <nav aria-label="Ruta" className="sub" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => setPath('/')}>/</button>
                {crumbs.map((c, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {i > 0 && <ChevronRight size={12} />}
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</button>
                  </span>
                ))}
              </nav>
            </div>
            <div className="panel-b flush">
              <DataTable label="Contenido de la carpeta" columns={cols} rows={ls.data?.entries ?? []} rowKey={r => r.path} selected={sel}
                onRowClick={r => (r.type === 'dir' ? setPath(r.path) : setSel(r.path))}
                empty={ls.error ? <span>{ls.error}</span> : 'Carpeta vacía'} initialSort={{ id: 'name', dir: 1 }} />
            </div>
          </section>
          <section className="panel span-4">
            <div className="panel-h"><h2>Salud</h2><span className="sub">hdfs fsck /</span><span className="end"><ShieldCheck size={14} /></span></div>
            <div className="panel-b">
              {fsck.data ? (
                <dl className="kv">
                  <dt>Estado</dt><dd><span className="badge" data-k={fsck.data.healthy ? 'ok' : 'bad'}>{fsck.data.healthy ? 'HEALTHY' : 'CORRUPT'}</span></dd>
                  <dt>Archivos</dt><dd>{fsck.data.files} en {fsck.data.dirs} carpetas</dd>
                  <dt>Bloques</dt><dd>{fsck.data.blocks}</dd>
                  <dt>Con copias de menos</dt><dd>{fsck.data.underReplicated}</dd>
                  <dt>Perdidos</dt><dd>{fsck.data.missing}</dd>
                  <dt>Réplicas promedio</dt><dd>{nf(fsck.data.avgReplication, 2)} de {fsck.data.defaultReplication}</dd>
                </dl>
              ) : <span className="muted">Revisando…</span>}
            </div>
          </section>
          <section className="panel span-12">
            <div className="panel-h"><h2>{sel ? sel.split('/').pop() : 'Archivo'}</h2>{file.data && <span className="sub">{sizeLabel(file.data.sizeMb)} · {file.data.blocks.length} bloques · escrito por {file.data.writtenBy}</span>}</div>
            <div className="panel-b">
              {file.data ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <SampleTable sample={file.data.preview} label="Primeras líneas" />
                  <Slot title="Acá va el mapa de bloques:">cada bloque con sus réplicas por DataNode (hdfsFile().blocks) y la salida de fsck del archivo (hdfsFile().fsck).</Slot>
                </div>
              ) : <span className="muted">Elegí un archivo del explorador para ver sus bloques y sus primeras líneas.</span>}
            </div>
          </section>
          <section className="panel span-12">
            <div className="panel-h"><h2>Re-replicación</h2><span className="sub">lo que el NameNode copia cuando se cae un DataNode</span></div>
            <div className="panel-b"><Slot title="Acá va la cola de re-replicación:">bloques con copias de menos, DataNodes sin latido y copias recientes (replication()), en vivo con el evento transfer.</Slot></div>
          </section>
        </div>
      )}
    </div>
  );
}
