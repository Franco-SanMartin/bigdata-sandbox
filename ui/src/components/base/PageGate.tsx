/* Lo que ve una pantalla de trabajo cuando su capacidad principal no está: apagado, arrancando,
   servicio caído o fuera de la configuración. Con el motivo, lo que se va a poder hacer y el botón. */
import type { ReactNode } from 'react';
import { Play, Settings } from 'lucide-react';
import type { CapId } from '../../lib/capabilities';
import { runFix, useCapability } from '../../state/capabilities';
import { useStatus } from '../../state/store';
import { navigate } from '../../state/ui';
import { EmptyState } from './EmptyState';
import { PageSkeleton } from './Skeleton';

/** Paso actual del arranque y cuánto falta, en una línea */
export function bootLine(boot: { steps: { name: string; state: string; expectedSec: number }[]; startedAt: number; expectedSec: number } | null | undefined, now: number): string | null {
  if (!boot) return null;
  const i = boot.steps.findIndex(s => s.state === 'running' || s.state === 'pending');
  if (i < 0) return null;
  const left = Math.max(0, Math.round(boot.expectedSec - (now - boot.startedAt) / 1000));
  return `Paso ${i + 1} de ${boot.steps.length}: ${boot.steps[i].name}${left > 0 ? ` · faltan ~${left} s` : ''}`;
}

export function PageGate({ cap, title, can, children, keep }: {
  cap: CapId;
  /** Qué es esta pantalla, para el título: "HDFS", "Consultas en Hive"… */
  title: string;
  /** Lo que se va a poder hacer acá cuando esté listo (3 viñetas) */
  can: string[];
  children: ReactNode;
  /** Lo que se puede ver igual con la capacidad bloqueada (catálogo, ejemplos…) */
  keep?: ReactNode;
}) {
  const s = useStatus();
  const c = useCapability(cap);
  if (!s) return <PageSkeleton />;
  if (c.state === 'ready') return <>{children}</>;
  const starting = c.state === 'starting';
  const line = starting ? bootLine(s.boot, s.now) : null;
  const primary = c.fix && c.fix.kind !== 'wait'
    ? <button type="button" className="btn btn-primary" onClick={() => runFix(c.fix)}>{c.fix.kind === 'start' && <Play size={15} />}{c.fixLabel}</button>
    : null;
  return (
    <>
      <EmptyState
        kind={starting ? 'loading' : 'blocked'}
        title={starting ? `${title}: preparándose` : `${title} no está disponible`}
        list={can}
        actions={<>{primary}{c.fix?.kind === 'start' && <button type="button" className="btn" onClick={() => navigate('config')}><Settings size={15} />Configurar primero</button>}</>}
        foot={line ?? (c.fix?.kind === 'start' ? 'El primer arranque tarda 1-2 minutos; los siguientes, menos.' : undefined)}>
        {c.reason}. Cuando esté listo vas a poder:
      </EmptyState>
      {keep}
    </>
  );
}
