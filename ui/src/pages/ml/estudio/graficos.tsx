/* Gráficos del estudio de ML, en SVG con d3-scale y d3-shape (sin librería de gráficos aparte).
   Marcas finas (líneas de 2 px, barras de hasta 24 px con la punta redondeada), grilla y ejes recesivos,
   leyenda con dos o más series y un tooltip al pasar el mouse. Las series usan --viz-1..8 en orden fijo;
   una sola serie va en el gris de acento. Los textos van siempre en los colores de texto. */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { scaleLinear, scaleLog } from 'd3-scale';
import { area, line } from 'd3-shape';

export const SERIE = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)', 'var(--viz-7)', 'var(--viz-8)'];
export const UNA = 'var(--accent)';

const M = { t: 10, r: 14, b: 34, l: 52 };

export const fnum = (v: number | null | undefined, d = 3) => {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
  if (a >= 1e4) return v.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  if (a >= 100) return v.toLocaleString('es-AR', { maximumFractionDigits: 1 });
  return v.toLocaleString('es-AR', { maximumFractionDigits: d });
};

function useAncho(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function Leyenda({ items }: { items: { nombre: string; color: string; punteada?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="es-ley" aria-label="Leyenda">
      {items.map(i => <li key={i.nombre}><i style={{ background: i.color }} data-p={i.punteada || undefined} />{i.nombre}</li>)}
    </ul>
  );
}

function Tooltip({ x, y, ancho, children }: { x: number; y: number; ancho: number; children: ReactNode }) {
  const izq = x > ancho - 180;
  return <div className="es-tt" style={{ left: izq ? undefined : x + 12, right: izq ? ancho - x + 12 : undefined, top: Math.max(0, y - 10) }} role="status">{children}</div>;
}

/* ---------- líneas (curvas ROC, PR, aprendizaje, validación, pérdida, calibración) ---------- */

export interface Serie {
  nombre: string;
  x: number[];
  y: number[];
  /** Banda (p. ej. ± desvío entre particiones) */
  lo?: number[];
  hi?: number[];
  color?: string;
  punteada?: boolean;
}

export function Lineas({ series, xLabel, yLabel, alto = 220, diagonal, xDom, yDom, xCat, logX, fmtX = v => fnum(v), fmtY = v => fnum(v), titulo }: {
  series: Serie[]; xLabel?: string; yLabel?: string; alto?: number; diagonal?: boolean;
  xDom?: [number, number]; yDom?: [number, number];
  /** Eje x de categorías (valores de un hiperparámetro): x son los índices */
  xCat?: string[]; logX?: boolean; fmtX?: (v: number) => string; fmtY?: (v: number) => string; titulo: string;
}) {
  const [ref, ancho] = useAncho();
  const [hover, setHover] = useState<{ px: number; py: number; filas: { s: Serie; i: number; color: string }[] } | null>(null);
  const w = ancho - M.l - M.r, h = alto - M.t - M.b;
  const colores = series.map((s, i) => s.color ?? (series.length === 1 ? UNA : SERIE[i % SERIE.length]));
  const { x, y, xt, yt } = useMemo(() => {
    const xs = series.flatMap(s => s.x).filter(Number.isFinite);
    const ys = series.flatMap(s => [...s.y, ...(s.lo ?? []), ...(s.hi ?? [])]).filter(Number.isFinite);
    let x0 = xDom?.[0] ?? Math.min(...xs), x1 = xDom?.[1] ?? Math.max(...xs);
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    let y0 = yDom?.[0] ?? Math.min(...ys), y1 = yDom?.[1] ?? Math.max(...ys);
    if (!yDom) { const pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.1 || 1; y0 -= pad; y1 += pad; }
    const x = (logX && x0 > 0 ? scaleLog() : scaleLinear()).domain([x0, x1]).range([0, w]);
    const y = scaleLinear().domain([y0, y1]).range([h, 0]).nice();
    return { x, y, xt: xCat ? xCat.map((_, i) => i) : x.ticks(Math.max(2, Math.floor(w / 80))), yt: y.ticks(5) };
  }, [series, w, h, xDom, yDom, xCat, logX]);
  if (!series.length || !series.some(s => s.x.length)) return <div className="es-vacio">Sin datos para dibujar</div>;
  const mover = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const xv = x.invert(mx);
    const filas = series.map((s, si) => {
      let best = 0, bd = Infinity;
      s.x.forEach((v, i) => { const d = Math.abs(v - xv); if (d < bd) { bd = d; best = i; } });
      return { s, i: best, color: colores[si] };
    }).filter(f => f.s.x.length);
    setHover({ px: M.l + x(filas[0].s.x[filas[0].i]), py: e.clientY - r.top + M.t, filas });
  };
  return (
    <figure className="es-graf" ref={ref}>
      <svg width={ancho} height={alto} role="img" aria-label={titulo}>
        <g transform={`translate(${M.l},${M.t})`}>
          {yt.map(t => <g key={`y${t}`}><line x1={0} x2={w} y1={y(t)} y2={y(t)} className="es-grid" /><text x={-8} y={y(t)} className="es-tick" textAnchor="end" dy="0.32em">{fmtY(t)}</text></g>)}
          {xt.map(t => <text key={`x${t}`} x={x(t)} y={h + 16} className="es-tick" textAnchor="middle">{xCat ? xCat[t] : fmtX(t)}</text>)}
          <line x1={0} x2={w} y1={h} y2={h} className="es-eje" />
          {diagonal && <line x1={x(x.domain()[0])} y1={y(y.domain()[0])} x2={x(x.domain()[1])} y2={y(y.domain()[1])} className="es-ref" />}
          {series.map((s, si) => {
            const pts = s.x.map((v, i) => [v, s.y[i], s.lo?.[i], s.hi?.[i]] as const).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
            const banda = s.lo && s.hi ? area<typeof pts[number]>().x(p => x(p[0])).y0(p => y(p[2] ?? p[1])).y1(p => y(p[3] ?? p[1]))(pts) : null;
            const d = line<typeof pts[number]>().x(p => x(p[0])).y(p => y(p[1]))(pts) || '';
            return (
              <g key={s.nombre}>
                {banda && <path d={banda} fill={colores[si]} opacity={0.12} />}
                <path d={d} fill="none" stroke={colores[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.punteada ? '5 4' : undefined} />
                {pts.length <= 12 && pts.map((p, i) => <circle key={i} cx={x(p[0])} cy={y(p[1])} r={3.5} fill={colores[si]} stroke="var(--surface)" strokeWidth={2} />)}
              </g>
            );
          })}
          {hover && <line x1={hover.px - M.l} x2={hover.px - M.l} y1={0} y2={h} className="es-cruz" />}
          <rect width={w} height={h} fill="transparent" onMouseMove={mover} onMouseLeave={() => setHover(null)} />
          {xLabel && <text x={w} y={h + 30} className="es-lab" textAnchor="end">{xLabel}</text>}
          {yLabel && <text x={0} y={-2} className="es-lab">{yLabel}</text>}
        </g>
      </svg>
      {hover && (
        <Tooltip x={hover.px} y={hover.py} ancho={ancho}>
          <b>{xLabel ?? 'x'}: {xCat ? xCat[hover.filas[0].s.x[hover.filas[0].i]] : fmtX(hover.filas[0].s.x[hover.filas[0].i])}</b>
          {hover.filas.map(f => (
            <span key={f.s.nombre}><i style={{ background: f.color }} />{f.s.nombre}: {fmtY(f.s.y[f.i])}
              {f.s.lo && f.s.hi && <em> ({fmtY(f.s.lo[f.i])} a {fmtY(f.s.hi[f.i])})</em>}</span>
          ))}
        </Tooltip>
      )}
      <Leyenda items={series.map((s, i) => ({ nombre: s.nombre, color: colores[i], punteada: s.punteada }))} />
    </figure>
  );
}

/* ---------- dispersión (predicho contra real, residuos, proyección 2D) ---------- */

export function Dispersion({ x, y, grupo, nombresGrupo, xLabel, yLabel, alto = 260, diagonal, cero, centros, titulo, fmtX = v => fnum(v), fmtY = v => fnum(v) }: {
  x: number[]; y: number[]; grupo?: (number | string)[]; nombresGrupo?: (g: number | string) => string; xLabel: string; yLabel: string;
  alto?: number; diagonal?: boolean; cero?: boolean; centros?: { x: number[]; y: number[] }; titulo: string;
  fmtX?: (v: number) => string; fmtY?: (v: number) => string;
}) {
  const [ref, ancho] = useAncho();
  const [hover, setHover] = useState<number | null>(null);
  const w = ancho - M.l - M.r, h = alto - M.t - M.b;
  const grupos = useMemo(() => (grupo ? [...new Set(grupo)].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)))) : []), [grupo]);
  const color = (i: number) => (grupo ? (grupo[i] === -1 ? 'var(--n-8)' : SERIE[Math.max(0, grupos.indexOf(grupo[i])) % SERIE.length]) : UNA);
  const { sx, sy } = useMemo(() => {
    const xs = x.filter(Number.isFinite), ys = y.filter(Number.isFinite);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (diagonal) { x0 = y0 = Math.min(x0, y0); x1 = y1 = Math.max(x1, y1); }
    return { sx: scaleLinear().domain([x0, x1]).range([0, w]).nice(), sy: scaleLinear().domain([y0, y1]).range([h, 0]).nice() };
  }, [x, y, w, h, diagonal]);
  if (!x.length) return <div className="es-vacio">Sin datos para dibujar</div>;
  const mover = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bd = 400;
    for (let i = 0; i < x.length; i++) { const d = (sx(x[i]) - mx) ** 2 + (sy(y[i]) - my) ** 2; if (d < bd) { bd = d; best = i; } }
    setHover(best >= 0 ? best : null);
  };
  return (
    <figure className="es-graf" ref={ref}>
      <svg width={ancho} height={alto} role="img" aria-label={titulo}>
        <g transform={`translate(${M.l},${M.t})`}>
          {sy.ticks(5).map(t => <g key={`y${t}`}><line x1={0} x2={w} y1={sy(t)} y2={sy(t)} className="es-grid" /><text x={-8} y={sy(t)} className="es-tick" textAnchor="end" dy="0.32em">{fmtY(t)}</text></g>)}
          {sx.ticks(Math.max(2, Math.floor(w / 80))).map(t => <text key={`x${t}`} x={sx(t)} y={h + 16} className="es-tick" textAnchor="middle">{fmtX(t)}</text>)}
          {diagonal && <line x1={sx(sx.domain()[0])} y1={sy(sy.domain()[0])} x2={sx(sx.domain()[1])} y2={sy(sy.domain()[1])} className="es-ref" />}
          {cero && <line x1={0} x2={w} y1={sy(0)} y2={sy(0)} className="es-ref" />}
          {x.map((v, i) => <circle key={i} cx={sx(v)} cy={sy(y[i])} r={2.6} fill={color(i)} opacity={hover === i ? 1 : 0.55} />)}
          {centros && centros.x.map((cx, i) => <g key={`c${i}`} transform={`translate(${sx(cx)},${sy(centros.y[i])})`}><circle r={7} fill={SERIE[(grupos.indexOf(i) >= 0 ? grupos.indexOf(i) : i) % SERIE.length]} stroke="var(--surface)" strokeWidth={2} /><text className="es-tick" y={-10} textAnchor="middle">centro {i}</text></g>)}
          {hover != null && <circle cx={sx(x[hover])} cy={sy(y[hover])} r={6} fill={color(hover)} stroke="var(--surface)" strokeWidth={2} />}
          <line x1={0} x2={w} y1={h} y2={h} className="es-eje" />
          <rect width={w} height={h} fill="transparent" onMouseMove={mover} onMouseLeave={() => setHover(null)} />
          <text x={w} y={h + 30} className="es-lab" textAnchor="end">{xLabel}</text>
          <text x={0} y={-2} className="es-lab">{yLabel}</text>
        </g>
      </svg>
      {hover != null && (
        <Tooltip x={M.l + sx(x[hover])} y={M.t + sy(y[hover])} ancho={ancho}>
          {grupo && <b>{nombresGrupo ? nombresGrupo(grupo[hover]) : `grupo ${grupo[hover]}`}</b>}
          <span>{xLabel}: {fmtX(x[hover])}</span><span>{yLabel}: {fmtY(y[hover])}</span>
        </Tooltip>
      )}
      {grupo && <Leyenda items={grupos.slice(0, 8).map(g => ({ nombre: nombresGrupo ? nombresGrupo(g) : `grupo ${g}`, color: g === -1 ? 'var(--n-8)' : SERIE[grupos.indexOf(g) % SERIE.length] }))} />}
    </figure>
  );
}

