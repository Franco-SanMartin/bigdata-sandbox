/* Mapa de contenedores: la memoria de cada NodeManager, partida en los contenedores de cada trabajo. Y las colas. */
import type { AppType, Engine, YarnApp, YarnCluster } from '../../api/types';
import { Tip } from '../../components/ui';
import { mbLabel, nf } from '../../lib/format';

export const ENGINE: Record<AppType, Engine> = { MAPREDUCE: 'mr', TEZ: 'tez', SPARK: 'spark' };
export const shortId = (id: string) => id.replace(/^application_\d+_/, 'app_');
const KIND = { am: 'ApplicationMaster', task: 'tarea', executor: 'executor' } as const;
const NM_STATE: Record<YarnCluster['nodes'][number]['state'], string> = { RUNNING: 'ok', UNHEALTHY: 'run', LOST: 'bad', DECOMMISSIONED: '' };

export function ContainerMap({ c, apps, sel, onSelect }: { c: YarnCluster; apps: YarnApp[]; sel: string | null; onSelect: (id: string) => void }) {
  const type = (id: string) => apps.find(a => a.id === id)?.type;
  return (
    <div className="cm">
      {c.nodes.map(n => {
        const free = Math.max(0, n.memTotalMb - n.memUsedMb);
        const ticks = Math.max(1, Math.round(n.memTotalMb / c.minAllocationMb));
        const appIds = [...new Set(n.containers.map(x => x.appId))];
        return (
          <div key={n.id} className="cm-node">
            <div className="cm-h">
              <span className="mono cm-id">{n.id}</span>
              <span className="badge" data-k={NM_STATE[n.state] || undefined}>{n.state}</span>
              <span className="muted">{mbLabel(n.memUsedMb)} de {mbLabel(n.memTotalMb)} · {n.vcoresUsed} de {n.vcoresTotal} vcores · {n.containers.length} contenedores</span>
              <span className="cm-apps">
                {appIds.map(id => { const t = type(id); return <button key={id} type="button" className={`eng${t ? ` eng-${ENGINE[t]}` : ''} cm-app mono`} data-sel={sel === id || undefined} onClick={() => onSelect(id)}>{shortId(id)}</button>; })}
              </span>
            </div>
            <div className="cm-strip" style={{ ['--ticks' as string]: ticks }} role="img" aria-label={`Memoria de ${n.id}: ${n.containers.length} contenedores, ${mbLabel(free)} libres`}>
              {n.containers.map(x => {
                const t = type(x.appId);
                return (
                  <Tip key={x.id} content={<><b>{x.label}</b> · {KIND[x.kind]} de {shortId(x.appId)}<br /><span className="mono">{x.id}</span><br />{mbLabel(x.memoryMb)} · {x.vcores} vcore</>}>
                    <button type="button" className={`cm-c${t ? ` eng-${ENGINE[t]}` : ''}`} data-kind={x.kind} data-dim={sel && sel !== x.appId ? true : undefined}
                      style={{ flexGrow: x.memoryMb }} onClick={() => onSelect(x.appId)} aria-label={`${x.label} de ${shortId(x.appId)}, ${mbLabel(x.memoryMb)}`}>
                      <span>{x.label}</span><small>{nf(x.memoryMb)}</small>
                    </button>
                  </Tip>
                );
              })}
              {free > 0 && <span className="cm-free" style={{ flexGrow: free }}><span>{mbLabel(free)} libres</span></span>}
            </div>
          </div>
        );
      })}
      <p className="muted cm-foot">cada división = {mbLabel(c.minAllocationMb)} (mínimo por contenedor) · máximo {mbLabel(c.maxAllocationMb)}</p>
    </div>
  );
}

export function Queues({ c }: { c: YarnCluster }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl" aria-label="Colas">
        <thead><tr><th>Cola</th><th className="r">Capacidad</th><th>Usado</th><th className="r">Corren</th><th className="r">Esperan</th></tr></thead>
        <tbody>
          {c.queues.map(q => {
            const cap = c.totalMb * q.capacity / 100;
            return (
              <tr key={q.name}>
                <td className="mono">{q.name}</td>
                <td className="r">{nf(q.capacity)} %</td>
                <td><span className="cm-q"><span className="meter" role="meter" aria-label={`Memoria de la cola ${q.name}`} aria-valuenow={q.usedMb} aria-valuemin={0} aria-valuemax={cap}><i style={{ width: `${Math.min(100, q.usedMb / Math.max(1, cap) * 100)}%` }} /></span><span className="muted">{mbLabel(q.usedMb)}</span></span></td>
                <td className="r">{q.running}</td>
                <td className="r">{q.pending ? <span className="ops-warn">{q.pending}</span> : 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
