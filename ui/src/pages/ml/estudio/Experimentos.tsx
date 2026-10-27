/* Experimentos: cada corrida queda guardada en el volumen (/hadoop/ml/experimentos). Tabla de posiciones por
   la métrica principal, comparación lado a lado (métricas, hiperparámetros, validación, costo y curvas
   superpuestas) y el detalle de cada uno con su código, descargas y predicción sobre filas nuevas. */
import { Suspense, lazy, useMemo, useState } from 'react';
import { ArrowLeft, Columns3, Download, FlaskConical, NotebookPen, Pencil, Trash2, Wand2 } from 'lucide-react';
import { api } from '../../../api';
import type { MlCatalogo, MlExperimento, MlExperimentoFila, MlPrediccion, MlTarea, MlValor } from '../../../api/types';
import { EmptyState, Panel, ResultTable, SkeletonLines } from '../../../components/base';
import { Seg } from '../../../components/ui';
import { confirm, navigate, toast } from '../../../state/ui';
import { useApi } from '../../../state/useApi';
import { Consola } from './comun';
import { fmtBytes, fmtMb, fmtMetrica, fmtSeg, modeloDe, setEstudio, textoValor } from './estado';
import { Lineas, SERIE } from './graficos';
import { Resultados } from './Resultados';

const Editor = lazy(() => import('./Editor'));
const ESTADO: Record<string, 'ok' | 'bad' | 'run' | undefined> = { listo: 'ok', 'falló': 'bad', corriendo: 'run', 'sin informe': undefined };

export function Experimentos({ cat, arg }: { cat: MlCatalogo; arg: string[] }) {
  const lista = useApi(a => a.mlExperiments(), [], e => e.type === 'mlrun' && e.run.estado !== 'corriendo');
  if (arg[0] === 'comparar') return <Comparar cat={cat} ids={(arg[1] ?? '').split(',').filter(Boolean)} />;
  if (arg[0]) return <Detalle cat={cat} id={arg[0]} onBorrado={lista.reload} />;
  return <Tabla cat={cat} filas={lista.data} cargando={lista.loading} error={lista.error} />;
}