/* ---------- barras horizontales (importancias, tamaños, balance, comparación) ---------- */

export function Barras({ items, fmt = v => fnum(v), titulo, color, max: maxDado }: {
  items: { etiqueta: string; valor: number; error?: number; color?: string; nota?: string }[];
  fmt?: (v: number) => string; titulo: string; color?: string; max?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!items.length) return <div className="es-vacio">Sin datos para dibujar</div>;
  const min = Math.min(0, ...items.map(i => i.valor - (i.error ?? 0)));
  const max = maxDado ?? Math.max(...items.map(i => i.valor + (i.error ?? 0)), 1e-12);
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <ul className="es-barras" role="list" aria-label={titulo}>
      {items.map((it, i) => (
        <li key={it.etiqueta + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} data-h={hover === i || undefined}>
          <span className="es-bl mono" title={it.etiqueta}>{it.etiqueta}</span>
          <span className="es-bt">
            {min < 0 && <i className="es-b0" style={{ left: pos(0) }} />}
            <b style={{ left: pos(Math.min(0, it.valor)), width: `${(Math.abs(it.valor) / (max - min)) * 100}%`, background: it.color ?? color ?? UNA }} data-neg={it.valor < 0 || undefined} />
            {it.error != null && it.error > 0 && <em style={{ left: pos(it.valor - it.error), width: `${((2 * it.error) / (max - min)) * 100}%` }} />}
          </span>
          <span className="es-bv mono">{fmt(it.valor)}{it.error != null && it.error > 0 && <small> ± {fmt(it.error)}</small>}</span>
          {hover === i && it.nota && <span className="es-bn">{it.nota}</span>}
        </li>
      ))}
    </ul>
  );
}

