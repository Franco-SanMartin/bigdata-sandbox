/* El botón «medir»: corre el mismo trabajo con las PCs que hay ahora y anota cuánto tardó. Midiendo con 1, 5, 10 y
   20 PCs sale la curva: el tiempo baja al sumar PCs, pero no a la mitad cada vez que se duplican (lo que no se
   reparte, el arranque y la red pesan). La aceleración es lo que tardó con menos PCs dividido lo que tardó ahora. */
import { useEffect, useState } from 'react';
import { Download, Gauge, Trash2 } from 'lucide-react';
import { api } from '../../api';
import type { AulaEscala, AulaPuntoEscala, AulaStatus, AulaTrabajoEscala } from '../../api/types';
import { escalaCsv } from '../../lib/aula';
import { downloadText } from '../../lib/csv';
import { clock, mbLabel, nf, plural } from '../../lib/format';
import { toast } from '../../state/ui';

const TRABAJOS: Record<AulaTrabajoEscala, string> = { 'mr-pi': 'π con MapReduce', 'spark-pi': 'π con Spark', 'mr-wordcount': 'Contar palabras (MapReduce)' };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Curva({ puntos }: { puntos: AulaPuntoEscala[] }) {
  const W = 420, H = 180, L = 40, R = 14, T = 14, B = 28;
  const maxX = Math.max(2, ...puntos.map(p => p.pcs)), maxY = Math.max(1, ...puntos.map(p => p.segundos));
  const X = (n: number) => L + (n / maxX) * (W - L - R);
  const Y = (s: number) => H - B - (s / maxY) * (H - T - B);
  const ideal = puntos[0] && puntos.length > 1 ? Array.from({ length: 24 }, (_, i) => {
    const n = puntos[0].pcs + ((maxX - puntos[0].pcs) * i) / 23;
    return `${i ? 'L' : 'M'}${X(n).toFixed(1)},${Y((puntos[0].segundos * puntos[0].pcs) / n).toFixed(1)}`;
  }).join(' ') : '';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="au-curva" role="img"
      aria-label={`Tiempo según las PCs: ${puntos.map(p => `${p.pcs} PCs, ${nf(p.segundos, 1)} s`).join('; ')}`}>
      <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--line-strong)" />
      <line x1={L} y1={T} x2={L} y2={H - B} stroke="var(--line-strong)" />
      {[0, maxY / 2, maxY].map(v => <text key={v} x={L - 6} y={Y(v) + 4} textAnchor="end" className="au-linea-eje">{Math.round(v)} s</text>)}
      {puntos.map(p => <text key={p.pcs} x={X(p.pcs)} y={H - 8} textAnchor="middle" className="au-linea-eje">{p.pcs}</text>)}
      <text x={W - R} y={H - B - 6} textAnchor="end" className="au-linea-eje">PCs</text>
      {ideal && <path d={ideal} fill="none" stroke="var(--n-6)" strokeDasharray="4 4" />}
      <path d={puntos.map((p, i) => `${i ? 'L' : 'M'}${X(p.pcs).toFixed(1)},${Y(p.segundos).toFixed(1)}`).join(' ')} fill="none" stroke="var(--viz-1)" strokeWidth={2.5} />
      {puntos.map(p => <circle key={p.pcs} cx={X(p.pcs)} cy={Y(p.segundos)} r={4} fill="var(--viz-1)" />)}
    </svg>
  );
}

