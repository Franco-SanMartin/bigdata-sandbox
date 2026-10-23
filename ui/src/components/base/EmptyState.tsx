/* Estado vacío que enseña: qué pasa, por qué y el botón que lo resuelve. Nunca una caja sola con un texto. */
import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, Lock } from 'lucide-react';

export type EmptyKind = 'empty' | 'blocked' | 'loading' | 'error';

const ICON = { empty: Inbox, blocked: Lock, loading: Loader2, error: AlertTriangle };

export function EmptyState({ kind = 'empty', icon, title, children, list, actions, foot, compact, center }: {
  kind?: EmptyKind;
  icon?: ReactNode;
  title: string;
  /** Una o dos líneas: por qué está así */
  children?: ReactNode;
  /** Qué vas a poder hacer (viñetas cortas) */
  list?: ReactNode[];
  /** Botones: el primero, primario */
  actions?: ReactNode;
  foot?: ReactNode;
  compact?: boolean;
  center?: boolean;
}) {
  const I = ICON[kind];
  return (
    <section className="es" data-k={kind} data-compact={compact || undefined} data-center={center || undefined} role={kind === 'loading' ? 'status' : undefined}>
      <div className="es-ico">{icon ?? <I size={20} className={kind === 'loading' ? 'spin' : undefined} aria-hidden="true" />}</div>
      <h3>{title}</h3>
      {children && <div className="es-body">{children}</div>}
      {list && list.length > 0 && <ul className="es-list">{list.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {actions && <div className="es-actions">{actions}</div>}
      {foot && <div className="es-foot">{foot}</div>}
    </section>
  );
}