/* ---------- histograma (residuos, distribución de una columna) ---------- */

export function Histograma({ bordes, cuentas, alto = 160, xLabel, titulo, marca }: {
  bordes: number[]; cuentas: number[]; alto?: number; xLabel: string; titulo: string; marca?: number;
}) {
  const [ref, ancho] = useAncho();
  const [hover, setHover] = useState<number | null>(null);
  const w = ancho - M.l - M.r, h = alto - M.t - M.b;
  if (!cuentas.length) return <div className="es-vacio">Sin datos</div>;
  const x = scaleLinear().domain([bordes[0], bordes[bordes.length - 1]]).range([0, w]);
  const y = scaleLinear().domain([0, Math.max(...cuentas)]).range([h, 0]).nice();
  return (
    <figure className="es-graf" ref={ref}>
      <svg width={ancho} height={alto} role="img" aria-label={titulo}>
        <g transform={`translate(${M.l},${M.t})`}>
          {y.ticks(4).map(t => <g key={t}><line x1={0} x2={w} y1={y(t)} y2={y(t)} className="es-grid" /><text x={-8} y={y(t)} className="es-tick" textAnchor="end" dy="0.32em">{fnum(t)}</text></g>)}
          {cuentas.map((c, i) => {
            const x0 = x(bordes[i]) + 1, x1 = x(bordes[i + 1]) - 1;
            return <rect key={i} x={x0} width={Math.max(1, x1 - x0)} y={y(c)} height={h - y(c)} rx={Math.min(3, (x1 - x0) / 2)} fill={UNA} opacity={hover === i ? 1 : 0.7}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />;
          })}
          {marca != null && <line x1={x(marca)} x2={x(marca)} y1={0} y2={h} className="es-ref" />}
          {x.ticks(Math.max(2, Math.floor(w / 90))).map(t => <text key={`x${t}`} x={x(t)} y={h + 16} className="es-tick" textAnchor="middle">{fnum(t)}</text>)}
          <line x1={0} x2={w} y1={h} y2={h} className="es-eje" />
          <text x={w} y={h + 30} className="es-lab" textAnchor="end">{xLabel}</text>
        </g>
      </svg>
      {hover != null && <Tooltip x={M.l + x(bordes[hover])} y={M.t + y(cuentas[hover])} ancho={ancho}><span>{fnum(bordes[hover])} a {fnum(bordes[hover + 1])}</span><b>{cuentas[hover].toLocaleString('es-AR')} filas</b></Tooltip>}
    </figure>
  );
}

