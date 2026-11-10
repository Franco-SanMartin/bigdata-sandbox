/* Las colas por grupo: una cola de YARN por grupo de alumnos, con partes iguales del aula (lo que sobra, a default).
   Cada barra muestra la parte que le toca (la marca), lo que usa ahora y hasta dónde puede crecer si las otras no
   usan lo suyo. «Mandar un π» corre un trabajo de muestra en esa cola, para ver cómo YARN reparte entre grupos. */
import { useState } from 'react';
import { Play, Save } from 'lucide-react';
import { api } from '../../api';
import type { AulaCola, AulaStatus } from '../../api/types';
import { leerGrupos } from '../../lib/aula';
import { mbLabel, nf, plural } from '../../lib/format';
import { toast } from '../../state/ui';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Cola({ c, onMandar, mandando }: { c: AulaCola; onMandar: () => void; mandando: boolean }) {
  const parada = c.estado !== 'RUNNING';
  return (
    <li className="au-cola" data-parada={parada || undefined}>
      <div className="au-cola-h">
        <b className="mono">{c.nombre}</b>
        <span>{parada ? 'parada' : `${nf(c.capacidad, c.capacidad % 1 ? 1 : 0)} % del aula`}</span>
        {!parada && (
          <button type="button" className="btn btn-sm" onClick={onMandar} disabled={mandando} aria-label={`Mandar un π de muestra a la cola ${c.nombre}`}>
            <Play size={12} />Mandar un π
          </button>
        )}
      </div>
      <div className="au-cola-barra" role="img"
        aria-label={`${c.nombre}: usa ${nf(c.usada, 1)} % del aula; le toca ${nf(c.capacidad, 1)} % y puede crecer hasta ${nf(c.maxima)} %`}>
        <span className="au-cola-max" style={{ width: `${Math.min(100, c.maxima)}%` }} />
        <span className="au-cola-uso" data-pasa={c.usada > c.capacidad + 0.5 || undefined} style={{ width: `${Math.min(100, c.usada)}%` }} />
        {!parada && <span className="au-cola-parte" style={{ left: `${Math.min(100, c.capacidad)}%` }} />}
      </div>
      <small className="num">
        {nf(c.usada, 1)} % en uso · {mbLabel(c.mb)} · {plural(c.contenedores, 'contenedor', 'contenedores')} · {plural(c.apps, 'trabajo')}
        {c.pendientes > 0 && ` · ${c.pendientes} esperando`}
      </small>
    </li>
  );
}

export function Colas({ a, onCambio }: { a: AulaStatus; onCambio: () => void }) {
  const colas = a.colas ?? null;
  const actuales = (colas ?? []).filter(c => c.nombre !== 'default' && c.estado === 'RUNNING').map(c => c.nombre);
  const [texto, setTexto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const valor = texto ?? actuales.join(', ');
  const leido = leerGrupos(valor);
  const cambia = texto != null && leido.grupos.join(',') !== actuales.join(',');

  async function guardar() {
    if (leido.error) return;
    setOcupado(true);
    try {
      const r = await api().aulaGuardarColas(leido.grupos);
      toast({ kind: 'ok', title: r.grupos.length ? `Colas armadas: default + ${r.grupos.join(', ')}` : 'Sin grupos: todo vuelve a default',
        description: r.paradas.length ? `Quedan paradas (sin parte): ${r.paradas.join(', ')}. Los trabajos que ya corrían en ellas terminan.` : undefined });
      setTexto(null);
      onCambio();
    } catch (e) { toast({ kind: 'bad', title: 'YARN no aceptó las colas', description: msg(e) }); }
    finally { setOcupado(false); }
  }
  async function mandar(cola: string) {
    setOcupado(true);
    try {
      const r = await api().aulaTrabajoEnCola(cola, 'mr-pi');
      toast({ kind: 'ok', title: `π mandado a ${cola}`, description: `${r.id}: miralo crecer en la barra de ${cola} y en el plano.` });
      onCambio();
    } catch (e) { toast({ kind: 'bad', title: `No se pudo mandar el π a ${cola}`, description: msg(e) }); }
    finally { setOcupado(false); }
  }

  return (
    <section className="au-card au-colas" aria-label="Las colas por grupo">
      <h3>Colas por grupo</h3>
      {colas == null
        ? <p className="au-nota">YARN no contesta: las colas aparecen cuando el ResourceManager del maestro esté arriba.</p>
        : <ul className="au-colas-l">{colas.map(c => <Cola key={c.nombre} c={c} mandando={ocupado} onMandar={() => void mandar(c.nombre)} />)}</ul>}
      <form className="au-colas-f" onSubmit={e => { e.preventDefault(); void guardar(); }}>
        <label htmlFor="au-grupos">Grupos (uno por cola, separados por coma)</label>
        <div>
          <input id="au-grupos" className="input" value={valor} placeholder="grupo1, grupo2, grupo3" spellCheck={false} autoComplete="off"
            aria-invalid={!!leido.error} aria-describedby="au-grupos-ayuda" onChange={e => setTexto(e.target.value)} disabled={colas == null} />
          <button type="submit" className="btn btn-sm btn-primary" disabled={!cambia || !!leido.error || ocupado || colas == null}><Save size={12} />Armar colas</button>
        </div>
        <small id="au-grupos-ayuda" className={leido.error ? 'au-error' : 'au-nota'}>
          {leido.error ?? (leido.grupos.length
            ? `Cada grupo tiene ${Math.floor(100 / (leido.grupos.length + 1))} % del aula y puede crecer hasta el 100 % si los otros no usan lo suyo.`
            : 'Sin grupos, todos los trabajos van a default.')}
        </small>
      </form>
    </section>
  );
}
