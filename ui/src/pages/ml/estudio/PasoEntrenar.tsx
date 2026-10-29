/* Paso 6, Entrenar: la receta en una lectura, lo que falta arreglar y la corrida en vivo (avance, cada
   entrenamiento de la búsqueda, memoria contra el límite, salida del script y cancelar). Lo que corre es
   el script del paso Código, tal cual. */
import { useState } from 'react';
import { ExternalLink, Play, Square } from 'lucide-react';
import { api } from '../../../api';
import type { MlCatalogo, MlCorrida, MlLinea, MlRevision } from '../../../api/types';
import { EmptyState, GatedButton, KeyValue, Panel } from '../../../components/base';
import { Meter } from '../../../components/ui';
import { useCapabilities } from '../../../state/capabilities';
import { toast } from '../../../state/ui';
import { Avisos, Consola, useCorrida } from './comun';
import { fmtMb, irA, modeloDe, PASO_LABEL, setEstudio, textoValor, useEstudio } from './estado';

export function PasoEntrenar({ cat, rev, revError }: { cat: MlCatalogo; rev: MlRevision | null; revError?: string | null }) {
  const { receta, corrida } = useEstudio();
  const { corrida: c, lineas } = useCorrida(corrida);
  const caps = useCapabilities();
  const [lanzando, setLanzando] = useState(false);
  const r = rev?.receta;
  const modelo = modeloDe(cat, receta.modelo.id);
  const spark = modelo?.motor === 'spark';
  const cap = spark ? caps['ml.mllib'] : caps['ml.sklearn'];

  async function entrenar() {
    setLanzando(true);
    try {
      const { id, run } = await api().mlTrain(receta);
      setEstudio(e => ({ ...e, corrida: run, experimento: id }));
      toast({ kind: 'run', title: 'Entrenando', description: `${modelo?.etiqueta} · experimento ${id}` });
    } catch (e) {
      toast({ kind: 'bad', title: 'No se pudo entrenar', description: e instanceof Error ? e.message : String(e) });
    } finally { setLanzando(false); }
  }

  const corriendo = c?.estado === 'corriendo';
  return (
    <div className="es-paso es-entrenar">
      <Panel title="La receta" sub={rev?.huella ? <span className="mono">receta {rev.huella}</span> : undefined}
        end={<GatedButton cap={cap} className="btn btn-primary" onClick={entrenar} busy={lanzando}
          blockedBy={corriendo ? 'Ya hay una corrida en curso' : !rev ? (revError ? 'No se pudo revisar la receta' : 'Revisando la receta…') : rev.errores.length ? `Arreglá ${rev.errores.length} error${rev.errores.length > 1 ? 'es' : ''} antes de entrenar` : null}>
          <Play size={13} aria-hidden="true" />Entrenar</GatedButton>}>
        {r && modelo ? (
          <KeyValue items={[
            ['datos', <span className="mono">{r.datos.ruta ?? r.datos.tabla}{r.datos.limite ? ` · ${r.datos.limite.toLocaleString('es-AR')} filas` : ''}</span>],
            ['problema', `${cat.tareas[r.tarea].etiqueta}${r.objetivo ? ` de ${r.objetivo}` : ''}`],
            ['variables', variablesTexto(r.columnas, r.objetivo)],
            ['preprocesamiento', preTexto(r)],
            ['modelo', <><b>{modelo.etiqueta}</b> <span className="mono muted">{modelo.clase}</span> · {spark ? 'Spark MLlib en YARN' : 'scikit-learn, en una máquina'}</>],
            ['hiperparámetros', <span className="mono es-hpres">{Object.entries(r.modelo.params).map(([k, v]) => `${k}=${textoValor(modelo.params.find(p => p.nombre === k), v)}`).join(' · ') || 'los de por defecto'}</span>],
            ...(r.tarea === 'regresion' || r.tarea === 'clasificacion' ? [
              ['validación', `${cat.particiones[r.validacion.particion]?.etiqueta} (${Math.round(r.validacion.prueba * 100)} % prueba${r.validacion.validacion ? `, ${Math.round(r.validacion.validacion * 100)} % validación` : ''}) · ${cat.cv[r.validacion.cv]?.etiqueta}${r.validacion.cv !== 'ninguna' ? ` (${r.validacion.k}${r.validacion.cv === 'repetida' ? `×${r.validacion.repeticiones}` : ''})` : ''} · semilla ${r.validacion.semilla}`],
              ['búsqueda', r.busqueda.tipo === 'ninguna' ? 'ninguna' : `${cat.busquedas[r.motor][r.busqueda.tipo]?.etiqueta}: ${r.busqueda.candidatos} combinaciones, ${r.busqueda.ajustes} entrenamientos, hasta ${r.busqueda.max_minutos} min`],
            ] as [string, string][] : []),
            ['métrica principal', cat.metricas[r.validacion.metrica]?.etiqueta ?? r.validacion.metrica],
          ]} />
        ) : revError ? <EmptyState compact kind="error" title="No se pudo revisar la receta">{revError}</EmptyState>
          : <p className="muted">Revisando la receta…</p>}
        <Avisos rev={rev} vacio={rev && <p className="es-ok">La receta está completa. Lo que corre es exactamente el script del paso Código.</p>} />
        <p className="es-nota">¿Falta algo? Volvé a {(['datos', 'objetivo', 'preproceso', 'modelo', 'validacion'] as const).map((p, i) => <span key={p}>{i ? ', ' : ''}<button type="button" className="es-link" onClick={() => irA(p)}>{PASO_LABEL[p]}</button></span>)}.</p>
      </Panel>

      {c && <CorridaEnVivo c={c} lineas={lineas} />}
    </div>
  );
}

