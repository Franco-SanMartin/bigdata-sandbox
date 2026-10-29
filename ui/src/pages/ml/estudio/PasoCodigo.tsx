/* Paso 9, Código: el script completo que reproduce la corrida (POST /api/ml/code). Se puede editar y correr
   como trabajo (python3 o spark-submit, con límite de tiempo y memoria y la salida en vivo), y bajar como .py
   o como notebook .ipynb. Si lo editaste y lo corrés, queda como un experimento más ("código editado").
   También están el PySpark del perfil y el de la limpieza: scripts sueltos para spark-submit en YARN. */
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { Copy, Download, FileCode2, NotebookPen, Play, RotateCcw } from 'lucide-react';
import { api } from '../../../api';
import type { MlCatalogo, MlCodigo, MlRevision } from '../../../api/types';
import { EmptyState, GatedButton, Panel, SkeletonLines } from '../../../components/base';
import { Kbd, Seg } from '../../../components/ui';
import { useCapabilities } from '../../../state/capabilities';
import { toast } from '../../../state/ui';
import { aNotebook, bajarTexto, Campo, Numero, useCorrida } from './comun';
import { modeloDe, setEstudio, useEstudio } from './estado';
import { CorridaEnVivo } from './PasoEntrenar';

const Editor = lazy(() => import('./Editor'));

export function PasoCodigo({ cat, rev }: { cat: MlCatalogo; rev: MlRevision | null }) {
  const { parteCodigo } = useEstudio();
  const partes = (
    <Seg value={parteCodigo} onChange={v => setEstudio(e => ({ ...e, parteCodigo: v }))} label="Qué código" options={[
      { value: 'entrenamiento', label: 'entrenamiento', tip: 'El experimento entero: datos, limpieza, partición, Pipeline, modelo y métricas' },
      { value: 'perfil', label: 'perfil', tip: 'El perfil de los datos con Spark (perfil_spark.py, autónomo)' },
      { value: 'limpieza', label: 'limpieza', tip: 'La receta de limpieza sola: guarda los datos limpios y el paso Limpiar en HDFS' },
    ]} />
  );
  return parteCodigo === 'entrenamiento' ? <CodigoEntrenamiento cat={cat} rev={rev} partes={partes} /> : <CodigoParte parte={parteCodigo} partes={partes} />;
}

