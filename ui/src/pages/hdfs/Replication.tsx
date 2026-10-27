/* Cola de re-replicación en vivo: lo que el NameNode copia (o borra de más) cuando cambia un DataNode o la réplica. */
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Copy, HeartPulse, ServerOff, Trash2 } from 'lucide-react';
import type { HdfsFile, ReplicationState, ReplicationTask } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { Dot, Sparkline } from '../../components/ui';
import { ago } from '../../lib/format';
import { replicationView } from '../../lib/replicacion';
import { ErrorLine, Loading, type Res } from './common';

const TASK: Record<ReplicationTask['state'], string> = { pending: 'en cola', running: 'copiando', done: 'hecha' };
const dnl = (x: number | 'client' | undefined) => (x === 'client' ? 'cliente' : x == null ? '—' : `DN ${x}`);

/** Lo que pendiente tuvo la cola en los últimos minutos, para ver cómo baja */
function useHistory(r: ReplicationState | undefined, now: number) {
  const [h, setH] = useState<{ t: number; v: number }[]>([]);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!r) return;
    const v = r.underReplicated + r.missing + r.overReplicated;
    if (last.current === v && h.length && now - h[h.length - 1].t < 5000) return;
    last.current = v;
    setH(x => [...x, { t: now, v }].slice(-90));
  }, [r, now]); // eslint-disable-line react-hooks/exhaustive-deps
  return h;
}

export function Replication({ res, files, now, under }: { res: Res<ReplicationState>; files: HdfsFile[]; now: number; under?: number }) {
  // El mismo número de sub-replicados que la tarjeta del resumen (ver replicationView)
  const r = res.data && under != null && under > res.data.underReplicated ? { ...res.data, underReplicated: under } : res.data;
  const hist = useHistory(r, now);
  const peak = Math.max(1, ...hist.map(x => x.v));
  const blockName = (id: number) => files.flatMap(f => f.blocks).find(b => b.id === id)?.name ?? `blk_${id}`;
  const v = r ? replicationView(r) : undefined;

  const cols: Column<ReplicationTask>[] = [
    { id: 's', header: '', width: 28, cell: t => <Dot s={t.state === 'running' ? 'running' : t.state === 'done' ? 'done' : 'pending'} label={TASK[t.state]} /> },
    { id: 'kind', header: 'Tarea', cell: t => <span className="ops-name">{t.kind === 'copy' ? <Copy size={13} /> : <Trash2 size={13} />}{t.kind === 'copy' ? 'copiar' : 'borrar copia'}</span> },
    { id: 'block', header: 'Bloque', cell: t => <span className="mono">{t.block}</span> },
    { id: 'file', header: 'Archivo', cell: t => <span className="mono muted">{t.file}</span> },
    { id: 'move', header: 'De → a', cell: t => <span className="ops-name mono">{dnl(t.from)}<ArrowRight size={12} className="dim" />{t.kind === 'delete' ? 'baja' : t.to != null ? dnl(t.to) : <span className="muted">a elegir</span>}</span> },
    { id: 'state', header: 'Estado', cell: t => <span className="muted">{TASK[t.state]}</span> },
  ];

  return (
    <section className="panel span-12" aria-label="Re-replicación">
      <div className="panel-h">
        <h2>Re-replicación</h2>
        <span className="sub">cola del NameNode · en vivo</span>
        {v && <span className="badge" data-k={v.k}>{v.label}</span>}
        <span className="end">{hist.length > 1 && <Sparkline data={hist} max={peak} width={140} height={24} />}</span>
      </div>
      {res.err ? <div className="panel-b"><ErrorLine err={res.err} onRetry={res.reload} /></div> : !r ? <div className="panel-b"><Loading /></div> : (
        <div className="ops-repl">
          <div className="ops-repl-main">
            <div className="ops-mini">
              <div data-k={r.underReplicated ? 'run' : undefined}><span>sub-replicados</span><b>{r.underReplicated}</b></div>
              <div data-k={r.pending ? 'run' : undefined}><span>en la cola</span><b>{r.pending}</b></div>
              <div data-k={r.missing ? 'bad' : undefined}><span>perdidos</span><b>{r.missing}</b></div>
              <div><span>copias de más</span><b>{r.overReplicated}</b></div>
            </div>
            {v?.note && (
              <div className="callout" data-k="run"><ServerOff size={14} aria-hidden="true" /><span>{v.note}</span></div>
            )}
            {r.stale.map(s => (
              <div key={s.dataNode} className="callout" data-k="run"><HeartPulse size={14} />
                <span><b>DataNode {s.dataNode} sin latidos.</b> El NameNode lo da por muerto en <span className="num">{s.deadInSec} s</span> y recién ahí encola sus bloques.</span>
              </div>
            ))}
            <DataTable label="Cola de re-replicación" columns={cols} rows={r.tasks} rowKey={t => `${t.block}-${t.kind}-${t.from}-${t.to}-${r.tasks.indexOf(t)}`}
              empty={v?.empty ?? ''} />
          </div>
          <div className="ops-repl-side">
            <div className="ops-sub-h"><h3>Copias recientes</h3><span className="muted">{r.recent.length}</span></div>
            {r.recent.length ? (
              <ol className="ops-feed" aria-label="Copias recientes">
                {r.recent.slice(0, 14).map((x, i) => (
                  <li key={`${x.at}-${x.block}-${x.to}-${i}`}>
                    <span className="mono">{blockName(x.block)}</span>
                    <span className="ops-name mono">{dnl(x.from)}<ArrowRight size={11} className="dim" />{dnl(x.to)}</span>
                    <span className="muted">{ago(now, x.at)}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="muted ops-pad">Todavía no se copió ningún bloque.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