/** Histograma chiquito, para la tabla de columnas del perfil */
export function MiniHist({ cuentas, ancho = 84, alto = 22 }: { cuentas: number[]; ancho?: number; alto?: number }) {
  const max = Math.max(...cuentas, 1);
  const bw = ancho / cuentas.length;
  return (
    <svg width={ancho} height={alto} aria-hidden="true" className="es-mini">
      {cuentas.map((c, i) => <rect key={i} x={i * bw + 0.5} width={Math.max(1, bw - 1)} y={alto - (c / max) * alto} height={(c / max) * alto} fill="var(--n-10)" />)}
    </svg>
  );
}

/* ---------- matriz de confusión ---------- */

export function Matriz({ clases, valores, normalizar, titulo }: { clases: string[]; valores: number[][]; normalizar: boolean; titulo: string }) {
  const filas = valores.map(f => { const t = f.reduce((a, b) => a + b, 0) || 1; return f.map(v => (normalizar ? v / t : v)); });
  const max = Math.max(...filas.flat(), 1e-12);
  return (
    <div className="es-matriz" role="table" aria-label={titulo} style={{ gridTemplateColumns: `auto repeat(${clases.length}, minmax(44px, 1fr))` }}>
      <span className="es-mc es-mh" role="columnheader">real ↓ / predicho →</span>
      {clases.map(c => <span key={`h${c}`} className="es-mc es-mh mono" role="columnheader">{c}</span>)}
      {filas.map((f, i) => (
        <div key={clases[i]} role="row" style={{ display: 'contents' }}>
          <span className="es-mc es-mh mono" role="rowheader">{clases[i]}</span>
          {f.map((v, j) => (
            <span key={j} role="cell" className="es-mc mono" data-diag={i === j || undefined}
              style={{ background: `color-mix(in srgb, var(--viz-1) ${Math.round((v / max) * 70)}%, var(--surface-2))` }}
              title={`real ${clases[i]}, predicho ${clases[j]}: ${valores[i][j].toLocaleString('es-AR')} filas`}>
              {normalizar ? `${(v * 100).toFixed(1).replace('.', ',')} %` : v.toLocaleString('es-AR')}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
