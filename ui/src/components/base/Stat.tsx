/* KPIs en fila, pares clave/valor y paneles: la estructura de toda pantalla. */
import type { ReactNode } from 'react';

export function StatRow({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="statrow" role="group" aria-label={label}>{children}</div>;
}

export function Stat({ label, value, unit, sub, k, help }: { label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode; k?: 'ok' | 'run' | 'bad'; help?: ReactNode }) {
  return (
    <div className="kpi" data-k={k}>
      <span className="kpi-l">{label}{help}</span>
      <span className="kpi-v">{value}{unit && <small>{unit}</small>}</span>
      {sub && <span className="kpi-s">{sub}</span>}
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return <dl className="kv">{items.map(([k, v], i) => <div key={i} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Panel({ title, sub, end, children, flush, className, style }: { title?: ReactNode; sub?: ReactNode; end?: ReactNode; children: ReactNode; flush?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={`panel ${className ?? ''}`} style={style}>
      {title && <div className="panel-h"><h2>{title}</h2>{sub && <span className="sub">{sub}</span>}{end && <div className="end">{end}</div>}</div>}
      <div className={`panel-b ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}
