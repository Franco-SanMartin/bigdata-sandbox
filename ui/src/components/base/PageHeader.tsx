/* Encabezado de toda pantalla: título, una línea, estado del área, acciones y pestañas opcionales.
   La explicación larga va en HelpTip o en la hoja de ayuda, no acá. */
import type { ReactNode } from 'react';
import { HelpTip } from './HelpTip';

export type Tone = 'ok' | 'run' | 'bad' | 'off';

export function Chip({ k, children }: { k?: Tone; children: ReactNode }) {
  return <span className="chip" data-k={k}>{k && k !== 'off' && <span className="dot" data-s={k} aria-hidden="true" />}{children}</span>;
}

export interface Tab<T extends string> { id: T; label: ReactNode; count?: number; countKind?: 'run' | 'bad' }

export function PageHeader<T extends string>({ title, sub, status, help, actions, tabs, tab, onTab }: {
  title: string;
  /** Una línea: qué se hace acá */
  sub?: ReactNode;
  status?: { k: Tone; label: string };
  help?: ReactNode;
  actions?: ReactNode;
  tabs?: Tab<T>[];
  tab?: T;
  onTab?: (t: T) => void;
}) {
  return (
    <header className="ph">
      <div className="ph-row">
        <div className="ph-t">
          <h1>{title}</h1>
          {status && <Chip k={status.k}>{status.label}</Chip>}
          {help && <HelpTip>{help}</HelpTip>}
        </div>
        {actions && <div className="ph-actions">{actions}</div>}
      </div>
      {sub && <p className="ph-sub">{sub}</p>}
      {tabs && (
        <div className="ph-tabs" role="tablist" aria-label={title}>
          {tabs.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} onClick={() => onTab?.(t.id)}>
              {t.label}{t.count != null && t.count > 0 && <span className="badge-count" data-k={t.countKind}>{t.count}</span>}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
