/* Un archivo de HDFS: mapa de bloques (cada bloque con sus réplicas por DataNode), primeras líneas, fsck y factor de replicación. */
import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { api } from '../../api';
import type { DataNode, HdfsFileDetail } from '../../api/types';
import { SampleTable } from '../../components/Trace';
import { Dot, Seg, Stepper, Tip } from '../../components/ui';
import { hdfsDelete } from '../../state/actions';
import { onTransfer } from '../../state/store';
import { confirm, toast } from '../../state/ui';
import { clock, nf, sizeLabel } from '../../lib/format';
import { FILE_STATE } from './Explorer';
import { ErrorLine, Loading, type Res } from './common';

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

function Preview({ file }: { file: HdfsFileDetail }) {
  const p = file.preview;
  if (!p.rows.length && p.note) return <div className="callout"><span><b>{p.format ?? 'Sin vista previa'}.</b> {p.note}</span></div>;
  return <SampleTable sample={p} label="Primeras líneas" />;
}

export function FileDetail({ path, res, dataNodes, onClose }: { path: string; res: Res<HdfsFileDetail>; dataNodes: DataNode[]; onClose: () => void }) {
  const f = res.data;
  const [tab, setTab] = useState<'preview' | 'fsck'>('preview');
  const [rep, setRep] = useState(1);
  useEffect(() => { if (f) setRep(f.replication); }, [f?.path, f?.replication]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = dataNodes.filter(d => d.state === 'live').length;

  const applyRep = async () => {
    if (!f || rep === f.replication) return;
    if (rep < f.replication) {
      const ok = await confirm({ title: `Bajar la réplica de ${path.split('/').pop()}`, confirmLabel: 'Bajar', danger: true,
        description: 'El NameNode borra las copias que sobran de los DataNodes más llenos.',
        facts: [['Comando', `hdfs dfs -setrep ${rep} ${path}`], ['Copias', `${f.blocks.length * f.replication} → ${f.blocks.length * rep}`]] });
      if (!ok) return;
    }
    try { await api().setReplication(path, rep); toast({ kind: 'run', title: `Réplica ${f.replication} → ${rep}`, description: rep > live ? `Hay ${live} DataNodes vivos: van a quedar bloques con copias de menos` : path }); res.reload(); }
    catch (e) { toast({ kind: 'bad', title: 'No se pudo', description: e instanceof Error ? e.message : String(e) }); }
  };

  return (
    <section className="panel span-12" aria-label="Archivo">
      <div className="panel-h">
        <h2 className="mono">{path.split('/').pop()}</h2>
        {f && <span className="sub">{sizeLabel(f.sizeMb)} · {f.blocks.length} bloque{f.blocks.length !== 1 ? 's' : ''} de {nf(f.blockSizeMb)} MB · {f.writtenBy} · {clock(f.modifiedAt)}</span>}
        {f && <span className="badge" data-k={FILE_STATE[f.state][0]}>{FILE_STATE[f.state][1]}</span>}
        <span className="end">
          {f && <>
            <span className="ops-lbl">réplica</span>
            <Stepper value={rep} onChange={setRep} min={1} max={9} label="réplica" />
            <button className="btn btn-sm" type="button" disabled={rep === f.replication || f.state === 'writing'} onClick={applyRep}>setrep</button>
            <button className="btn btn-sm btn-danger" type="button" onClick={async () => { if (await hdfsDelete(path, false)) onClose(); }}><Trash2 size={13} />Borrar</button>
          </>}
          <button className="btn btn-sm btn-ghost btn-icon" type="button" onClick={onClose} aria-label="Cerrar el archivo"><X size={13} /></button>
        </span>
      </div>
      <div className="panel-b">
        {res.err ? <ErrorLine err={res.err} onRetry={res.err.code === 'not_found' ? onClose : res.reload} /> : !f ? <Loading /> : (
          <div className="ops-file-grid">
            <div className="ops-col">
              <div className="ops-sub-h"><h3>Mapa de bloques</h3><span className="muted mono">{path}</span>
                <span className="ops-legend"><i className="bm-c" data-s="live" />copia <i className="bm-c" data-s="ghost" />en nodo caído <i className="bm-c" data-s="none" />sin copia</span>
              </div>
              <BlockMap file={f} dataNodes={dataNodes} />
            </div>
            <div className="ops-col">
              <div className="ops-sub-h">
                <Seg value={tab} onChange={setTab} label="Vista" options={[{ value: 'preview', label: 'Primeras líneas' }, { value: 'fsck', label: 'fsck del archivo' }]} />
                <span className="muted mono ops-ell">{f.owner} · -{f.permission}</span>
              </div>
              {tab === 'preview' ? <Preview file={f} /> : <pre className="log ops-log" aria-label="Salida de fsck">{f.fsck.join('\n')}</pre>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