/** El PySpark del perfil o de la limpieza: para copiar, bajar y correr con spark-submit */
function CodigoParte({ parte, partes }: { parte: 'perfil' | 'limpieza'; partes: ReactNode }) {
  const { receta, perfil: op } = useEstudio();
  const [gen, setGen] = useState<MlCodigo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const k = JSON.stringify([parte, receta.datos, receta.objetivo, receta.limpieza, op]);
  useEffect(() => {
    let vivo = true;
    setGen(null); setError(null);
    api().mlCode(receta, parte, { modo: op.modo, filas: op.filas })
      .then(g => { if (vivo) setGen(g); }, e => { if (vivo) setError(e instanceof Error ? e.message : String(e)); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(gen?.codigo ?? ''); toast({ kind: 'ok', title: 'Código copiado' }); }
    catch { toast({ kind: 'bad', title: 'No se pudo copiar', description: 'Seleccioná el texto y usá Ctrl+C.' }); }
  };
  return (
    <div className="es-paso es-codigo">
      <Panel title={<><FileCode2 size={14} aria-hidden="true" /> <span className="mono">{gen?.archivo ?? `${parte}.py`}</span></>}
        sub={gen ? <span className="mono muted">{gen.comando}</span> : undefined}
        end={<>{partes}
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={copiar} disabled={!gen} aria-label="Copiar el código"><Copy size={14} /></button>
          <button type="button" className="btn btn-sm" disabled={!gen} onClick={() => gen && bajarTexto(gen.archivo, gen.codigo)}><Download size={13} aria-hidden="true" />.py</button>
          <button type="button" className="btn btn-sm" disabled={!gen} onClick={() => gen && bajarTexto(gen.archivo.replace(/\.py$/, '.ipynb'), aNotebook(gen.codigo), 'application/x-ipynb+json')}><NotebookPen size={13} aria-hidden="true" />.ipynb</button>
        </>} flush>
        {error ? <div className="es-pad"><EmptyState compact kind="error" title={`No se pudo generar el código ${parte === 'perfil' ? 'del perfil' : 'de la limpieza'}`}>{error}</EmptyState></div>
          : !gen ? <div className="es-pad"><SkeletonLines n={10} /></div>
          : (
            <Suspense fallback={<div className="es-pad"><SkeletonLines n={10} /></div>}>
              <Editor value={gen.codigo} label={`Código ${parte === 'perfil' ? 'del perfil' : 'de la limpieza'}`} alto="min(62vh, 640px)" onChange={() => undefined} />
            </Suspense>
          )}
        <p className="es-pad es-nota">Es un script suelto: copialo o bajalo y corrélo en la terminal con <span className="mono">{gen?.comando ?? 'spark-submit'}</span> (la app aparece en YARN). {parte === 'limpieza' ? 'Aprende con todas las filas que quedan después de lo de entrenamiento; adentro del experimento, solo con las de entrenamiento.' : 'Imprime el resumen de cada columna y deja el perfil entero en un .json.'}</p>
      </Panel>
    </div>
  );
}

function CodigoEntrenamiento({ cat, rev, partes }: { cat: MlCatalogo; rev: MlRevision | null; partes: ReactNode }) {
  const { receta, codigo: editado, corrida } = useEstudio();
  const [gen, setGen] = useState<MlCodigo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minutos, setMinutos] = useState(15);
  const [memoria, setMemoria] = useState(3072);
  const [lanzando, setLanzando] = useState(false);
  const caps = useCapabilities();
  const { corrida: c, lineas } = useCorrida(corrida);
  const motor = modeloDe(cat, receta.modelo.id)?.motor ?? 'sklearn';
  const k = JSON.stringify(receta);

  useEffect(() => {
    if (rev && rev.errores.length) { setGen(null); setError(null); return; }
    let vivo = true;
    api().mlCode(receta).then(g => { if (vivo) { setGen(g); setError(null); } }, e => { if (vivo) setError(e instanceof Error ? e.message : String(e)); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, rev?.errores.length]);

  const texto = editado ?? gen?.codigo ?? '';
  const cambiado = editado != null && gen != null && editado !== gen.codigo;
  const archivo = gen?.archivo ?? 'experimento.py';

  async function correr() {
    setLanzando(true);
    try {
      const r = cambiado || !gen
        ? await api().mlRunCode({ codigo: texto, motor, receta, minutos, memoriaMb: memoria })
        : await api().mlTrain(receta);
      setEstudio(e => ({ ...e, corrida: r.run, experimento: r.id }));
      toast({ kind: 'run', title: cambiado ? 'Corriendo el código editado' : 'Corriendo el código generado', description: `experimento ${r.id}` });
    } catch (e) {
      toast({ kind: 'bad', title: 'No se pudo correr', description: e instanceof Error ? e.message : String(e) });
    } finally { setLanzando(false); }
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(texto); toast({ kind: 'ok', title: 'Código copiado' }); }
    catch { toast({ kind: 'bad', title: 'No se pudo copiar', description: 'Seleccioná el texto y usá Ctrl+C.' }); }
  }

  if (rev && rev.errores.length && editado == null) {
    return <Panel title="Código" end={partes}><EmptyState compact kind="blocked" title="La receta tiene errores">Arreglalos (están en el paso Entrenar) y acá aparece el script que la reproduce.</EmptyState></Panel>;
  }
  const corriendo = c?.estado === 'corriendo';
  return (
    <div className="es-paso es-codigo">
      <Panel title={<><FileCode2 size={14} aria-hidden="true" /> <span className="mono">{archivo}</span></>}
        sub={cambiado ? <span className="badge" data-k="run">editado</span> : gen ? <span className="mono muted">receta {gen.huella} · {gen.comando}</span> : undefined}
        end={<>
          {partes}
          {cambiado && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEstudio(e => ({ ...e, codigo: null }))}><RotateCcw size={13} aria-hidden="true" />Volver al generado</button>}
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={copiar} aria-label="Copiar el código"><Copy size={14} /></button>
          <button type="button" className="btn btn-sm" onClick={() => bajarTexto(archivo, texto)}><Download size={13} aria-hidden="true" />.py</button>
          <button type="button" className="btn btn-sm" onClick={() => bajarTexto(archivo.replace(/\.py$/, '.ipynb'), aNotebook(texto), 'application/x-ipynb+json')}><NotebookPen size={13} aria-hidden="true" />.ipynb</button>
        </>} flush>
        {error ? <div className="es-pad"><EmptyState compact kind="error" title="No se pudo generar el código">{error}</EmptyState></div>
          : !texto ? <div className="es-pad"><SkeletonLines n={10} /></div>
          : (
            <Suspense fallback={<div className="es-pad"><SkeletonLines n={10} /></div>}>
              <Editor value={texto} label="Código del experimento" alto="min(62vh, 640px)" onRun={correr}
                onChange={v => setEstudio(e => ({ ...e, codigo: gen && v === gen.codigo ? null : v }))} />
            </Suspense>
          )}
        <div className="es-runbar">
          <Campo label="Tiempo máximo" nota="minutos"><Numero value={minutos} onChange={v => v != null && setMinutos(Math.round(v))} min={1} max={120} label="Minutos" ancho={70} /></Campo>
          <Campo label="Memoria máxima" nota="MB (se corta si la pasa)"><Numero value={memoria} onChange={v => v != null && setMemoria(Math.round(v))} min={512} max={16384} label="Memoria máxima" ancho={90} /></Campo>
          <span className="muted es-runmotor">{motor === 'spark' ? 'spark-submit --master yarn' : 'python3'} · <Kbd k="Ctrl+Enter" /> corre</span>
          <GatedButton cap={motor === 'spark' ? caps['ml.mllib'] : caps['ml.sklearn']} className="btn btn-primary" onClick={correr} busy={lanzando}
            blockedBy={corriendo ? 'Ya hay una corrida en curso' : !texto ? 'Todavía no hay código' : null}>
            <Play size={13} aria-hidden="true" />{cambiado ? 'Correr el código editado' : 'Correr'}
          </GatedButton>
        </div>
      </Panel>
      {c && <CorridaEnVivo c={c} lineas={lineas} />}
    </div>
  );
}
