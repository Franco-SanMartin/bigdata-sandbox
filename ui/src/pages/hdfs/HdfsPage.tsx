/* HDFS: explorador con árbol de carpetas y detalle de cada archivo; la salud (re-replicación y fsck)
   y los DataNodes van en pestañas aparte. */
import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { ApiEvent, HdfsEntry, HdfsFile, HdfsFileDetail } from '../../api/types';
import { GatedButton, PageGate, PageHeader, Stat, StatRow, type Tone } from '../../components/base';
import { useCapability } from '../../state/capabilities';
import { useSnapshot } from '../../state/store';
import { navigate, useRouteArg } from '../../state/ui';
import { mbLabel, nf } from '../../lib/format';
import { cleanPath } from '../../lib/jobs';
import { useRes } from './common';
import { DataNodes } from './DataNodes';
import { MoveDialog, ReplicaDialog, UploadDialog, Viewer } from './Dialogs';
import { Explorer } from './Explorer';
import { FileDetail } from './FileDetail';
import { Fsck } from './Fsck';
import { Replication } from './Replication';
import { FolderTree } from './Tree';
import './ops.css';
import './hdfs.css';

const isHdfs = (e: ApiEvent) => e.type === 'hdfs' || e.type === 'transfer';
const SUB = 'Sistema de archivos distribuido: los archivos se parten en bloques y cada bloque se copia en varios DataNodes.';
type TabId = 'files' | 'health' | 'nodes';

/** Dónde arrancar: la carpeta con el archivo más reciente (sin contar lo que deja el arranque) */
function startDir(files: HdfsFile[]): string {
  const mine = files.filter(f => !/^\/(apps|spark-logs|tmp)(\/|$)/.test(f.path) && !f.path.startsWith('/user/hive/'));
  if (!mine.length) return '/user/root';
  const last = mine.reduce((a, b) => (b.modifiedAt > a.modifiedAt ? b : a));
  return last.path.slice(0, last.path.lastIndexOf('/')) || '/';
}

export function HdfsPage() {
  const ready = useCapability('hdfs.read').state === 'ready';
  if (ready) return <Hdfs />;
  return (
    <div className="page-in hd">
      <PageHeader title="HDFS" sub={SUB} />
      <PageGate cap="hdfs.read" title="HDFS" can={['Subir archivos (ejemplos o de tu compu) y ver cómo se parten en bloques', 'Ver, bajar, mover y borrar lo que dejan los trabajos', 'Apagar un DataNode y mirar cómo HDFS re-replica las copias']}>{null}</PageGate>
    </div>
  );
}