function variablesTexto(cols: Record<string, string>, objetivo: string | null): string {
  const cuenta: Record<string, number> = {};
  for (const [c, r] of Object.entries(cols)) if (c !== objetivo && r !== 'ignorar' && r !== 'id') cuenta[r] = (cuenta[r] ?? 0) + 1;
  const total = Object.values(cuenta).reduce((a, b) => a + b, 0);
  return `${total}: ` + Object.entries(cuenta).map(([r, n]) => `${n} ${r === 'numerica' ? 'numéricas' : r === 'categorica' ? 'categóricas' : r === 'fecha' ? 'fechas' : 'de texto'}`).join(', ');
}

function preTexto(r: NonNullable<MlRevision['receta']>): string {
  const p = r.preproceso;
  const out = [`vacíos: ${p.imputar_num}`, p.outliers !== 'ninguno' ? `extremos: ${p.outliers.replace('_', ' ')}` : null, `escalado: ${p.escalar}`, `categóricas: ${p.codificar}`,
    p.seleccion !== 'ninguna' ? `selección: ${p.seleccion}` : null, p.pca != null ? `PCA(${p.pca})` : null];
  return out.filter(Boolean).join(' · ');
}

export function CorridaEnVivo({ c, lineas, alto = 320 }: { c: MlCorrida; lineas: MlLinea[]; alto?: number }) {
  const [cancelando, setCancelando] = useState(false);
  const corriendo = c.estado === 'corriendo';
  const seg = Math.round(((c.fin ?? Date.now()) - c.inicio) / 1000);
  async function cancelar() {
    setCancelando(true);
    try { await api().mlCancel(c.id); } catch (e) { toast({ kind: 'bad', title: 'No se pudo cancelar', description: e instanceof Error ? e.message : String(e) }); }
    finally { setCancelando(false); }
  }
  return (
    <Panel title={c.titulo} sub={<span className="mono">{c.experimento}</span>}
      end={<>
        <span className="badge" data-k={c.estado === 'listo' ? 'ok' : c.estado === 'falló' ? 'bad' : 'run'}>{corriendo ? `${Math.round(c.progreso * 100)} %` : c.estado}</span>
        {corriendo && <button type="button" className="btn btn-sm" onClick={cancelar} disabled={cancelando}><Square size={12} aria-hidden="true" />Cancelar</button>}
        {c.estado === 'listo' && <button type="button" className="btn btn-sm btn-primary" onClick={() => setEstudio(e => ({ ...e, paso: 'resultados', experimento: c.experimento }))}>Ver resultados</button>}
      </>}>
      <div className="es-vivo" aria-live="polite">
        <Meter value={c.progreso * 100} max={100} kind={c.estado === 'falló' ? 'bad' : corriendo ? 'run' : 'ok'} label="Avance de la corrida" />
        <div className="es-vivo-datos">
          <span>{c.estado === 'falló' ? <b className="es-cerr">{c.error ?? c.mensaje}</b> : c.mensaje}</span>
          {c.ajustes && c.ajustes.total > 0 && <span className="mono">búsqueda: {c.ajustes.hechos}/{c.ajustes.total} entrenamientos{c.ajustes.ultimo != null ? ` · último ${c.ajustes.ultimo}` : ''}</span>}
          <span className="mono">{seg} s de {c.limites.minutos} min</span>
          {c.memoriaMb != null && <span className="mono" title="Memoria del proceso y sus hijos (joblib, la JVM del driver)">memoria {fmtMb(c.memoriaMb)} (pico {fmtMb(c.memoriaPicoMb)}) de {fmtMb(c.limites.memoriaMb)}</span>}
          {c.appId && <a className="mono" href={`#yarn/${c.appId}`}>{c.appId} <ExternalLink size={11} aria-hidden="true" /></a>}
        </div>
        {c.ajustes && c.ajustes.total > 0 && <Meter value={c.ajustes.hechos} max={c.ajustes.total} kind="run" label="Entrenamientos de la búsqueda" />}
        <Consola lineas={lineas} alto={alto} vacio={corriendo ? 'Arrancando…' : undefined} />
        {c.comando && <p className="es-nota mono">{c.comando}</p>}
      </div>
    </Panel>
  );
}