export function Escala({ a }: { a: AulaStatus }) {
  const [e, setE] = useState<AulaEscala | null>(null);
  const [trabajo, setTrabajo] = useState<AulaTrabajoEscala>('mr-pi');
  const [cola, setCola] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [borrarTodo, setBorrarTodo] = useState(false);

  useEffect(() => {
    let vivo = true;
    const traer = () => api().aulaEscala().then(x => vivo && setE(x), () => undefined);
    traer();
    const i = setInterval(traer, 3000);
    return () => { vivo = false; clearInterval(i); };
  }, []);

  async function medir() {
    setOcupado(true);
    try {
      const m = await api().aulaMedir(trabajo, cola || null);
      toast({ kind: 'ok', title: `Midiendo ${TRABAJOS[trabajo]} con ${plural(m.pcs, 'PC')}`, description: `${m.app}: cuando termine aparece en la curva.` });
      setE(await api().aulaEscala());
    } catch (x) { toast({ kind: 'bad', title: 'No se pudo medir', description: msg(x) }); }
    finally { setOcupado(false); }
  }
  async function borrar(id?: string) {
    try { setE(await api().aulaBorrarMedida(id)); setBorrarTodo(false); }
    catch (x) { toast({ kind: 'bad', title: 'No se pudo borrar', description: msg(x) }); }
  }

  const curva = e?.curva.find(c => c.trabajo === trabajo);
  const pcs = e?.ahora.pcs ?? 0;
  const colas = (a.colas ?? []).filter(c => c.estado === 'RUNNING').map(c => c.nombre);
  return (
    <section className="au-card au-escala" aria-label="Cuánto escala el aula">
      <h3>¿Cuánto más rápido con más PCs?</h3>
      <div className="au-escala-f">
        <select className="input select-sm" value={trabajo} onChange={x => setTrabajo(x.target.value as AulaTrabajoEscala)} aria-label="Trabajo a medir">
          {(Object.keys(TRABAJOS) as AulaTrabajoEscala[]).map(t => <option key={t} value={t}>{TRABAJOS[t]}</option>)}
        </select>
        {colas.length > 1 && (
          <select className="input select-sm" value={cola} onChange={x => setCola(x.target.value)} aria-label="Cola">
            <option value="">cola default</option>
            {colas.filter(c => c !== 'default').map(c => <option key={c} value={c}>cola {c}</option>)}
          </select>
        )}
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void medir()} disabled={ocupado || !!e?.corriendo || !pcs}>
          <Gauge size={13} />{e?.corriendo ? 'Midiendo…' : `Medir con ${plural(pcs, 'PC')}`}
        </button>
      </div>
      {e?.corriendo
        ? <p className="au-nota" role="status">Corriendo {TRABAJOS[e.corriendo.trabajo]} con {plural(e.corriendo.pcs, 'PC')} ({mbLabel(e.corriendo.mb)}, {e.corriendo.vcores} cores) desde las {clock(e.corriendo.inicio)}. No sumes ni apagues PCs hasta que termine.</p>
        : <p className="au-nota">Medí con pocas PCs, sumá más y volvé a medir: cada medida queda como un punto. Mientras mide, el aula tiene que quedar quieta.</p>}
      {curva && curva.puntos.length > 0 && (
        <>
          <Curva puntos={curva.puntos} />
          <table className="au-escala-t">
            <thead><tr><th>PCs</th><th>Tardó</th><th>Más rápido</th><th>Medidas</th></tr></thead>
            <tbody>{curva.puntos.map(p => (
              <tr key={p.pcs}><td className="num">{p.pcs}</td><td className="num">{nf(p.segundos, 1)} s</td><td className="num">×{nf(p.aceleracion, 2)}</td><td className="num">{p.medidas}</td></tr>
            ))}</tbody>
          </table>
          <small className="au-nota">{curva.puntos.length > 1
            ? 'La línea punteada es lo ideal (el doble de PCs, la mitad de tiempo).'
            : 'Un solo punto: sumá o sacá PCs y volvé a medir para ver la curva.'}</small>
        </>
      )}
      {e && e.medidas.length > 0 && (
        <details className="au-medidas">
          <summary>{plural(e.medidas.length, 'medida')}</summary>
          <ul>{e.medidas.map(m => (
            <li key={m.id} data-e={m.estado}>
              <span className="mono">{clock(m.inicio)}</span>
              <span>{TRABAJOS[m.trabajo]} · {plural(m.pcs, 'PC')}</span>
              <b className="num">{m.estado === 'ok' ? `${nf(m.segundos ?? 0, 1)} s` : m.estado === 'corriendo' ? 'midiendo' : m.resultado ?? 'falló'}</b>
              {m.cambiaron && <small title="Se sumó o se fue una PC mientras medía">cambiaron las PCs</small>}
              {m.estado !== 'corriendo' && <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => void borrar(m.id)} aria-label={`Borrar la medida de las ${clock(m.inicio)}`}><Trash2 size={13} /></button>}
            </li>
          ))}</ul>
          <div className="au-medidas-a">
            <button type="button" className="btn btn-sm" onClick={() => downloadText('escala-aula.csv', escalaCsv(e.medidas))}><Download size={13} />Exportar CSV</button>
            {borrarTodo
              ? <><button type="button" className="btn btn-sm btn-danger-solid" onClick={() => void borrar()}>Sí, borrar todas</button><button type="button" className="btn btn-sm" onClick={() => setBorrarTodo(false)}>Cancelar</button></>
              : <button type="button" className="btn btn-sm btn-danger" onClick={() => setBorrarTodo(true)}><Trash2 size={13} />Borrar todas</button>}
          </div>
        </details>
      )}
    </section>
  );
}
