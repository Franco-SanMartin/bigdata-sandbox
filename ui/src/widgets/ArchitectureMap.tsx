/* Mapa de la arquitectura: cada proceso es un nodo que se puede seleccionar. Las capas van
   de los metadatos a los servicios, como el cartel de "Cluster LISTO" del README. */
import type { ReactNode } from 'react';
import type { DataNode, Process } from '../api/types';
import { Dot } from '../components/ui';
import { nf } from '../lib/format';

interface Props {
  processes: Process[];
  dataNodes?: DataNode[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  now?: number;
}

const ROLE = { active: 'activo', standby: 'en espera' } as const;

export function ArchitectureMap({ processes, dataNodes = [], selected, onSelect, now = 0 }: Props) {
  const by = (pred: (p: Process) => boolean) => processes.filter(pred);
  const meta = by(p => ['namenode', 'secondarynamenode'].includes(p.kind));
  const coord = by(p => ['zookeeper', 'journalnode'].includes(p.kind));
  const dns = by(p => p.kind === 'datanode');
  const yarn = by(p => p.layer === 'yarn');
  const svc = by(p => p.layer === 'servicios' && p.kind !== 'ui');
  const node = (p: Process, extra?: string) => {
    const dn = p.kind === 'datanode' ? dataNodes.find(d => `dn${d.id}` === p.id) : undefined;
    let s: string = p.state;
    let sub = `:${p.ports[0]}`;
    if (p.role) sub += ` · ${ROLE[p.role]}`;
    if (dn) {
      if (dn.state === 'stale') { s = 'stale'; sub = `sin latidos · muerto en ${Math.max(0, Math.ceil(((dn.deadAt || 0) - now) / 1000))} s`; }
      else if (dn.state === 'dead') { s = 'down'; sub = 'muerto'; }
      else if (p.state === 'up') sub += ` · ${nf(dn.blocks)} bl`;
    }
    if (extra) sub += extra;
    return (
      <button key={p.id} type="button" className="arch-node" data-s={s} aria-pressed={selected === p.id} onClick={() => onSelect?.(p.id)} disabled={!onSelect}>
        <Dot s={s === 'stale' ? 'warn' : s} />
        <span className="arch-name">{p.name}</span>
        <span className="arch-sub">{sub}</span>
      </button>
    );
  };
  const layer = (title: string, hint: string, items: ReactNode, cols?: number, off?: boolean) => (
    <div className="arch-layer" data-off={off || undefined}>
      <div className="arch-l"><b>{title}</b><span>{hint}</span></div>
      <div className="arch-row" style={cols ? { gridTemplateColumns: `repeat(auto-fill, minmax(${cols >= 4 ? 150 : 170}px, 1fr))` } : undefined}>{items}</div>
    </div>
  );
  return (
    <div className="arch" role="group" aria-label="Arquitectura del cluster">
      {coord.length > 0 && layer('Coordinación', 'elige al NameNode activo', coord.map(p => node(p)), 4)}
      {layer('Metadatos', 'qué bloque está dónde', meta.map(p => node(p)), Math.max(2, meta.length))}
      {layer('Datos', `${dns.length} DataNode${dns.length !== 1 ? 's' : ''} en el rack`, dns.map(p => node(p)), Math.min(dns.length, dns.length > 4 ? Math.ceil(dns.length / 2) : dns.length))}
      {layer('Cómputo', yarn.length ? 'YARN reparte 4 GB' : 'apagado con SERVICIOS=hdfs', yarn.length ? yarn.map(p => node(p)) : <span className="arch-none">Sin YARN</span>, 3, !yarn.length)}
      {layer('Servicios', 'consultas y bases', svc.length ? svc.map(p => node(p)) : <span className="arch-none">Solo HDFS</span>, Math.min(4, Math.max(1, svc.length)), !svc.length)}
    </div>
  );
}
