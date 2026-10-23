/* Piezas chicas reutilizables. Primitivas accesibles de Radix con estilos propios. */
import { useMemo, useState, type ReactNode } from 'react';
import { Tooltip, Switch as RSwitch, ToggleGroup } from 'radix-ui';
import { Check, Copy, Minus, Plus } from 'lucide-react';
import { area, curveMonotoneX, line } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import { extent } from 'd3-array';
import { toast } from '../state/ui';

export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="tip" side={side} sideOffset={6}>{content}<Tooltip.Arrow className="tip-arrow" /></Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const Kbd = ({ k }: { k: string }) => <>{k.split('+').map(x => <kbd key={x}>{x}</kbd>)}</>;

export const Dot = ({ s, label }: { s: string; label?: string }) => <span className="dot" data-s={s} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty">{icon && <div className="ico">{icon}</div>}<h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function Meter({ value, max, mark, kind, label }: { value: number; max: number; mark?: number; kind?: 'ok' | 'run' | 'bad'; label: string }) {
  return (
    <div className="meter" data-k={kind} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}>
      <i style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      {mark != null && <b style={{ left: `${Math.min(100, (mark / max) * 100)}%` }} />}
    </div>
  );
}

/** Bloque de comandos con copiar. Las líneas que empiezan con # son comentarios */
export function CodeBlock({ lines, prompt = '$', label }: { lines: string[]; prompt?: string | null; label?: string }) {
  const [done, setDone] = useState(false);
  const text = lines.filter(l => !l.startsWith('#')).join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }
    catch { toast({ title: 'No se pudo copiar', description: 'Seleccioná el texto y usá Ctrl+C.', kind: 'bad' }); }
  };
  return (
    <div className="code">
      <pre aria-label={label}>{lines.map((l, i) => (
        <div key={i}>{l.startsWith('#') ? <span className="c">{l}</span> : <>{prompt && <span className="p">{prompt} </span>}{l.replace(/\s#.*$/, '')}{/\s#.*$/.test(l) && <span className="c">{/\s#.*$/.exec(l)![0]}</span>}</>}</div>
      ))}</pre>
      <button className="btn btn-sm btn-icon btn-ghost copy" type="button" onClick={copy} aria-label="Copiar">{done ? <Check size={14} /> : <Copy size={14} />}</button>
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, options, label, size }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; disabled?: boolean; tip?: string }[]; label: string; size?: 'lg' }) {
  return (
    <ToggleGroup.Root type="single" className={`seg ${size || ''}`} value={value} onValueChange={v => v && onChange(v as T)} aria-label={label}>
      {options.map(o => {
        const item = <ToggleGroup.Item key={o.value} value={o.value} disabled={o.disabled} aria-label={typeof o.label === 'string' ? o.label : o.value}>{o.label}</ToggleGroup.Item>;
        return o.tip ? <Tip key={o.value} content={o.tip}><span style={{ display: 'contents' }}>{item}</span></Tip> : item;
      })}
    </ToggleGroup.Root>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <RSwitch.Root className="switch" checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled}><RSwitch.Thumb className="switch-thumb" /></RSwitch.Root>;
}

export function Stepper({ value, onChange, min, max, label, id }: { value: number; onChange: (v: number) => void; min: number; max: number; label: string; id?: string }) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div className="stepper">
      <button type="button" onClick={() => set(value - 1)} disabled={value <= min} aria-label={`Menos ${label}`}><Minus size={14} /></button>
      <input id={id} value={value} inputMode="numeric" aria-label={label}
        onChange={e => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) set(n); }}
        onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); set(value + 1); } if (e.key === 'ArrowDown') { e.preventDefault(); set(value - 1); } }} />
      <button type="button" onClick={() => set(value + 1)} disabled={value >= max} aria-label={`Más ${label}`}><Plus size={14} /></button>
    </div>
  );
}

/** Línea chica con área: memoria en el tiempo */
export function Sparkline({ data, width = 96, height = 28, max }: { data: { t: number; v: number }[]; width?: number; height?: number; max?: number }) {
  const paths = useMemo(() => {
    if (data.length < 2) return null;
    const x = scaleLinear().domain(extent(data, d => d.t) as [number, number]).range([1, width - 1]);
    const y = scaleLinear().domain([0, max ?? Math.max(...data.map(d => d.v)) * 1.1]).range([height - 1, 2]);
    return {
      a: area<{ t: number; v: number }>().x(d => x(d.t)).y0(height).y1(d => y(d.v)).curve(curveMonotoneX)(data) || '',
      l: line<{ t: number; v: number }>().x(d => x(d.t)).y(d => y(d.v)).curve(curveMonotoneX)(data) || '',
      end: [x(data[data.length - 1].t), y(data[data.length - 1].v)] as [number, number],
    };
  }, [data, width, height, max]);
  if (!paths) return null;
  return (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      <path d={paths.a} fill="var(--accent-bg)" />
      <path d={paths.l} fill="none" stroke="var(--accent)" strokeWidth={1.25} />
      <circle cx={paths.end[0]} cy={paths.end[1]} r={2.2} fill="var(--accent)" />
    </svg>
  );
}
