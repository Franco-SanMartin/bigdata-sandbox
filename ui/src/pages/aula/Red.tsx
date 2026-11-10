/* La red del aula: lo que pasa por el wg0 del maestro, cada 2 s. Cada PC unida al maestro con una línea del grosor de
   lo que manda y recibe; si el maestro tiene nft, también las líneas PC a PC con el color de para qué (bloques de
   HDFS, shuffle, YARN). Al lado, el total, quién usa más y si alguna PC se acerca al techo de la red del aula
   (~50 Mbit/s, lo que midió la sonda): ahí la red es el cuello de botella. */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import type { AulaClaseTrafico, AulaPc, AulaStatus, AulaTrafico } from '../../api/types';
import { Sparkline } from '../../components/ui';
import { filasDelAula, LAMPARA } from '../../lib/aula';

const CLASE: Record<AulaClaseTrafico, { label: string; corto: string; color: string }> = {
  hdfs: { label: 'bloques de HDFS', corto: 'HDFS', color: 'var(--viz-1)' },
  shuffle: { label: 'shuffle', corto: 'shuffle', color: 'var(--viz-3)' },
  yarn: { label: 'YARN (control)', corto: 'YARN', color: 'var(--viz-5)' },
  otro: { label: 'otro', corto: 'otro', color: 'var(--n-6)' },
};
const mbps = (v: number) => `${v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)} Mbit/s`;
const dominante = (c: Record<AulaClaseTrafico, number>): AulaClaseTrafico =>
  (Object.entries(c) as [AulaClaseTrafico, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'otro';

/** Dónde va cada PC en el dibujo: por el plano si hay, si no por filas (el rack) */
function posiciones(a: AulaStatus, ancho: number): Map<string, { x: number; y: number; pc: AulaPc }> {
  const out = new Map<string, { x: number; y: number; pc: AulaPc }>();
  const por = new Map(a.pcs.map(p => [p.nodo, p]));
  const filas: (AulaPc | null)[][] = a.plano
    ? a.plano.filas.map(f => f.map(x => (x ? por.get(x) ?? null : null)))
    : filasDelAula(a.pcs).map(([, pcs]) => pcs);
  const sueltas = a.plano ? a.pcs.filter(p => !a.plano!.filas.flat().includes(p.nodo)) : [];
  if (sueltas.length) filas.push(sueltas);
  filas.forEach((f, i) => f.forEach((pc, j) => {
    if (pc) out.set(pc.nodo, { x: ((j + 0.5) * ancho) / Math.max(f.length, 1), y: 120 + i * 70, pc });
  }));
  return out;
}

export function Red({ a }: { a: AulaStatus }) {
  const [t, setT] = useState<AulaTrafico | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    const traer = () => api().aulaTrafico().then(x => { if (vivo) { setT(x); setError(null); } }, e => vivo && setError(e instanceof Error ? e.message : String(e)));
    traer();
    const i = setInterval(traer, 2000);
    return () => { vivo = false; clearInterval(i); };
  }, []);
  const ancho = 720;
  const pos = useMemo(() => posiciones(a, ancho), [a]);
  if (error) return <section className="au-card au-red"><h3>La red del aula</h3><p className="au-nota">No se pudo leer el tráfico: {error}</p></section>;
  if (!t) return <section className="au-card au-red"><h3>La red del aula</h3><p className="au-nota">Leyendo el tráfico…</p></section>;
  const ult = t.serie[t.serie.length - 1];
  const alto = 120 + Math.max(1, new Set([...pos.values()].map(p => p.y)).size) * 70;
  const hub = { x: ancho / 2, y: 40 };
  const deMaestro = t.pares.filter(p => p.de === 'maestro' || p.a === 'maestro');
  const entrePcs = t.pares.filter(p => p.de !== 'maestro' && p.a !== 'maestro' && pos.has(p.de) && pos.has(p.a));
  const cerca = t.porPc.filter(p => p.usoTecho >= 0.8);
  return (
    <section className="au-card au-red" aria-label="La red del aula">
      <header className="au-red-h">
        <h3>La red del aula</h3>
        <span className="au-nota">{t.fuente === 'nft' ? 'medido en el wg0 del maestro: por PC y por par, cada 2 s'
          : t.fuente === 'wg' ? `por PC, con el maestro (wg) · ${t.motivo ?? ''}` : t.motivo ?? 'sin túnel que medir'}</span>
      </header>
      <div className="au-red-cuerpo">
        <svg viewBox={`0 0 ${ancho} ${alto}`} className="au-red-svg" role="img" aria-label="Tráfico entre las PCs y el maestro">
          {[...pos.values()].map(({ x, y, pc }) => {
            const v = ult?.pcs[pc.nodo];
            const tot = v ? v.manda + v.recibe : 0;
            return <line key={`h-${pc.nodo}`} x1={hub.x} y1={hub.y} x2={x} y2={y} stroke="var(--n-5)" strokeOpacity={tot > 0.05 ? 0.9 : 0.25}
              strokeWidth={1 + Math.min(1, tot / t.techoMbps) * 9}><title>{`${pc.nodo} ↔ maestro: manda ${mbps(v?.manda ?? 0)}, recibe ${mbps(v?.recibe ?? 0)}`}</title></line>;
          })}
          {entrePcs.map(p => {
            const a1 = pos.get(p.de)!, b1 = pos.get(p.a)!;
            const cx = (a1.x + b1.x) / 2, cy = Math.min(a1.y, b1.y) - 35;
            const c = dominante(p.clases);
            return <path key={`${p.de}-${p.a}`} d={`M${a1.x},${a1.y} Q${cx},${cy} ${b1.x},${b1.y}`} fill="none" stroke={CLASE[c].color}
              strokeWidth={1.5 + Math.min(1, p.mbps / t.techoMbps) * 8} strokeOpacity={0.85}><title>{`${p.de} → ${p.a}: ${mbps(p.mbps)} (${CLASE[c].label})`}</title></path>;
          })}
          <g>
            <rect x={hub.x - 54} y={hub.y - 16} width={108} height={32} rx={8} fill="var(--n-0)" stroke="var(--line-strong)" />
            <text x={hub.x} y={hub.y + 5} textAnchor="middle" className="au-red-t">maestro (hub)</text>
          </g>
          {[...pos.values()].map(({ x, y, pc }) => (
            <g key={pc.nodo}>
              <circle cx={x} cy={y} r={16} fill="var(--n-0)" stroke={`var(--${LAMPARA[pc.estado].k === 'ok' ? 'ok' : LAMPARA[pc.estado].k === 'bad' ? 'bad' : 'run'})`} strokeWidth={3} />
              <text x={x} y={y + 4} textAnchor="middle" className="au-red-t">{pc.nodo.replace('pc', '')}</text>
            </g>
          ))}
        </svg>
        <div className="au-red-lado">
          <div className="au-red-total">
            <span>Total ahora</span>
            <b className="num">{mbps(ult?.total ?? 0)}</b>
            <Sparkline data={t.serie.map(s => ({ t: s.t, v: s.total }))} width={180} height={34} />
            <small>últimos {Math.round((t.serie.length * t.cadaS) / 60)} min · techo {t.techoMbps} Mbit/s por PC</small>
          </div>
          {cerca.length > 0 && <p className="au-aviso" role="status">{cerca.map(p => `${p.nodo} usa el ${Math.round(p.usoTecho * 100)} %`).join(' · ')} de lo que da la red del aula: ahí la red es el cuello de botella.</p>}
          <table className="tbl au-red-tbl" aria-label="Más tráfico">
            <thead><tr><th>{t.pares.length ? 'de → a' : 'PC'}</th><th className="r">Mbit/s</th>{t.pares.length > 0 && <th>para qué</th>}</tr></thead>
            <tbody>
              {(t.pares.length ? [...entrePcs, ...deMaestro].sort((x, y) => y.mbps - x.mbps).slice(0, 8).map(p => (
                <tr key={`${p.de}-${p.a}`}><td className="mono">{p.de} → {p.a}</td><td className="r num">{mbps(p.mbps)}</td>
                  <td title={CLASE[dominante(p.clases)].label}><span className="au-clase" style={{ background: CLASE[dominante(p.clases)].color }} />{CLASE[dominante(p.clases)].corto}</td></tr>
              )) : t.porPc.slice(0, 8).map(p => (
                <tr key={p.nodo}><td className="mono">{p.nodo}</td><td className="r num">↑ {mbps(p.manda)} · ↓ {mbps(p.recibe)}</td></tr>
              )))}
            </tbody>
          </table>
          {t.fuente === 'nft' && (
            <ul className="au-leyenda-red">{(Object.keys(CLASE) as AulaClaseTrafico[]).map(c => <li key={c}><span className="au-clase" style={{ background: CLASE[c].color }} />{CLASE[c].label}</li>)}</ul>
          )}
        </div>
      </div>
    </section>
  );
}
