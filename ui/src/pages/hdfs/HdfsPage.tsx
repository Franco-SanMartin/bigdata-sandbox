/* HDFS: explorador, mapa de bloques de cada archivo, DataNodes, cola de re-replicación en vivo y fsck. */
import { useState } from 'react';
import { Folder } from 'lucide-react';
import type { ApiEvent } from '../../api/types';
import { useSnapshot } from '../../state/store';
import { mbLabel, nf } from '../../lib/format';
import { ClusterGate, Stat, useRes } from './common';
import { DataNodes } from './DataNodes';
import { Explorer } from './Explorer';
import { FileDetail } from './FileDetail';
import { Fsck } from './Fsck';
import { Replication } from './Replication';
import './ops.css';

const isHdfs = (e: ApiEvent) => e.type === 'hdfs' || e.type === 'transfer';

export function HdfsPage() {
  const { status, dataNodes, files } = useSnapshot();
  const up = status?.phase === 'running';
  const [path, setPath] = useState('/user/root');
  const [sel, setSel] = useState<string | null>(null);
  // Cuando un DataNode cambia de estado cambian las ubicaciones, sin evento hdfs: se vuelve a pedir
  const dnKey = dataNodes.map(d => d.id + d.state).join(',');
  const ls = useRes(a => (up ? a.hdfsList(path) : null), [path, up, dnKey], isHdfs);
  const file = useRes(a => (up && sel ? a.hdfsFile(sel) : null), [sel, up, dnKey], isHdfs);
  const repl = useRes(a => (up ? a.replication() : null), [up, dnKey], isHdfs, 1500);
  const h = status?.hdfs;
  const c = status?.config;

  return (
    <div className="page-in ops">
      <div className="page-head">
        <div>
          <h1>HDFS</h1>
          <p>{h && c && up ? `${h.liveDataNodes} DataNodes vivos · réplica ${c.replication} · bloque ${c.blockSize.toUpperCase()}B · ${nf(h.files)} archivos en ${nf(h.blocks)} bloques` : 'Sistema de archivos distribuido: NameNode y DataNodes'}</p>
        </div>
      </div>
      <ClusterGate status={status} icon={<Folder size={20} />} what="Lo que hay en HDFS">
        {h && (
          <div className="stats">
            <Stat label="DataNodes vivos" value={<>{h.liveDataNodes}<small>/ {dataNodes.length}</small></>} sub={h.deadDataNodes ? `${h.deadDataNodes} muerto${h.deadDataNodes > 1 ? 's' : ''}` : h.staleDataNodes ? `${h.staleDataNodes} sin latidos` : 'todos con latido'} k={h.deadDataNodes ? 'bad' : h.staleDataNodes ? 'run' : undefined} />
            <Stat label="Archivos" value={nf(h.files)} sub={`${mbLabel(h.usedMb)} con las copias`} />
            <Stat label="Bloques" value={nf(h.blocks)} sub={`${nf(h.replicas)} copias`} />
            <Stat label="Sub-replicados" value={nf(h.underReplicated)} sub={repl.data?.pending ? `${repl.data.pending} en la cola` : 'cola vacía'} k={h.underReplicated ? 'run' : undefined} />
            <Stat label="Perdidos" value={nf(h.missing)} sub={h.missing ? 'sin ninguna copia viva' : 'ninguno'} k={h.missing ? 'bad' : undefined} />
            <Stat label="NameNode" value={h.available ? (h.safeMode ? 'safe mode' : 'activo') : 'no responde'} sub={c && c.namenodes > 1 ? `HA con ${c.namenodes}` : 'uno solo'} k={!h.available ? 'bad' : h.safeMode ? 'run' : undefined} />
          </div>
        )}
        <div className="grid cols-12">
          <Explorer path={path} setPath={p => setPath(p)} ls={ls} sel={sel} setSel={setSel} defRep={c?.replication ?? 1} defBlock={c?.blockSize ?? '128m'} />
          {status && <DataNodes status={status} nodes={dataNodes} />}
          {sel && <FileDetail key={sel} path={sel} res={file} dataNodes={dataNodes} onClose={() => setSel(null)} />}
          <Replication res={repl} files={files} now={status?.now ?? 0} />
          <Fsck defaultPath={path} />
        </div>
      </ClusterGate>
    </div>
  );
}
