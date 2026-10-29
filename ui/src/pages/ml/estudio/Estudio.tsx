/* El estudio de ML: un riel con los ocho pasos (Datos → Objetivo y variables → Preprocesamiento → Modelo e
   hiperparámetros → Validación y búsqueda → Entrenar → Resultados → Código), el paso abierto en el centro y,
   a la derecha, la receta en una lectura con lo que falta arreglar. */
import { useEffect } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleAlert, Play } from 'lucide-react';
import type { MlCatalogo, MlRevision } from '../../../api/types';
import { EmptyState, Panel, SkeletonLines } from '../../../components/base';
import { Meter } from '../../../components/ui';
import { useApi } from '../../../state/useApi';
import { useCorrida, usePerfil, useRevision } from './comun';
import { editar, irA, modeloDe, PASO_LABEL, PASOS, recetaParaDatos, setEstudio, useEstudio, type Paso } from './estado';
import { PasoCodigo } from './PasoCodigo';
import { PasoDatos } from './PasoDatos';
import { PasoEntrenar } from './PasoEntrenar';
import { PasoModelo } from './PasoModelo';
import { PasoObjetivo } from './PasoObjetivo';
import { PasoPreproceso } from './PasoPreproceso';
import { PasoValidacion } from './PasoValidacion';
import { Resultados } from './Resultados';

/** Qué campos de la receta corresponden a cada paso (para marcar errores en el riel) */
const CAMPOS: Partial<Record<Paso, string[]>> = {
  datos: ['datos'], objetivo: ['objetivo', 'tarea', 'columnas', 'referencia'], preproceso: ['preproceso'],
  modelo: ['modelo'], validacion: ['validacion', 'busqueda', 'informe'],
};

function problemas(rev: MlRevision | null, paso: Paso): { errores: number; avisos: number } {
  const pre = CAMPOS[paso];
  if (!rev || !pre) return { errores: 0, avisos: 0 };
  const toca = (c: string) => pre.some(p => c === p || c.startsWith(p + '.'));
  return { errores: rev.errores.filter(e => toca(e.campo)).length, avisos: rev.avisos.filter(a => toca(a.campo) && a.tipo !== 'info').length };
}

