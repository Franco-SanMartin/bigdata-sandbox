/* Cuando una PC se cae (la apagaron por Veyon o la desenchufaron): la línea de tiempo desde que dejó de contestar.
   Arriba, la lámpara (ámbar, roja a los 40 s, verde si vuelve); abajo, los bloques con copias de menos y los que
   HDFS está copiando, bajando hasta 0; y el resumen: contenedores perdidos, bloques re-copiados y en cuánto. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { AulaCaida } from '../../api/types';
import { LAMPARA } from '../../lib/aula';

const hora = (ms: number) => new Date(ms).toLocaleTimeString('es-AR', { hour12: false });

function Linea({ c }: { c: AulaCaida }) {
  const W = 640, H = 170, L = 36, R = 12, T = 26, B = 24;
  const fin = Math.max(c.resumen.duracionS, ...c.serie.map(x => x.s), 10);
  const max = Math.max(1, ...c.serie.map(x => Math.max(x.sub, x.pend)));
  const X = (s: number) => L + (s / fin) * (W - L - R);
  const Y = (v: number) => H - B - (v / max) * (H - T - B);
  const camino = (k: 'sub' | 'pend') => c.serie.map((x, i) => `${i ? 'L' : 'M'}${X(x.s).toFixed(1)},${Y(x[k]).toFixed(1)}`).join(' ');
  const tramos = c.serie.map((x, i) => ({ x0: X(x.s), x1: X(c.serie[i + 1]?.s ?? fin), k: LAMPARA[x.estado].k }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="au-linea-t" role="img" aria-label={`Línea de tiempo de la caída de ${c.nodo}`}>
      {tramos.map((t, i) => <rect key={i} x={t.x0} y={4} width={Math.max(0, t.x1 - t.x0)} height={10} fill={`var(--${t.k === 'ok' ? 'ok' : t.k === 'bad' ? 'bad' : 'run'})`} />)}
      <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--line-strong)" />
      {[0, Math.round(max / 2), max].map(v => <text key={v} x={L - 6} y={Y(v) + 4} textAnchor="end" className="au-linea-eje">{v}</text>)}
      {[0, fin / 2, fin].map(s => <text key={s} x={X(s)} y={H - 6} textAnchor="middle" className="au-linea-eje">{Math.round(s)} s</text>)}
      <path d={camino('sub')} fill="none" stroke="var(--bad)" strokeWidth={2} />
      <path d={camino('pend')} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeDasharray="5 3" />
      {c.resumen.rojaALosS != null && <g><line x1={X(c.resumen.rojaALosS)} x2={X(c.resumen.rojaALosS)} y1={T - 6} y2={H - B} stroke="var(--bad)" strokeDasharray="2 3" /><text x={X(c.resumen.rojaALosS) + 4} y={T + 6} className="au-linea-eje">muerta para HDFS</text></g>}
      {c.resumen.copiadoALosS != null && <g><line x1={X(c.resumen.copiadoALosS)} x2={X(c.resumen.copiadoALosS)} y1={T - 6} y2={H - B} stroke="var(--ok)" strokeDasharray="2 3" /><text x={X(c.resumen.copiadoALosS) + 4} y={T + 18} className="au-linea-eje">todo copiado</text></g>}
    </svg>
  );
}

export function Caidas() {
  const [cs, setCs] = useState<AulaCaida[] | null>(null);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    let vivo = true;
    const traer = () => api().aulaCaidas().then(x => vivo && setCs(x), () => undefined);
    traer();
    const i = setInterval(traer, 5000);
    return () => { vivo = false; clearInterval(i); };
  }, []);
  if (!cs) return null;
  const c = cs[Math.min(sel, cs.length - 1)];
  return (
    <section className="au-card au-caidas" aria-label="PCs que se cayeron">
      <h3>Si una PC se cae</h3>
      {!c ? (
        <p className="au-nota">Apagá una PC de verdad (Veyon → apagar, o desenchufarla) mientras corre un trabajo: acá aparece su línea de tiempo. Ámbar a los ~10 s sin latidos, roja a los 40 s (HDFS empieza a copiar sus bloques en otras PCs) y YARN reintenta sus tareas en otra.</p>
      ) : (
        <>
          {cs.length > 1 && (
            <div className="au-caidas-lista" role="tablist">
              {cs.map((x, i) => <button key={`${x.nodo}-${x.desde}`} type="button" role="tab" aria-selected={i === sel} className="btn btn-sm" onClick={() => setSel(i)}>{x.nodo} · {hora(x.desde)}</button>)}
            </div>
          )}
          <p className="au-caida-t"><b className="mono">{c.nodo}</b> · desde las {hora(c.desde)}{c.abierta ? ' · todavía no volvió' : ` · ${c.resumen.cierre ?? ''}`}</p>
          <Linea c={c} />
          <ul className="au-leyenda-red">
            <li><span className="au-clase" style={{ background: 'var(--bad)' }} />bloques con copias de menos</li>
            <li><span className="au-clase" style={{ background: 'var(--viz-1)' }} />bloques que HDFS está copiando</li>
          </ul>
          <p className="au-caida-res">{c.resumen.texto}</p>
        </>
      )}
    </section>
  );
}
