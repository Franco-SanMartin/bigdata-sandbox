/* La localidad de un trabajo: por cada tarea, dónde estaba el bloque que leyó y en qué PC corrió. Al pasar el mouse
   (o el foco) por una tarea se prenden en el plano las PCs con una copia del bloque y la PC donde corrió: si es la
   misma, la tarea fue data-local; si fue otra de la misma fila (rack), rack-local; si no, off-rack (el bloque viajó
   por la red del aula). MapReduce lo dice todo (el .jhist); Spark dice dónde corrió y qué localidad logró. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { AulaLocalidad, AulaLocalidadTipo, AulaTarea, YarnApp } from '../../api/types';
import { resalteDeTarea, type Resalte } from '../../lib/aula';

export const LOCALIDAD: Record<AulaLocalidadTipo, { label: string; que: string }> = {
  'data-local': { label: 'data-local', que: 'corrió en una PC que tenía el bloque' },
  'rack-local': { label: 'rack-local', que: 'corrió en otra PC de la misma fila: el bloque viajó dentro de la fila' },
  'off-rack': { label: 'off-rack', que: 'corrió en otra fila: el bloque cruzó el aula' },
};

const ESTADO: Record<AulaTarea['estado'], string> = { ok: 'terminó', corriendo: 'corriendo', fallo: 'falló', muerta: 'la mataron', esperando: 'esperando' };

function describir(t: AulaTarea): string {
  const donde = t.bloque?.length ? `bloque en ${t.bloque.join(' y ')}` : t.tipo === 'reduce' ? 'no lee un bloque (junta lo de los maps)' : t.tipo === 'spark' ? 'Spark no dice dónde estaba el bloque' : 'sin bloque';
  const corrio = t.corrio ? `corrió en ${t.corrio}${t.rack ? ` (${t.rack})` : ''}` : 'todavía no corrió';
  const loc = t.localidad ? ` · ${t.localidad}` : t.yarn ? ` · ${t.yarn}` : '';
  const fallas = t.fallidos ? ` · ${t.fallidos} ${t.fallidos === 1 ? 'intento fallido' : 'intentos fallidos'}` : '';
  return `${t.id}: ${donde} · ${corrio}${loc} · ${ESTADO[t.estado]}${fallas}`;
}

/** enAula: los trabajos que se ven corriendo en las PCs (por si YARN todavía no los lista) */
export function Localidad({ enAula, onResalte }: { enAula: string[]; onResalte: (r: Record<string, Resalte>) => void }) {
  const [apps, setApps] = useState<YarnApp[] | null>(null);
  const [app, setApp] = useState<string>('');
  const [loc, setLoc] = useState<AulaLocalidad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [encima, setEncima] = useState<AulaTarea | null>(null);

  useEffect(() => {
    let vivo = true;
    const traer = () => api().apps().then(xs => {
      if (!vivo) return;
      const ys = xs.filter(x => x.type === 'MAPREDUCE' || x.type === 'SPARK').sort((a, b) => b.submittedAt - a.submittedAt).slice(0, 15);
      setApps(ys);
    }, () => vivo && setApps([]));
    traer();
    const i = setInterval(traer, 5000);
    return () => { vivo = false; clearInterval(i); };
  }, []);

  const opciones = [...enAula.filter(id => !(apps ?? []).some(x => x.id === id)).map(id => ({ id, label: `${id.replace(/^application_\d+_/, 'app ')} · corriendo en el aula` })),
    ...(apps ?? []).map(x => ({ id: x.id, label: `${x.id.replace(/^application_\d+_/, 'app ')} · ${x.type === 'SPARK' ? 'Spark' : 'MR'} · ${x.name}` }))];
  useEffect(() => { if (!app && opciones[0]) setApp(opciones[0].id); }, [app, opciones]);
  const corriendo = loc ? loc.estado === 'RUNNING' || loc.estado === 'ACCEPTED' : true;
  useEffect(() => {
    if (!app) return;
    let vivo = true;
    const traer = () => api().aulaLocalidad(app).then(x => { if (vivo) { setLoc(x); setError(null); } },
      e => { if (vivo) { setLoc(null); setError(e instanceof Error ? e.message : String(e)); } });
    traer();
    // Mientras corre, las tareas cambian: se vuelve a leer; cuando terminó, una vez alcanza
    const i = corriendo ? setInterval(traer, 3000) : undefined;
    return () => { vivo = false; clearInterval(i); };
  }, [app, corriendo]);

  const elegir = (t: AulaTarea | null) => { setEncima(t); onResalte(resalteDeTarea(t)); };
  useEffect(() => () => onResalte({}), [onResalte]);

  const total = loc ? loc.resumen['data-local'] + loc.resumen['rack-local'] + loc.resumen['off-rack'] : 0;
  return (
    <section className="au-card au-loc" aria-label="Dónde corrió cada tarea">
      <h3>Dónde corrió cada tarea</h3>
      {apps && !opciones.length
        ? <p className="au-nota">Todavía no corrió ningún MapReduce ni Spark. Mandá uno (por ejemplo, un π a una cola, acá abajo) y elegilo acá.</p>
        : (
          <label className="au-loc-sel">
            <span>Trabajo</span>
            <select className="input select-sm" value={app} onChange={e => { setApp(e.target.value); setLoc(null); elegir(null); }}>
              {opciones.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        )}
      {error && <p className="au-nota au-error" role="alert">{error}</p>}
      {loc && (
        <>
          {total > 0 && (
            <div className="au-loc-barra" role="img" aria-label={`${loc.resumen['data-local']} data-local, ${loc.resumen['rack-local']} rack-local, ${loc.resumen['off-rack']} off-rack`}>
              {(['data-local', 'rack-local', 'off-rack'] as const).filter(k => loc.resumen[k]).map(k => (
                <span key={k} data-l={k} style={{ flexGrow: loc.resumen[k] }}>{loc.resumen[k]} {k}</span>
              ))}
            </div>
          )}
          {loc.motivo && <p className="au-nota">{loc.motivo}{loc.fuente ? ` · leído del ${loc.fuente === 'historial' ? 'historial' : 'trabajo en curso'}` : ''}</p>}
          {loc.tareas.length > 0 && (
            <>
              <ul className="au-tareas" aria-label="Las tareas: pasá el mouse o el foco para verlas en el plano" onMouseLeave={() => elegir(null)}>
                {loc.tareas.map(t => (
                  <li key={t.id}>
                    <button type="button" className="au-tarea" data-l={t.localidad ?? 'nada'} data-e={t.estado} aria-pressed={encima?.id === t.id}
                      aria-label={describir(t)} onMouseEnter={() => elegir(t)} onFocus={() => elegir(t)} onBlur={() => elegir(null)}
                      onClick={() => elegir(encima?.id === t.id ? null : t)}>
                      {t.tipo === 'reduce' ? 'R' : t.tipo === 'spark' ? 'S' : 'M'}{Number(/(\d+)$/.exec(t.id)?.[1] ?? '')}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="au-loc-det" aria-live="polite">{encima ? describir(encima) : 'Pasá el mouse por una tarea: en el plano se marca dónde estaba su bloque y dónde corrió.'}</p>
              <ul className="au-leyenda-red">
                {(['data-local', 'rack-local', 'off-rack'] as const).map(k => <li key={k} title={LOCALIDAD[k].que}><span className="au-clase" data-l={k} />{LOCALIDAD[k].label}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