export function Estudio({ cat }: { cat: MlCatalogo }) {
  const { paso, receta, corrida, experimento } = useEstudio();
  const { rev, error: revError } = useRevision(receta);
  const { corrida: c } = useCorrida(corrida);
  const i = PASOS.indexOf(paso);
  const modelo = modeloDe(cat, receta.modelo.id);
  // La primera vez (o con una receta vieja sin roles): los roles que sugiere el perfil de los datos
  const sinRoles = Object.keys(receta.columnas).length === 0;
  const perfil = usePerfil(sinRoles ? receta.datos : null, null);
  useEffect(() => {
    if (sinRoles && perfil.data) editar(r => (Object.keys(r.columnas).length ? r : recetaParaDatos(r, perfil.data!)));
  }, [sinRoles, perfil.data]);

  return (
    <div className="es-estudio">
      <nav className="es-riel" aria-label="Pasos del estudio">
        <ol>
          {PASOS.map((p, n) => {
            const pr = problemas(rev, p);
            const estado = pr.errores ? 'error' : n < i ? 'hecho' : undefined;
            return (
              <li key={p}>
                <button type="button" aria-current={p === paso ? 'step' : undefined} data-estado={estado} onClick={() => irA(p)}>
                  <span className="es-rn" aria-hidden="true">{pr.errores ? <CircleAlert size={13} /> : n < i ? <Check size={13} /> : n + 1}</span>
                  <span className="es-rt">{PASO_LABEL[p]}</span>
                  {pr.errores > 0 && <span className="badge-count" data-k="bad" aria-label={`${pr.errores} errores`}>{pr.errores}</span>}
                  {!pr.errores && pr.avisos > 0 && <span className="badge-count" data-k="run" aria-label={`${pr.avisos} avisos`}>{pr.avisos}</span>}
                  {p === 'entrenar' && c?.estado === 'corriendo' && <span className="es-rlive">{Math.round(c.progreso * 100)} %</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="es-riel-res" aria-label="La receta">
          <span className="muted">receta</span>
          <b>{modelo?.etiqueta ?? receta.modelo.id}</b>
          <span className="mono">{(receta.datos.ruta ?? receta.datos.tabla ?? '').split('/').pop()}{receta.objetivo ? ` → ${receta.objetivo}` : ''}</span>
          <span>{cat.tareas[receta.tarea].etiqueta} · {modelo?.motor === 'spark' ? 'Spark MLlib' : 'scikit-learn'}</span>
          {revError && <span className="es-cerr" role="alert">No se pudo revisar la receta (POST /api/ml/check): {revError}</span>}
          {rev && (rev.errores.length
            ? <span className="es-cerr">{rev.errores.length} error{rev.errores.length > 1 ? 'es' : ''} para arreglar</span>
            : <span className="es-ok">lista para entrenar{rev.huella && <span className="mono muted"> · {rev.huella}</span>}</span>)}
          {c?.estado === 'corriendo' && <Meter value={c.progreso * 100} max={100} kind="run" label="Avance de la corrida" />}
          {paso !== 'entrenar' && (
            <button type="button" className="btn btn-sm btn-primary" disabled={!rev || rev.errores.length > 0} onClick={() => irA('entrenar')}><Play size={12} aria-hidden="true" />Ir a entrenar</button>
          )}
        </div>
      </nav>

      <div className="es-centro">
        {paso === 'datos' && <PasoDatos />}
        {paso === 'objetivo' && <PasoObjetivo cat={cat} rev={rev} />}
        {paso === 'preproceso' && <PasoPreproceso cat={cat} rev={rev} />}
        {paso === 'modelo' && <PasoModelo cat={cat} rev={rev} />}
        {paso === 'validacion' && <PasoValidacion cat={cat} rev={rev} />}
        {paso === 'entrenar' && <PasoEntrenar cat={cat} rev={rev} revError={revError} />}
        {paso === 'resultados' && <UltimoResultado cat={cat} id={experimento} />}
        {paso === 'codigo' && <PasoCodigo cat={cat} rev={rev} />}
        <div className="es-nav">
          {i > 0 && <button type="button" className="btn" onClick={() => irA(PASOS[i - 1])}><ChevronLeft size={14} aria-hidden="true" />{PASO_LABEL[PASOS[i - 1]]}</button>}
          {i < PASOS.length - 1 && <button type="button" className="btn" onClick={() => irA(PASOS[i + 1])}>{PASO_LABEL[PASOS[i + 1]]}<ChevronRight size={14} aria-hidden="true" /></button>}
        </div>
      </div>
    </div>
  );
}

function UltimoResultado({ cat, id }: { cat: MlCatalogo; id: string | null }) {
  const exp = useApi(a => (id ? a.mlExperiment(id) : Promise.resolve(null)), [id], e => e.type === 'mlrun' && e.run.experimento === id && e.run.estado !== 'corriendo');
  const lista = useApi(a => (id ? Promise.resolve([]) : a.mlExperiments()), [id]);
  if (!id) {
    const ultimo = lista.data?.find(f => f.estado === 'listo');
    return (
      <Panel title="Resultados">
        <EmptyState compact title="Todavía no entrenaste nada desde el estudio"
          actions={<>
            <button type="button" className="btn btn-primary" onClick={() => irA('entrenar')}>Ir a entrenar</button>
            {ultimo && <button type="button" className="btn" onClick={() => setEstudio(e => ({ ...e, experimento: ultimo.id }))}>Ver el último experimento ({ultimo.modeloEtiqueta})</button>}
          </>}>
          Acá aparecen las métricas con su desvío y los gráficos del último experimento.
        </EmptyState>
      </Panel>
    );
  }
  if (exp.error) return <Panel title="Resultados"><EmptyState compact kind="error" title="No se pudo abrir el experimento">{exp.error}</EmptyState></Panel>;
  if (!exp.data) return <Panel title="Resultados"><SkeletonLines n={8} /></Panel>;
  return <Resultados exp={exp.data} cat={cat} acciones={<a className="btn btn-sm" href={`#ml/experimentos/${id}`}>Abrir en Experimentos</a>} />;
}