function Tabla({ cat, filas, cargando, error }: { cat: MlCatalogo; filas?: MlExperimentoFila[]; cargando: boolean; error: string | null }) {
  const [tarea, setTarea] = useState<MlTarea | 'todas'>('todas');
  const [buscar, setBuscar] = useState('');
  const [marcados, setMarcados] = useState<string[]>([]);
  const tareas = useMemo(() => [...new Set((filas ?? []).map(f => f.tarea).filter(Boolean))] as MlTarea[], [filas]);
  const vistas = useMemo(() => {
    let l = (filas ?? []).filter(f => tarea === 'todas' || f.tarea === tarea);
    const b = buscar.trim().toLowerCase();
    if (b) l = l.filter(f => [f.id, f.nombre, f.modeloEtiqueta, f.fuente, f.objetivo].some(x => x?.toLowerCase().includes(b)));
    // Posiciones: por la métrica principal (con su sentido); lo que no terminó va al final
    return l.slice().sort((a, b) => {
      const va = a.valor, vb = b.valor;
      if (va == null || vb == null) return va == null ? (vb == null ? b.creado.localeCompare(a.creado) : 1) : -1;
      const mayor = cat.metricas[a.metrica ?? '']?.mayor_mejor ?? true;
      if (a.metrica !== b.metrica) return b.creado.localeCompare(a.creado);
      return mayor ? vb - va : va - vb;
    });
  }, [filas, tarea, buscar, cat]);
  const marcar = (id: string) => setMarcados(m => (m.includes(id) ? m.filter(x => x !== id) : [...m, id].slice(-4)));

  if (error) return <Panel title="Experimentos"><EmptyState compact kind="error" title="No se pudieron leer los experimentos">{error}</EmptyState></Panel>;
  if (!filas) return <Panel title="Experimentos">{cargando ? <SkeletonLines n={6} /> : null}</Panel>;
  if (!filas.length) {
    return (
      <Panel title="Experimentos">
        <EmptyState icon={<FlaskConical size={20} aria-hidden="true" />} title="Todavía no hay experimentos"
          actions={<button type="button" className="btn btn-primary" onClick={() => navigate('ml', '')}>Ir al estudio</button>}>
          Cada entrenamiento del estudio (o código que corras desde ahí) queda acá, guardado en el volumen, con sus métricas, su código y su modelo.
        </EmptyState>
      </Panel>
    );
  }
  let puesto = 0;
  return (
    <Panel title="Tabla de posiciones" sub={`${filas.length} experimentos en /hadoop/ml/experimentos`} flush
      end={<>
        <input className="input es-buscar" placeholder="Buscar" value={buscar} onChange={e => setBuscar(e.target.value)} aria-label="Buscar experimentos" />
        <button type="button" className="btn btn-sm btn-primary" disabled={marcados.length < 2} onClick={() => navigate('ml', `experimentos/comparar/${marcados.join(',')}`)}>
          <Columns3 size={13} aria-hidden="true" />Comparar{marcados.length ? ` (${marcados.length})` : ''}
        </button>
      </>}>
      <div className="es-fbar">
        <Seg value={tarea} onChange={setTarea} label="Tipo de problema" options={[{ value: 'todas', label: 'todos' }, ...tareas.map(t => ({ value: t, label: cat.tareas[t].etiqueta }))]} />
        <span className="muted">{marcados.length ? `${marcados.length} marcados para comparar (hasta 4)` : 'Marcá 2 a 4 para compararlos lado a lado'}</span>
      </div>
      <div className="tbl-wrap">
        <table className="tbl es-lb" aria-label="Experimentos">
          <thead><tr>
            <th aria-label="Comparar" /><th className="r">#</th><th>experimento</th><th>modelo</th><th>datos</th><th>métrica principal</th>
            <th className="r">CV ± desvío</th><th className="r">prueba</th><th className="r">tiempo</th><th className="r">memoria</th><th className="r">modelo</th><th>estado</th>
          </tr></thead>
          <tbody>
            {vistas.map(f => {
              const p = f.valor != null ? ++puesto : null;
              return (
                <tr key={f.id} onClick={() => navigate('ml', `experimentos/${f.id}`)} className="es-lbf">
                  <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={marcados.includes(f.id)} onChange={() => marcar(f.id)} aria-label={`Comparar ${f.id}`} /></td>
                  <td className="r mono">{p ?? '—'}</td>
                  <td><span className="mono">{f.id.replace(/^exp-/, '')}</span>{f.nombre && <span className="es-lbn">{f.nombre}</span>}{f.editado && <span className="tag">editado</span>}</td>
                  <td><b>{f.modeloEtiqueta ?? '—'}</b> <span className={f.motor === 'spark' ? 'eng eng-spark' : 'eng eng-uno'}>{f.motor === 'spark' ? 'MLlib' : 'sklearn'}</span>{f.busqueda && f.busqueda !== 'ninguna' && <span className="tag">{f.busqueda}</span>}</td>
                  <td className="mono muted es-lbd" title={`${f.fuente ?? ''}${f.hashDatos ? ` · hash ${f.hashDatos}` : ''}`}>{(f.fuente ?? '').split('/').pop()}{f.objetivo ? ` → ${f.objetivo}` : ''}</td>
                  <td>{f.metrica ? cat.metricas[f.metrica]?.etiqueta ?? f.metrica : '—'}</td>
                  <td className="r mono">{f.cv != null ? <>{fmtMetrica(f.cv)} <span className="muted">± {fmtMetrica(f.desvio, 3)}</span></> : '—'}</td>
                  <td className="r mono">{fmtMetrica(f.prueba)}</td>
                  <td className="r mono">{fmtSeg(f.segundos)}</td>
                  <td className="r mono">{fmtMb(f.memoriaMb)}</td>
                  <td className="r mono">{fmtBytes(f.modeloBytes)}</td>
                  <td><span className="badge" data-k={ESTADO[f.estado]}>{f.estado}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Detalle({ cat, id, onBorrado }: { cat: MlCatalogo; id: string; onBorrado: () => void }) {
  const exp = useApi(a => a.mlExperiment(id), [id], e => e.type === 'mlrun' && e.run.experimento === id && e.run.estado !== 'corriendo');
  const [vista, setVista] = useState<'resultados' | 'codigo' | 'predecir' | 'salida'>('resultados');
  const codigo = useApi(a => (vista === 'codigo' ? a.mlDownload(id, 'py').then(d => fetchTexto(d.url)) : Promise.resolve(null)), [id, vista]);
  const salida = useApi(a => (vista === 'salida' ? a.mlDownload(id, 'log').then(d => fetchTexto(d.url)) : Promise.resolve(null)), [id, vista]);
  if (exp.error) return <Panel title={id}><EmptyState compact kind="error" title="No se pudo abrir">{exp.error}</EmptyState></Panel>;
  if (!exp.data) return <Panel title={id}><SkeletonLines n={8} /></Panel>;
  const e = exp.data;

  async function bajar(formato: 'py' | 'ipynb' | 'modelo' | 'log') {
    const d = await api().mlDownload(id, formato);
    const a = document.createElement('a'); a.href = d.url; a.download = d.name; document.body.appendChild(a); a.click(); a.remove();
  }
  async function jupyter() {
    try {
      const r = await api().mlToJupyter(id);
      toast({ kind: 'ok', title: `Notebook en ${r.ruta}`, description: r.jupyter ? 'Se abre en JupyterLab (puerto 8888).' : 'JupyterLab no está prendido: prendelo desde Cluster (JUPYTER=si).' });
      if (r.jupyter) window.open(r.url, '_blank', 'noopener');
    } catch (err) { toast({ kind: 'bad', title: 'No se pudo copiar el notebook', description: err instanceof Error ? err.message : String(err) }); }
  }
  async function borrar() {
    const ok = await confirm({ title: `Borrar ${id}`, danger: true, confirmLabel: 'Borrar', description: 'Se borra la carpeta del experimento (código, modelo, informe y salida). No se puede deshacer.' });
    if (!ok) return;
    try { await api().mlDeleteExperiment(id); onBorrado(); navigate('ml', 'experimentos'); toast({ kind: 'ok', title: 'Experimento borrado' }); }
    catch (err) { toast({ kind: 'bad', title: 'No se pudo borrar', description: err instanceof Error ? err.message : String(err) }); }
  }
  async function alEstudio(conCodigo: boolean) {
    if (!e.receta) return;
    const texto = conCodigo ? await api().mlDownload(id, 'py').then(d => fetchTexto(d.url)) : null;
    const { motor: _m, version: _v, ...receta } = e.receta;
    void _m; void _v;
    setEstudio(s => ({ ...s, receta, codigo: texto, paso: conCodigo ? 'codigo' : 'datos', experimento: id }));
    navigate('ml', '');
  }

  return (
    <div className="es-detalle">
      <div className="es-det-bar">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('ml', 'experimentos')}><ArrowLeft size={13} aria-hidden="true" />Experimentos</button>
        <Seg value={vista} onChange={setVista} label="Vista del experimento" options={[
          { value: 'resultados', label: 'resultados' }, { value: 'codigo', label: 'código' },
          { value: 'predecir', label: 'predecir', disabled: e.estado !== 'listo' }, { value: 'salida', label: 'salida' },
        ]} />
        <span className="es-det-acc">
          {e.receta && <button type="button" className="btn btn-sm" onClick={() => alEstudio(false)}><Wand2 size={13} aria-hidden="true" />Abrir la receta</button>}
          {e.receta && <button type="button" className="btn btn-sm" onClick={() => alEstudio(true)}><Pencil size={13} aria-hidden="true" />Editar el código</button>}
          <button type="button" className="btn btn-sm" onClick={() => bajar('py')}><Download size={13} aria-hidden="true" />.py</button>
          <button type="button" className="btn btn-sm" onClick={() => bajar('ipynb')}><Download size={13} aria-hidden="true" />.ipynb</button>
          {e.artefactos?.includes('modelo.joblib') && <button type="button" className="btn btn-sm" onClick={() => bajar('modelo')}><Download size={13} aria-hidden="true" />modelo</button>}
          <button type="button" className="btn btn-sm" onClick={jupyter}><NotebookPen size={13} aria-hidden="true" />JupyterLab</button>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={borrar} aria-label="Borrar el experimento"><Trash2 size={14} /></button>
        </span>
      </div>
      {vista === 'resultados' && <Resultados exp={e} cat={cat} />}
      {vista === 'codigo' && (
        <Panel title={<span className="mono">{id}.py</span>} sub={e.editado ? 'código editado a mano' : 'generado por el estudio'} flush>
          {codigo.data == null ? <div className="es-pad"><SkeletonLines n={10} /></div>
            : <Suspense fallback={<div className="es-pad"><SkeletonLines n={10} /></div>}><Editor value={codigo.data} readOnly label={`Código de ${id}`} alto="min(70vh, 720px)" /></Suspense>}
        </Panel>
      )}
      {vista === 'predecir' && <Predecir exp={e} cat={cat} />}
      {vista === 'salida' && (
        <Panel title="Salida de la corrida" sub="salida.log" flush>
          <div className="es-pad"><Consola lineas={(salida.data ?? '').split('\n').map((t, n) => ({ n, stream: 'out', texto: t }))} alto={560} vacio={salida.loading ? 'Cargando…' : 'Sin salida guardada'} /></div>
        </Panel>
      )}
    </div>
  );
}

async function fetchTexto(url: string): Promise<string> {
  if (url.startsWith('data:')) return decodeURIComponent(url.split(',', 2)[1]);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}

function Predecir({ exp, cat }: { exp: MlExperimento; cat: MlCatalogo }) {
  const vars = exp.variables ?? { numerica: [], categorica: [], fecha: [], texto: [] };
  const todas = [...vars.numerica, ...vars.categorica, ...vars.fecha, ...vars.texto];
  const ejemplo = exp.informe?.ejemplos;
  const inicial = () => Object.fromEntries(todas.map(c => {
    const j = ejemplo?.columnas.indexOf(c) ?? -1;
    return [c, j >= 0 && ejemplo ? String(ejemplo.filas[0]?.[j] ?? '') : ''];
  }));
  const [fila, setFila] = useState<Record<string, string>>(inicial);
  const [archivo, setArchivo] = useState('');
  const [res, setRes] = useState<MlPrediccion | null>(null);
  const [cargando, setCargando] = useState(false);
  async function predecir(body: { filas?: Record<string, unknown>[]; archivo?: string }) {
    setCargando(true);
    try { setRes(await api().mlPredict(exp.id, body)); }
    catch (e) { toast({ kind: 'bad', title: 'No se pudo predecir', description: e instanceof Error ? e.message : String(e) }); }
    finally { setCargando(false); }
  }
  const convertir = (c: string, v: string): MlValor => (vars.numerica.includes(c) ? (v.trim() === '' ? null : Number(v.replace(',', '.'))) : v === '' ? null : v);
  return (
    <div className="es-graf-grid">
      <Panel title="Una fila a mano" sub={`${exp.modelo?.etiqueta} · ${cat.tareas[exp.tarea ?? 'clasificacion']?.etiqueta.toLowerCase()}`}>
        <div className="es-pred-form">
          {todas.map(c => (
            <label key={c} className="es-campo"><span className="es-cl"><span className="mono">{c}</span><span className="muted">{vars.numerica.includes(c) ? 'número' : vars.fecha.includes(c) ? 'fecha' : 'texto'}</span></span>
              <input className="input mono" value={fila[c] ?? ''} onChange={e => setFila(f => ({ ...f, [c]: e.target.value }))} inputMode={vars.numerica.includes(c) ? 'decimal' : undefined} /></label>
          ))}
        </div>
        <button type="button" className="btn btn-primary" disabled={cargando} onClick={() => predecir({ filas: [Object.fromEntries(todas.map(c => [c, convertir(c, fila[c] ?? '')]))] })}>Predecir</button>
      </Panel>
      <Panel title="Un archivo entero" sub="un CSV o Parquet de /datos con las mismas columnas">
        <div className="es-form">
          <label className="es-campo"><span className="es-cl">Ruta</span><input className="input mono" placeholder="/datos/nuevos.csv" value={archivo} onChange={e => setArchivo(e.target.value)} /></label>
          <button type="button" className="btn" disabled={cargando || !archivo.startsWith('/')} onClick={() => predecir({ archivo })}>Predecir el archivo</button>
          <p className="es-nota">Deja <span className="mono">&lt;archivo&gt;_predicciones.csv</span> al lado, con la predicción y las probabilidades de cada clase.</p>
        </div>
      </Panel>
      {res && (
        <Panel title="Predicciones" sub={`${res.filas.toLocaleString('es-AR')} filas${res.archivo ? ` → ${res.archivo}` : ''}`} flush>
          <ResultTable columns={res.columnas} rows={res.muestra} total={res.filas} label="Predicciones" fileName={`${exp.id}-predicciones`} maxHeight={320} />
        </Panel>
      )}
    </div>
  );
}

function Comparar({ cat, ids }: { cat: MlCatalogo; ids: string[] }) {
  const exps = useApi(a => Promise.all(ids.map(id => a.mlExperiment(id))), [ids.join(',')]);
  if (exps.error) return <Panel title="Comparar"><EmptyState compact kind="error" title="No se pudieron abrir">{exps.error}</EmptyState></Panel>;
  if (!exps.data) return <Panel title="Comparar"><SkeletonLines n={8} /></Panel>;
  const es = exps.data;
  const metricas = [...new Set(es.flatMap(e => Object.keys(e.metricas)))];
  const params = [...new Set(es.flatMap(e => Object.keys(e.modelo?.params ?? {})))];
  const distinto = (vals: unknown[]) => new Set(vals.map(v => JSON.stringify(v))).size > 1;
  const fila = (etiqueta: React.ReactNode, vals: React.ReactNode[], raw?: unknown[]) => (
    <tr data-distinto={raw && distinto(raw) || undefined}><th scope="row">{etiqueta}</th>{vals.map((v, i) => <td key={i} className="mono">{v}</td>)}</tr>
  );
  const mejor = (k: string) => {
    const vs = es.map(e => e.metricas[k]?.cv ?? e.metricas[k]?.prueba ?? null);
    const ok = vs.filter((v): v is number => v != null);
    if (!ok.length) return -1;
    const target = cat.metricas[k]?.mayor_mejor === false ? Math.min(...ok) : Math.max(...ok);
    return vs.indexOf(target);
  };
  const rocs = es.map((e, i) => ({ e, i, roc: e.informe?.roc?.[0] })).filter(x => x.roc && (x.e.informe?.roc?.length ?? 0) === 1);
  const aprendizaje = es.map((e, i) => ({ e, i, c: e.informe?.curva_aprendizaje })).filter(x => x.c);
  return (
    <div className="es-comparar">
      <div className="es-det-bar"><button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('ml', 'experimentos')}><ArrowLeft size={13} aria-hidden="true" />Experimentos</button>
        <span className="muted">Las filas que cambian entre experimentos están resaltadas.</span></div>
      <Panel title="Lado a lado" flush>
        <div className="tbl-wrap">
          <table className="tbl es-cmp" aria-label="Comparación de experimentos">
            <thead><tr><th />{es.map((e, i) => <th key={e.id} scope="col"><i className="es-swatch" style={{ background: SERIE[i] }} /><a href={`#ml/experimentos/${e.id}`} className="mono">{e.id.replace(/^exp-/, '')}</a><br /><b>{e.modelo?.etiqueta ?? 'código'}</b></th>)}</tr></thead>
            <tbody>
              {fila('motor', es.map(e => (e.motor === 'spark' ? 'Spark MLlib' : 'scikit-learn')), es.map(e => e.motor))}
              {fila('datos', es.map(e => `${(e.datos?.ruta ?? e.datos?.tabla ?? '').split('/').pop()}${e.datos?.hash ? ` (${e.datos.hash.slice(0, 8)})` : ''}`), es.map(e => e.datos?.hash ?? e.datos?.ruta))}
              {fila('objetivo', es.map(e => e.objetivo ?? '—'), es.map(e => e.objetivo))}
              {fila('variables', es.map(e => Object.values(e.variables ?? {}).flat().length), es.map(e => e.variables))}
              {fila('validación', es.map(e => (e.receta ? `${e.receta.validacion.particion} ${Math.round(e.receta.validacion.prueba * 100)} % · ${cat.cv[e.receta.validacion.cv]?.etiqueta} · semilla ${e.receta.validacion.semilla}` : '—')), es.map(e => e.receta?.validacion))}
              {fila('preprocesamiento', es.map(e => (e.receta ? `${e.receta.preproceso.imputar_num} · ${e.receta.preproceso.escalar} · ${e.receta.preproceso.codificar}${e.receta.preproceso.outliers !== 'ninguno' ? ` · ${e.receta.preproceso.outliers}` : ''}` : '—')), es.map(e => e.receta?.preproceso))}
              {fila('búsqueda', es.map(e => (e.busqueda ? `${e.busqueda.tipo}: ${e.busqueda.candidatos} combinaciones` : 'ninguna')), es.map(e => e.busqueda?.tipo))}
              <tr className="es-cmp-sep"><th colSpan={es.length + 1}>métricas (validación cruzada ± desvío; si no hubo, prueba)</th></tr>
              {metricas.map(k => {
                const b = mejor(k);
                return fila(cat.metricas[k]?.etiqueta ?? k, es.map((e, i) => {
                  const m = e.metricas[k];
                  if (!m) return '—';
                  return <span data-mejor={i === b || undefined}>{fmtMetrica(m.cv ?? m.prueba)}{m.cv_desvio != null && <span className="muted"> ± {fmtMetrica(m.cv_desvio, 3)}</span>}{m.cv != null && <span className="muted"> · prueba {fmtMetrica(m.prueba)}</span>}</span>;
                }));
              })}
              <tr className="es-cmp-sep"><th colSpan={es.length + 1}>hiperparámetros</th></tr>
              {params.map(p => fila(<span className="mono">{p}</span>, es.map(e => {
                const m = e.modelo ? modeloDe(cat, e.modelo.id) : undefined;
                return e.modelo && p in e.modelo.params ? textoValor(m?.params.find(x => x.nombre === p), e.modelo.params[p]) : '—';
              }), es.map(e => e.modelo?.params[p])))}
              <tr className="es-cmp-sep"><th colSpan={es.length + 1}>costo</th></tr>
              {fila('tiempo total', es.map(e => fmtSeg(e.tiempos?.total)))}
              {fila('entrenar', es.map(e => fmtSeg(e.tiempos?.entrenar)))}
              {fila('memoria pico', es.map(e => fmtMb(e.memoria_pico_mb)))}
              {fila('memoria en YARN', es.map(e => (e.yarn?.memoria_mb ? fmtMb(e.yarn.memoria_mb) : '—')))}
              {fila('tamaño del modelo', es.map(e => fmtBytes(e.modelo_bytes)))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="es-graf-grid">
        {rocs.length >= 2 && (
          <Panel title="Curvas ROC superpuestas">
            <Lineas titulo="Curvas ROC de los experimentos" diagonal xDom={[0, 1]} yDom={[0, 1]} xLabel="falsos positivos" yLabel="verdaderos positivos"
              series={rocs.map(({ e, i, roc }) => ({ nombre: `${e.modelo?.etiqueta ?? e.id} (AUC ${fmtMetrica(roc!.auc, 3)})`, x: roc!.x, y: roc!.y, color: SERIE[i] }))} />
          </Panel>
        )}
        {aprendizaje.length >= 2 && (
          <Panel title="Curvas de aprendizaje (validación)">
            <Lineas titulo="Curvas de aprendizaje de los experimentos" xLabel="filas de entrenamiento" yLabel={es[0].metrica ?? ''}
              series={aprendizaje.map(({ e, i, c }) => ({ nombre: e.modelo?.etiqueta ?? e.id, x: c!.filas, y: c!.validacion.map(f => f.reduce((a, b) => a + b, 0) / f.length), color: SERIE[i] }))} />
          </Panel>
        )}
      </div>
    </div>
  );
}
