/* DataNodes: estado, latido, bloques y espacio de cada uno, con apagar y prender para ver la re-replicación. */
import { Plus, Power } from 'lucide-react';
import type { ClusterStatus, DataNode } from '../../api/types';
import { Dot, Meter, Tip } from '../../components/ui';
import { addDataNode, processAction } from '../../state/actions';
import { ago, sizeLabel } from '../../lib/format';

const STATE: Record<DataNode['state'], string> = { live: 'vivo', stale: 'sin latidos', dead: 'muerto', starting: 'arrancando', off: 'apagado' };

export function DataNodes({ status, nodes }: { status: ClusterStatus; nodes: DataNode[] }) {
  const max = Math.max(1, ...nodes.map(d => d.usedMb));
  const live = nodes.filter(d => d.state === 'live').length;
  return (
    <section className="panel span-4" aria-label="DataNodes">
      <div className="panel-h">
        <h2>DataNodes</h2><span className="sub">{live} de {nodes.length} vivos</span>
        <span className="end">
          <Tip content={nodes.length >= 9 ? 'Ya hay 9, el máximo' : 'datanode start N: se suma vacío, en caliente'}>
            <span><button className="btn btn-sm" type="button" disabled={nodes.length >= 9} onClick={addDataNode}><Plus size={13} />Sumar</button></span>
          </Tip>
        </span>
      </div>
      <div className="panel-b flush">
        <ul className="ops-dns">
          {nodes.map(d => {
            const p = status.processes.find(x => x.id === `dn${d.id}`);
            const up = d.state === 'live' || d.state === 'starting';
            const beat = d.state === 'stale' && d.deadAt ? `muerto en ${Math.max(0, Math.ceil((d.deadAt - status.now) / 1000))} s` : d.lastHeartbeat ? `latido ${ago(status.now, d.lastHeartbeat)}` : STATE[d.state];
            return (
              <li key={d.id} data-s={d.state}>
                <Dot s={d.state} label={STATE[d.state]} />
                <div className="ops-dn-n">
                  <Tip content={<span className="mono">http :{d.httpPort} · datos :{d.dataPort}</span>}><b>DataNode {d.id}</b></Tip>
                  <span className={d.state === 'stale' ? 'ops-warn' : d.state === 'dead' ? 'ops-bad' : 'muted'}>{beat}</span>
                </div>
                <div className="ops-dn-m">
                  <span className="ops-dn-u"><b className="num">{d.blocks}</b> <span className="muted">bloques · {sizeLabel(d.usedMb)}</span></span>
                  <Meter value={d.usedMb} max={max} kind={d.state === 'stale' ? 'run' : undefined} label={`Ocupado en el DataNode ${d.id}`} />
                </div>
                {p && (up
                  ? <button className="btn btn-sm btn-ghost btn-icon" type="button" aria-label={`Apagar el DataNode ${d.id}`} disabled={d.state === 'starting'} onClick={() => processAction(p, 'stop')}><Power size={13} /></button>
                  : <button className="btn btn-sm btn-ghost" type="button" aria-label={`Prender el DataNode ${d.id}`} onClick={() => processAction(p, 'start')}>Prender</button>)}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