function Hdfs() {
  const { status, dataNodes, files } = useSnapshot();
  const arg = useRouteArg();
  const start = useRef<string | null>(null);
  if (start.current == null) start.current = startDir(files);
  const path = arg ? cleanPath('/' + arg) : start.current;
  const setPath = (p: string) => { setSel(null); navigate('hdfs', cleanPath(p).slice(1)); };

  const [tab, setTab] = useState<TabId>('files');
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [move, setMove] = useState<string | null>(null);
  const [rep, setRep] = useState<{ path: string; replication: number; blocks: number } | null>(null);
  const [up, setUp] = useState<{ file: File | null } | null>(null);
  useEffect(() => setSel(null), [path]);

  // Cuando un DataNode cambia de estado cambian las ubicaciones, sin evento hdfs: se vuelve a pedir
  const dnKey = dataNodes.map(d => d.id + d.state).join(',');
  const ls = useRes(a => a.hdfsList(path), [path, dnKey], isHdfs);
  const file = useRes(a => (sel ? a.hdfsFile(sel) : null), [sel, dnKey], isHdfs);
  const repl = useRes(a => (tab === 'health' ? a.replication() : null), [tab, dnKey], isHdfs, tab === 'health' ? 1500 : undefined);

  const h = status?.hdfs;
  const c = status?.config;
  const live = dataNodes.filter(d => d.state === 'live').length;
  const issues = (h?.underReplicated ?? 0) + (h?.missing ?? 0);
  const chip: { k: Tone; label: string } = !h ? { k: 'off', label: 'sin datos' }
    : !h.available ? { k: 'bad', label: 'NameNode no responde' }
    : h.safeMode ? { k: 'run', label: 'safe mode' }
    : h.missing ? { k: 'bad', label: `${nf(h.missing)} bloques perdidos` }
    : h.underReplicated ? { k: 'run', label: 're-replicando' }
    : { k: 'ok', label: 'sano' };

  const refresh = () => { ls.reload(); file.reload(); };
  const openReplica = (e: HdfsEntry | HdfsFileDetail) => setRep({ path: e.path, replication: e.replication ?? 1, blocks: typeof e.blocks === 'number' ? e.blocks : e.blocks?.length ?? 0 });

  return (
    <div className="page-in hd ops">
      <PageHeader title="HDFS" status={chip}
        sub={h && c ? `${live} de ${dataNodes.length} DataNodes vivos · réplica ${c.replication} · bloques de ${c.blockSize.toUpperCase().replace(/(\d)([KMG])$/, '$1 $2')}B · ${nf(h.files)} archivos` : SUB}
        help={<>HDFS guarda cada archivo partido en bloques (128 MB por defecto) y cada bloque en <b>réplica</b> DataNodes distintos. El NameNode sabe dónde está cada copia; si un DataNode se cae, copia lo que faltó en otros.</>}
        actions={<GatedButton cap="hdfs.write" className="btn btn-primary" onClick={() => { setTab('files'); setUp({ file: null }); }}><Upload size={15} />Subir</GatedButton>}
        tabs={[{ id: 'files', label: 'Archivos' }, { id: 'health', label: 'Salud', count: issues, countKind: h?.missing ? 'bad' : 'run' }, { id: 'nodes', label: 'DataNodes', count: dataNodes.length - live, countKind: 'bad' }]}
        tab={tab} onTab={setTab} />

      {h && tab === 'health' && (
        <StatRow label="Resumen de HDFS">
          <Stat label="DataNodes vivos" value={live} unit={`/ ${dataNodes.length}`} k={h.deadDataNodes ? 'bad' : h.staleDataNodes ? 'run' : undefined} sub={h.deadDataNodes ? `${h.deadDataNodes} muerto${h.deadDataNodes > 1 ? 's' : ''}` : h.staleDataNodes ? `${h.staleDataNodes} sin latidos` : 'todos con latido'} />
          <Stat label="Archivos" value={nf(h.files)} sub={`${nf(h.blocks)} bloques`} />
          <Stat label="Ocupado" value={mbLabel(h.usedMb)} sub={`${nf(h.replicas)} copias`} />
          <Stat label="Sub-replicados" value={nf(h.underReplicated)} k={h.underReplicated ? 'run' : undefined} sub={h.underReplicated ? 'el NameNode los copia' : 'ninguno'} />
          <Stat label="Perdidos" value={nf(h.missing)} k={h.missing ? 'bad' : undefined} sub={h.missing ? 'sin ninguna copia viva' : 'ninguno'} />
        </StatRow>
      )}

      {tab === 'files' && (
        <div className="hd-split" data-detail={sel ? 'on' : undefined}>
          <FolderTree path={path} onOpen={setPath} />
          <Explorer path={path} setPath={setPath} ls={ls} sel={sel} setSel={setSel} compact={!!sel}
            act={{ view: setView, move: setMove, replica: openReplica, upload: f => setUp({ file: f ?? null }) }} />
          {sel && <FileDetail key={sel} path={sel} res={file} dataNodes={dataNodes} onClose={() => setSel(null)}
            onView={() => setView(sel)} onMove={() => setMove(sel)} onReplica={openReplica} />}
        </div>
      )}
      {tab === 'health' && (
        <div className="grid cols-12">
          <Replication res={repl} files={files} now={status?.now ?? 0} />
          <Fsck defaultPath={path} />
        </div>
      )}
      {tab === 'nodes' && status && <div className="grid cols-12 hd-nodes"><DataNodes status={status} nodes={dataNodes} /></div>}

      <Viewer path={view} onClose={() => setView(null)} />
      <MoveDialog path={move} onClose={() => setMove(null)} onMoved={to => {
        // Si lo movido es lo elegido (o lo contiene), la selección sigue a la ruta nueva; el detalle
        // se pide solo al cambiar sel: recargarlo acá pediría la ruta vieja, que ya no existe
        if (sel && move && (sel === move || sel.startsWith(move + '/'))) { setSel(to + sel.slice(move.length)); ls.reload(); }
        else refresh();
      }} />
      <ReplicaDialog file={rep} live={live} onClose={() => setRep(null)} onDone={refresh} />
      <UploadDialog open={!!up} initialFile={up?.file ?? null} dest={path} defRep={c?.replication ?? 1} defBlock={c?.blockSize ?? '128m'} onClose={() => setUp(null)} onDone={refresh} />
    </div>
  );
}
