/* Detalle de un archivo de HDFS, al costado del explorador: qué es, sus acciones y el mapa de
   bloques (en qué DataNode está cada copia), con la salida de fsck a mano. */
import { useEffect, useState } from 'react';
import { Copy, Download, Eye, MoveRight, Trash2, X } from 'lucide-react';
import type { DataNode, HdfsFileDetail } from '../../api/types';
import { KeyValue, SkeletonLines, useBlock } from '../../components/base';
import { Dot, Tip } from '../../components/ui';
import { hdfsDelete } from '../../state/actions';
import { onTransfer } from '../../state/store';
import { clock, nf, sizeLabel } from '../../lib/format';
import { FILE_STATE } from './Explorer';
import { ErrorLine, type Res } from './common';
import { downloadFile } from './Dialogs';

const DN_STATE: Record<DataNode['state'], string> = { live: 'vivo', stale: 'sin latidos', dead: 'muerto', starting: 'arrancando', off: 'apagado' };

/** Bloques que acaban de recibir una copia (para marcar la celda un momento) */
function useFresh() {
  const [fresh, setFresh] = useState<Record<string, number>>({});
  useEffect(() => onTransfer(t => {
    const k = `${t.block}:${t.to}`;
    setFresh(f => ({ ...f, [k]: Date.now() }));
    setTimeout(() => setFresh(f => { const { [k]: _, ...rest } = f; return rest; }), 2500);
  }), []);
  return fresh;
}

export function BlockMap({ file, dataNodes }: { file: HdfsFileDetail; dataNodes: DataNode[] }) {
  const fresh = useFresh();
  const ids = [...new Set([...dataNodes.map(d => d.id), ...file.blocks.flatMap(b => [...b.locations, ...b.stale])])].sort((a, b) => a - b);
  const dn = (id: number) => dataNodes.find(d => d.id === id);
  return (
    <div className="tbl-wrap">
      <table className="tbl bm" aria-label="Mapa de bloques">
        <thead>
          <tr>
            <th className="r">#</th><th>Bloque</th><th className="r">Tamaño</th>
            {ids.map(id => <th key={id} className="bm-dn"><span><Dot s={dn(id)?.state ?? 'off'} label={DN_STATE[dn(id)?.state ?? 'off']} />DN {id}</span></th>)}
            <th className="r">Copias</th>
          </tr>
        </thead>
        <tbody>
          {file.blocks.map(b => {
            const n = b.locations.length;
            const k = !n ? 'bad' : n < file.replication ? 'run' : 'ok';
            return (
              <tr key={b.id}>
                <td className="r muted">{b.index}</td>
                <td className="mono">{b.name}</td>
                <td className="r">{sizeLabel(b.sizeMb)}</td>
                {ids.map(id => {
                  const live = b.locations.includes(id), ghost = b.stale.includes(id), isNew = fresh[`${b.id}:${id}`] != null;
                  const tip = live ? `Copia en el DataNode ${id}${isNew ? ' (recién copiada)' : ''}` : ghost ? `La copia quedó en el DataNode ${id}, que está ${DN_STATE[dn(id)?.state ?? 'dead']}` : `El DataNode ${id} no tiene este bloque`;
                  return (
                    <td key={id} className="bm-cell">
                      <Tip content={tip}><span className="bm-c" data-s={live ? 'live' : ghost ? 'ghost' : 'none'} data-new={isNew || undefined} aria-label={tip} /></Tip>
                    </td>
                  );
                })}
                <td className="r"><span className="badge" data-k={k}>{n} / {file.replication}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FileDetail({ path, res, dataNodes, onClose, onView, onMove, onReplica }: {
  path: string; res: Res<HdfsFileDetail>; dataNodes: DataNode[]; onClose: () => void;
  onView: () => void; onMove: () => void; onReplica: (f: HdfsFileDetail) => void;
}) {
  const f = res.data;
  const write = useBlock('hdfs.write');
  const writing = f?.state === 'writing';
  const copies = f ? f.blocks.reduce((s, b) => s + b.locations.length, 0) : 0;
  return (
    <section className="panel hd-detail" aria-label={`Archivo ${path}`}>
      <div className="panel-h">
        <h2 className="mono hd-ell" title={path}>{path.split('/').pop()}</h2>
        {f && <span className="badge" data-k={FILE_STATE[f.state][0]}>{FILE_STATE[f.state][1]}</span>}
        <span className="end"><button className="btn btn-sm btn-ghost btn-icon" type="button" onClick={onClose} aria-label="Cerrar el detalle"><X size={14} /></button></span>
      </div>
      <div className="panel-b hd-detail-b">
        {res.err ? <ErrorLine err={res.err} onRetry={res.err.code === 'not_found' ? onClose : res.reload} /> : !f ? <SkeletonLines n={8} /> : (
          <>
            <div className="hd-detail-acts">
              <button type="button" className="btn btn-sm" onClick={onView}><Eye size={13} />Ver</button>
              <button type="button" className="btn btn-sm" onClick={() => downloadFile(path)} disabled={writing}><Download size={13} />Bajar</button>
              <Tip content={write?.reason}><button type="button" className="btn btn-sm" aria-disabled={write || writing ? 'true' : undefined} onClick={() => !write && !writing && onReplica(f)}><Copy size={13} />Réplica {f.replication}</button></Tip>
              <Tip content={write?.reason}><button type="button" className="btn btn-sm" aria-disabled={write ? 'true' : undefined} onClick={() => !write && onMove()}><MoveRight size={13} />Mover</button></Tip>
              <Tip content={write?.reason ?? 'hdfs dfs -rm -skipTrash'}><button type="button" className="btn btn-sm btn-ghost hd-danger" aria-label="Borrar" aria-disabled={write ? 'true' : undefined} onClick={async () => { if (!write && await hdfsDelete(path, false)) onClose(); }}><Trash2 size={13} /></button></Tip>
            </div>
            <KeyValue items={[
              ['Ruta', <span className="mono hd-break">{path}</span>],
              ['Tamaño', sizeLabel(f.sizeMb)],
              ['Bloques', `${f.blocks.length} de hasta ${nf(f.blockSizeMb)} MB`],
              ['Copias', `${nf(copies)} de ${nf(f.blocks.length * f.replication)} (réplica ${f.replication})`],
              ['Lo escribió', f.writtenBy],
              ['Modificado', clock(f.modifiedAt)],
              ['Permisos', <span className="mono">-{f.permission} {f.owner}</span>],
            ]} />
            <div className="hd-sub-h">
              <h3>Bloques en los DataNodes</h3>
              <span className="ops-legend"><i className="bm-c" data-s="live" />copia <i className="bm-c" data-s="ghost" />en nodo caído <i className="bm-c" data-s="none" />no está</span>
            </div>
            <BlockMap file={f} dataNodes={dataNodes} />
            <details className="hd-fsck">
              <summary>fsck de este archivo</summary>
              <pre className="log ops-log" aria-label="Salida de fsck">{f.fsck.join('\n')}</pre>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
