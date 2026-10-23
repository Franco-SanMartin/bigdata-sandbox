/* Acciones que dependen del cluster. Si no se pueden usar, se ven apagadas pero dicen POR QUÉ y
   ofrecen el arreglo (Iniciar cluster, Prender HiveServer2, Activar MongoDB…). Reemplazan a disabled. */
import type { ReactNode } from 'react';
import type { CapId, Capability } from '../../lib/capabilities';
import { runFix, useCapability } from '../../state/capabilities';
import { Tip } from '../ui';

type BtnProps = {
  /** Capacidad que necesita, o la capacidad ya calculada */
  cap?: CapId | Capability;
  /** Motivo propio de la pantalla (p. ej. "Escribí una consulta"): tiene prioridad si la capacidad está lista */
  blockedBy?: string | false | null;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  /** Muestra el motivo y el arreglo al lado del botón, además del tooltip */
  inline?: boolean;
  busy?: boolean;
  title?: string;
  'aria-label'?: string;
};

function useCap(cap: CapId | Capability | undefined): Capability | undefined {
  const id = typeof cap === 'string' ? cap : 'cluster.start';
  const live = useCapability(id);
  if (!cap) return undefined;
  return typeof cap === 'string' ? live : cap;
}

/** El motivo para no poder hacer algo, o null si se puede */
export function useBlock(cap?: CapId | Capability, blockedBy?: string | false | null): { reason: string; c?: Capability } | null {
  const c = useCap(cap);
  if (c && c.state !== 'ready') return { reason: c.reason || 'No disponible', c };
  if (blockedBy) return { reason: blockedBy };
  return null;
}

export function GatedButton({ cap, blockedBy, onClick, children, className = 'btn', inline, busy, title, ...rest }: BtnProps) {
  const block = useBlock(cap, blockedBy);
  const fix = block?.c?.fix && block.c.fix.kind !== 'wait' ? block.c : undefined;
  if (!block) {
    return <button type="button" className={className} onClick={onClick} disabled={busy} aria-busy={busy || undefined} title={title} aria-label={rest['aria-label']}>{children}</button>;
  }
  const tip = (
    <span className="gated-tip">
      <span><b>No disponible:</b> {block.reason}</span>
      {fix && <span>Se arregla con: {fix.fixLabel}</span>}
    </span>
  );
  const btn = (
    <Tip content={tip}>
      <button type="button" className={className} aria-disabled="true" aria-label={rest['aria-label']} aria-description={block.reason} data-gated="true"
        onClick={e => e.preventDefault()}>{children}</button>
    </Tip>
  );
  if (!inline) return btn;
  return (
    <span className="gated" style={{ gap: 10, alignItems: 'center' }}>
      {btn}
      <Why reason={block.reason} cap={fix} />
    </span>
  );
}

/** El motivo en texto, con el botón del arreglo si hay */
export function Why({ reason, cap }: { reason: string; cap?: Capability }) {
  return (
    <span className="why">
      <span>{reason}</span>
      {cap?.fix && cap.fix.kind !== 'wait' && <button type="button" className="btn btn-sm" onClick={() => runFix(cap.fix)}>{cap.fixLabel}</button>}
    </span>
  );
}

/** Banda arriba de una pantalla cuando una parte no está disponible: el resto sigue usable */
export function CapabilityNotice({ cap, what }: { cap: CapId; what: string }) {
  const c = useCapability(cap);
  if (c.state === 'ready') return null;
  return (
    <div className="capnote" data-k={c.state} role="status">
      <span className="dot" data-s={c.state === 'starting' ? 'starting' : 'off'} aria-hidden="true" />
      <span><b>{what}:</b> {c.reason}</span>
      {c.fix && c.fix.kind !== 'wait' && <button type="button" className="btn btn-sm" onClick={() => runFix(c.fix)}>{c.fixLabel}</button>}
    </div>
  );
}
