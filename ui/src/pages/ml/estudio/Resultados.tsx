/* Resultados de un experimento: métricas con su desvío y, según el problema, matriz de confusión, ROC, PR,
   umbral y calibración (clasificación); predicho contra real y residuos (regresión); tamaños, silhouette y
   proyección 2D (clustering); varianza y cargas (PCA). Para todos: curvas de aprendizaje y de validación,
   importancia y permutación, la pérdida de la red, la búsqueda y el costo. */
import { useMemo, useState, type ReactNode } from 'react';
import type { MlCatalogo, MlExperimento, MlInforme } from '../../../api/types';
import { KeyValue, Panel, ResultTable, Stat, StatRow } from '../../../components/base';
import { Seg } from '../../../components/ui';
import { fmtBytes, fmtMb, fmtMetrica, fmtSeg, modeloDe, textoValor } from './estado';
import { Barras, Dispersion, Histograma, Lineas, Matriz, SERIE, fnum } from './graficos';

const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const desvio = (xs: number[]) => { const m = media(xs); return Math.sqrt(media(xs.map(x => (x - m) ** 2))); };

export function Resultados({ exp, cat, acciones }: { exp: MlExperimento; cat: MlCatalogo; acciones?: ReactNode }) {
  const inf = exp.informe;
  const principal = exp.metrica ?? '';
  const met = cat.metricas[principal];
  const m = exp.metricas[principal] ?? {};
  const modelo = exp.modelo ? modeloDe(cat, exp.modelo.id) : undefined;
  const filasMetricas = Object.entries(exp.metricas);
  return (
    <div className="es-res">
      <Panel title={<>{exp.modelo?.etiqueta ?? 'Código editado'} <span className={exp.motor === 'spark' ? 'eng eng-spark' : 'eng eng-uno'}>{exp.motor === 'spark' ? 'Spark MLlib' : 'scikit-learn'}</span></>}
        sub={<span className="mono">{exp.id}{exp.editado ? ' · código editado' : ''}</span>} end={acciones}>
        {exp.estado === 'falló' && <div className="callout" data-k="bad" role="alert"><span><b>Falló.</b> <span className="mono">{exp.error}</span></span></div>}
        {exp.estado === 'sin informe' && <div className="callout"><span>El código terminó bien pero no llamó a <span className="mono">estudio.registrar</span>: no hay métricas ni gráficos. La salida está en el log.</span></div>}
        {exp.estado === 'corriendo' && <div className="callout" data-k="run"><span>Todavía está corriendo.</span></div>}
        {filasMetricas.length > 0 && (
          <StatRow label="Métricas principales">
            <Stat label={<>{met?.etiqueta ?? principal}{m.cv != null ? ' · validación cruzada' : ' · prueba'}</>}
              value={fmtMetrica(m.cv ?? m.prueba)} sub={m.cv_desvio != null ? `± ${fmtMetrica(m.cv_desvio)} entre particiones` : met?.ayuda} />
            {m.cv != null && <Stat label="en la prueba" value={fmtMetrica(m.prueba)} sub="filas que no vio" />}
            {m.entrenamiento != null && <Stat label="en el entrenamiento" value={fmtMetrica(m.entrenamiento)}
              sub={m.prueba != null && met && Math.abs(m.entrenamiento - m.prueba) > 0.05 * Math.max(Math.abs(m.prueba), 1e-9) ? 'lejos de la prueba: sobreajusta' : 'cerca de la prueba'}
              k={m.prueba != null && met && Math.abs(m.entrenamiento - m.prueba) > 0.05 * Math.max(Math.abs(m.prueba), 1e-9) ? 'run' : undefined} />}
            <Stat label="tiempo total" value={fmtSeg(exp.tiempos?.total)} sub={exp.tiempos?.entrenar != null ? `entrenar ${fmtSeg(exp.tiempos.entrenar)}` : undefined} />
            <Stat label="memoria pico" value={fmtMb(exp.memoria_pico_mb)} sub={exp.yarn?.memoria_mb ? `YARN ${fmtMb(exp.yarn.memoria_mb)} en promedio` : 'el proceso y sus hijos'} />
          </StatRow>
        )}
      </Panel>

      {filasMetricas.length > 1 && (
        <Panel title="Todas las métricas" flush>
          <div className="tbl-wrap">
            <table className="tbl" aria-label="Métricas">
              <thead><tr><th>métrica</th><th className="r">prueba</th><th className="r">validación cruzada</th><th className="r">entrenamiento</th>{filasMetricas.some(([, v]) => v.validacion != null) && <th className="r">validación aparte</th>}<th>qué mide</th></tr></thead>
              <tbody>
                {filasMetricas.map(([k, v]) => (
                  <tr key={k} data-principal={k === principal || undefined}>
                    <td>{cat.metricas[k]?.etiqueta ?? k}{k === principal && <span className="tag">principal</span>}</td>
                    <td className="r mono">{fmtMetrica(v.prueba)}</td>
                    <td className="r mono">{v.cv != null ? <>{fmtMetrica(v.cv)} <span className="muted">± {fmtMetrica(v.cv_desvio, 3)}</span></> : '—'}</td>
                    <td className="r mono">{fmtMetrica(v.entrenamiento)}</td>
                    {filasMetricas.some(([, x]) => x.validacion != null) && <td className="r mono">{fmtMetrica(v.validacion)}</td>}
                    <td className="muted es-res-ayuda">{cat.metricas[k]?.ayuda}{cat.metricas[k] && !cat.metricas[k].mayor_mejor ? ' (menos es mejor)' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {inf && <Graficos inf={inf} exp={exp} />}
      {exp.busqueda && <Busqueda exp={exp} />}
      <Costo exp={exp} />
      {exp.modelo && modelo && (
        <Panel title="Hiperparámetros con los que entrenó" sub={exp.busqueda ? 'los de la mejor combinación' : exp.editado ? 'leídos del modelo entrenado (el código se editó)' : undefined}>
          <p className="mono es-hpres">{Object.entries(exp.modelo.params).map(([k, v]) => `${k}=${textoValor(modelo.params.find(p => p.nombre === k), v)}`).join(' · ')}</p>
        </Panel>
      )}
      {inf?.ejemplos && (
        <Panel title="Algunas filas de prueba" sub="lo real y lo que predijo" flush>
          <ResultTable columns={inf.ejemplos.columnas} rows={inf.ejemplos.filas} label="Filas de prueba con su predicción" fileName={`${exp.id}-ejemplos`} maxHeight={320} />
        </Panel>
      )}
    </div>
  );
}

function Graficos({ inf, exp }: { inf: MlInforme; exp: MlExperimento }) {
  const metrica = exp.metrica ?? 'puntaje';
  return (
    <>
      {inf.tarea === 'clasificacion' && <Clasificacion inf={inf} />}
      {inf.tarea === 'regresion' && inf.real && (
        <div className="es-graf-grid">
          <Panel title="Predicho contra real" sub="sobre la diagonal = acierto exacto"><Dispersion x={inf.real} y={inf.predicho!} diagonal xLabel={`real (${exp.objetivo ?? 'y'})`} yLabel="predicho" titulo="Predicho contra real" /></Panel>
          <Panel title="Residuos" sub="real − predicho, contra lo predicho: sin forma = bien"><Dispersion x={inf.predicho!} y={inf.residuo!} cero xLabel="predicho" yLabel="residuo" titulo="Residuos contra predicho" /></Panel>
          {inf.histograma_residuos && <Panel title="Distribución de los residuos" sub="centrada en 0 y simétrica = sin sesgo"><Histograma bordes={inf.histograma_residuos.bordes} cuentas={inf.histograma_residuos.cuentas} xLabel="residuo" titulo="Histograma de residuos" marca={0} /></Panel>}
        </div>
      )}
      {inf.tarea === 'clustering' && <Grupos inf={inf} />}
      {inf.tarea === 'reduccion' && inf.varianza && (
        <div className="es-graf-grid">
          <Panel title="Varianza explicada" sub={`acumulada ${(inf.varianza.reduce((a, b) => a + b, 0) * 100).toFixed(1).replace('.', ',')} %`}>
            <Barras titulo="Varianza por componente" items={inf.varianza.map((v, i) => ({ etiqueta: `componente ${i + 1}`, valor: v, nota: `acumulada ${(inf.varianza!.slice(0, i + 1).reduce((a, b) => a + b, 0) * 100).toFixed(1)} %` }))} fmt={v => `${(v * 100).toFixed(1).replace('.', ',')} %`} />
          </Panel>
          {inf.proyeccion && <Panel title="Las dos primeras componentes"><Dispersion x={inf.proyeccion.x} y={inf.proyeccion.y} xLabel="componente 1" yLabel="componente 2" titulo="Proyección en las dos primeras componentes" /></Panel>}
          {inf.cargas && (
            <Panel title="Cargas" sub="cuánto pesa cada columna en cada componente" flush>
              <ResultTable columns={['columna', ...inf.cargas.valores.map((_, i) => `componente ${i + 1}`)]} rows={inf.cargas.columnas.map((c, j) => [c, ...inf.cargas!.valores.map(f => Number(f[j].toFixed(3)))])} label="Cargas de cada componente" fileName="cargas" maxHeight={300} />
            </Panel>
          )}
        </div>
      )}
      {(inf.curva_aprendizaje || inf.curva_validacion || inf.perdida) && (
        <div className="es-graf-grid">
          {inf.curva_aprendizaje && (
            <Panel title="Curva de aprendizaje" sub="¿mejoraría con más datos?">
              <Lineas titulo="Curva de aprendizaje" xLabel="filas de entrenamiento" yLabel={metrica} series={[
                bandas('entrenamiento', inf.curva_aprendizaje.filas, inf.curva_aprendizaje.entrenamiento),
                bandas('validación', inf.curva_aprendizaje.filas, inf.curva_aprendizaje.validacion),
              ]} />
            </Panel>
          )}
          {inf.curva_validacion && inf.curva_validacion.validacion && (
            <Panel title="Curva de validación" sub={<>según <span className="mono">{inf.curva_validacion.param}</span></>}>
              <Lineas titulo="Curva de validación" xCat={inf.curva_validacion.valores} xLabel={inf.curva_validacion.param} yLabel={metrica} series={[
                bandas('entrenamiento', inf.curva_validacion.valores.map((_, i) => i), inf.curva_validacion.entrenamiento!),
                bandas('validación', inf.curva_validacion.valores.map((_, i) => i), inf.curva_validacion.validacion),
              ]} />
            </Panel>
          )}
          {inf.perdida && inf.perdida.perdida.length > 1 && (
            <Panel title={inf.perdida.es_puntaje ? 'Pérdida por ronda' : 'Curva de pérdida'} sub={`${inf.perdida.iteraciones} ${inf.perdida.es_puntaje ? 'rondas' : 'épocas o iteraciones'}`}>
              <Lineas titulo="Curva de pérdida" xLabel={inf.perdida.es_puntaje ? 'ronda' : 'época'} yLabel="pérdida" series={[
                { nombre: 'pérdida (entrenamiento)', x: inf.perdida.perdida.map((_, i) => i + 1), y: inf.perdida.perdida },
                ...(inf.perdida.validacion?.length ? [{ nombre: inf.perdida.es_puntaje ? 'validación' : 'puntaje de validación', x: inf.perdida.validacion.map((_, i) => i + 1), y: inf.perdida.validacion, punteada: true }] : []),
              ]} />
            </Panel>
          )}
        </div>
      )}
      {(inf.importancia || inf.permutacion) && (
        <div className="es-graf-grid">
          {inf.permutacion && (
            <Panel title="Importancia por permutación" sub="cuánto empeora la prueba si se mezcla esa columna">
              <Barras titulo="Importancia por permutación" items={inf.permutacion.columnas.map((c, i) => ({ etiqueta: c, valor: inf.permutacion!.media[i], error: inf.permutacion!.desvio[i] })).sort((a, b) => b.valor - a.valor).slice(0, 20)} />
            </Panel>
          )}
          {inf.importancia && (
            <Panel title={inf.importancia.tipo === 'coeficientes' ? 'Coeficientes (en valor absoluto)' : 'Importancia del modelo'} sub={inf.importancia.tipo === 'coeficientes' ? 'con columnas escaladas, comparables entre sí' : 'reducción de impureza en los árboles'}>
              <Barras titulo="Importancia del modelo" items={inf.importancia.columnas.slice(0, 20).map((c, i) => ({ etiqueta: c, valor: inf.importancia!.valores[i], nota: inf.importancia!.signo ? (inf.importancia!.signo[i] < 0 ? 'resta' : 'suma') : undefined }))} />
            </Panel>
          )}
        </div>
      )}
    </>
  );
}

/** Una serie con banda de ± desvío a partir de los puntajes por partición */
function bandas(nombre: string, x: number[], porParticion: number[][]): { nombre: string; x: number[]; y: number[]; lo: number[]; hi: number[] } {
  const ys = porParticion.map(media), ds = porParticion.map(desvio);
  return { nombre, x, y: ys, lo: ys.map((y, i) => y - ds[i]), hi: ys.map((y, i) => y + ds[i]) };
}

function Clasificacion({ inf }: { inf: MlInforme }) {
  const [norm, setNorm] = useState<'filas' | 'conteo'>('conteo');
  const [u, setU] = useState(50);
  const umb = inf.umbrales?.[Math.round(u / 2)];
  const stats = useMemo(() => {
    if (!umb) return null;
    const { vp, fp, fn, vn } = umb;
    const precision = vp + fp ? vp / (vp + fp) : 0, recall = vp + fn ? vp / (vp + fn) : 0;
    return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, exactitud: (vp + vn) / Math.max(1, vp + fp + fn + vn) };
  }, [umb]);
  return (
    <div className="es-graf-grid">
      {inf.confusion && inf.clases && (
        <Panel title="Matriz de confusión" sub="filas de prueba" end={<Seg value={norm} onChange={setNorm} label="Mostrar" options={[{ value: 'conteo', label: 'filas' }, { value: 'filas', label: '% por clase real' }]} />}>
          <Matriz clases={inf.clases} valores={inf.confusion} normalizar={norm === 'filas'} titulo="Matriz de confusión" />
        </Panel>
      )}
      {inf.umbrales && umb && stats && inf.positiva && (
        <Panel title="Umbral de decisión" sub={<>clase positiva <span className="mono">{inf.positiva}</span></>}>
          <div className="es-umbral">
            <label className="es-fila">umbral <input type="range" min={0} max={100} step={2} value={u} onChange={e => setU(Number(e.target.value))} className="es-rango" aria-label="Umbral de decisión" /><span className="mono">{(u / 100).toFixed(2).replace('.', ',')}</span></label>
            <StatRow label="Métricas con este umbral">
              <Stat label="precisión" value={fmtMetrica(stats.precision, 3)} sub="de los que dijo positivo, cuántos eran" />
              <Stat label="recall" value={fmtMetrica(stats.recall, 3)} sub="de los positivos, cuántos encontró" />
              <Stat label="F1" value={fmtMetrica(stats.f1, 3)} />
              <Stat label="exactitud" value={fmtMetrica(stats.exactitud, 3)} />
            </StatRow>
            <Matriz clases={['otra', inf.positiva]} valores={[[umb.vn, umb.fp], [umb.fn, umb.vp]]} normalizar={false} titulo="Matriz de confusión con el umbral elegido" />
            <p className="es-nota">Bajar el umbral encuentra más positivos (sube el recall) a cambio de más falsas alarmas (baja la precisión).</p>
          </div>
        </Panel>
      )}
      {inf.roc && inf.roc.length > 0 && (
        <Panel title="Curva ROC" sub={inf.roc.length === 1 ? `AUC ${fmtMetrica(inf.roc[0].auc, 3)}` : 'una contra el resto'}>
          <Lineas titulo="Curva ROC" diagonal xDom={[0, 1]} yDom={[0, 1]} xLabel="falsos positivos" yLabel="verdaderos positivos"
            series={inf.roc.slice(0, 8).map((c, i) => ({ nombre: `${c.clase} (AUC ${fmtMetrica(c.auc, 3)})`, x: c.x, y: c.y, color: inf.roc!.length === 1 ? undefined : SERIE[i] }))} fmtX={v => fnum(v, 2)} fmtY={v => fnum(v, 2)} />
        </Panel>
      )}
      {inf.pr && inf.pr.length > 0 && (
        <Panel title="Precisión-recall" sub={inf.pr.length === 1 ? `AP ${fmtMetrica(inf.pr[0].ap, 3)}` : 'una contra el resto'}>
          <Lineas titulo="Curva precisión-recall" xDom={[0, 1]} yDom={[0, 1]} xLabel="recall" yLabel="precisión"
            series={inf.pr.slice(0, 8).map((c, i) => ({ nombre: `${c.clase} (AP ${fmtMetrica(c.ap, 3)})`, x: c.x, y: c.y, color: inf.pr!.length === 1 ? undefined : SERIE[i] }))} fmtX={v => fnum(v, 2)} fmtY={v => fnum(v, 2)} />
        </Panel>
      )}
      {inf.calibracion && (
        <Panel title="Calibración" sub="¿la probabilidad que da es la que pasa? sobre la diagonal = sí">
          <Lineas titulo="Curva de calibración" diagonal xDom={[0, 1]} yDom={[0, 1]} xLabel="probabilidad predicha" yLabel="fracción real de positivos"
            series={[{ nombre: 'modelo', x: inf.calibracion.predicha, y: inf.calibracion.real }]} fmtX={v => fnum(v, 2)} fmtY={v => fnum(v, 2)} />
        </Panel>
      )}
      {inf.reporte && (
        <Panel title="Reporte por clase" flush>
          <ResultTable columns={['clase', 'precisión', 'recall', 'F1', 'filas']} rows={inf.reporte.map(r => [r.clase, Number(r.precision.toFixed(3)), Number(r.recall.toFixed(3)), Number(r.f1.toFixed(3)), r.soporte])} label="Reporte de clasificación" fileName="reporte" />
        </Panel>
      )}
    </div>
  );
}

function Grupos({ inf }: { inf: MlInforme }) {
  const p = inf.proyeccion;
  const [color, setColor] = useState<'grupo' | 'referencia'>('grupo');
  const cv = inf.curva_validacion;
  return (
    <div className="es-graf-grid">
      {inf.tamanos && (
        <Panel title="Tamaño de cada grupo">
          <Barras titulo="Filas por grupo" items={inf.tamanos.map((t, i) => ({ etiqueta: t.grupo === -1 ? 'ruido (−1)' : `grupo ${t.grupo}`, valor: t.filas, color: t.grupo === -1 ? 'var(--n-8)' : SERIE[i % SERIE.length] }))} />
        </Panel>
      )}
      {p && (
        <Panel title="Proyección 2D (PCA)" sub={p.varianza ? `las dos componentes juntan ${((p.varianza[0] + p.varianza[1]) * 100).toFixed(0)} % de la varianza` : undefined}
          end={p.referencia && <Seg value={color} onChange={setColor} label="Color por" options={[{ value: 'grupo', label: 'grupo' }, { value: 'referencia', label: 'referencia' }]} />}>
          <Dispersion x={p.x} y={p.y} grupo={color === 'referencia' && p.referencia ? p.referencia : p.grupo} centros={color === 'grupo' ? p.centros : undefined}
            nombresGrupo={g => (color === 'referencia' ? String(g) : g === -1 ? 'ruido' : `grupo ${g}`)} xLabel="componente 1" yLabel="componente 2" titulo="Grupos en dos dimensiones" />
        </Panel>
      )}
      {inf.silhouette_por_grupo && (
        <Panel title="Silhouette por grupo" sub="cerca de 1 = bien separado; negativo = mal asignado">
          <Barras titulo="Silhouette media por grupo" items={inf.silhouette_por_grupo.map((g, i) => ({ etiqueta: `grupo ${g.grupo}`, valor: g.media, color: SERIE[i % SERIE.length] }))} />
        </Panel>
      )}
      {cv?.silhouette && (
        <Panel title="¿Cuántos grupos?" sub={<>silhouette según <span className="mono">{cv.param}</span></>}>
          <Lineas titulo="Silhouette según la cantidad de grupos" xCat={cv.valores} xLabel={cv.param} yLabel="silhouette" series={[{ nombre: 'silhouette', x: cv.valores.map((_, i) => i), y: cv.silhouette.map(v => v ?? NaN) }]} />
        </Panel>
      )}
      {cv?.inercia && cv.inercia.some(v => v != null) && (
        <Panel title="Inercia (el codo)" sub="donde deja de bajar mucho, ahí está k">
          <Lineas titulo="Inercia según la cantidad de grupos" xCat={cv.valores} xLabel={cv.param} yLabel="inercia" series={[{ nombre: 'inercia', x: cv.valores.map((_, i) => i), y: cv.inercia.map(v => v ?? NaN) }]} />
        </Panel>
      )}
      {inf.contra_referencia && (
        <Panel title="Grupos contra la columna de referencia" flush>
          <ResultTable columns={['grupo', ...inf.contra_referencia.referencia]} rows={inf.contra_referencia.grupos.map((g, i) => [`grupo ${g}`, ...inf.contra_referencia!.cuentas[i]])} label="Grupos contra referencia" fileName="grupos" />
        </Panel>
      )}
    </div>
  );
}

function Busqueda({ exp }: { exp: MlExperimento }) {
  const b = exp.busqueda!;
  const params = [...new Set(b.resultados.flatMap(r => Object.keys(r.params)))];
  return (
    <Panel title="Búsqueda de hiperparámetros" sub={`${b.candidatos} combinaciones${b.rondas ? ` en ${b.rondas} rondas` : ''} · mejor ${fmtMetrica(b.mejor_puntaje)}`} flush>
      <ResultTable label="Resultados de la búsqueda" fileName={`${exp.id}-busqueda`} maxHeight={360}
        columns={['puesto', ...params, 'media', 'desvío', 'segundos']}
        rows={b.resultados.slice(0, 50).map(r => [r.rango, ...params.map(p => (r.params[p] == null ? 'None' : typeof r.params[p] === 'number' ? Number(Number(r.params[p]).toPrecision(4)) : String(r.params[p]))),
          r.media == null ? null : Number(r.media.toFixed(4)), r.desvio == null ? null : Number(r.desvio.toFixed(4)), r.tiempo == null ? null : Number(r.tiempo.toFixed(3))])} />
    </Panel>
  );
}

function Costo({ exp }: { exp: MlExperimento }) {
  const t = exp.tiempos ?? {};
  const etapas = (['busqueda', 'cv', 'entrenar', 'predecir', 'curvas'] as const).filter(k => t[k] != null);
  return (
    <Panel title="Costo computacional" sub={exp.motor === 'spark' ? 'Spark MLlib, repartido en YARN' : 'scikit-learn, en una sola máquina'}>
      <div className="es-costo">
        {etapas.length > 0 && <Barras titulo="Tiempo por etapa" items={etapas.map(k => ({ etiqueta: ({ busqueda: 'búsqueda', cv: 'validación cruzada', entrenar: 'entrenar', predecir: 'predecir la prueba', curvas: 'curvas e importancia' } as const)[k], valor: t[k] }))} fmt={v => fmtSeg(v)} />}
        <KeyValue items={[
          ['tiempo total', fmtSeg(t.total)],
          ['memoria pico', `${fmtMb(exp.memoria_pico_mb)} (proceso y sus hijos)`],
          ...(exp.yarn?.app_id ? [['YARN', <><a className="mono" href={`#yarn/${exp.yarn.app_id}`}>{exp.yarn.app_id}</a>{exp.yarn.memoria_mb ? ` · ${fmtMb(exp.yarn.memoria_mb)} en promedio en los contenedores` : ''}</>] as [string, ReactNode]] : []),
          ['tamaño del modelo', exp.modelo_hdfs ? <>{fmtBytes(exp.modelo_bytes)} en <span className="mono">hdfs://{exp.modelo_hdfs}</span></> : fmtBytes(exp.modelo_bytes)],
          ['datos', <span className="mono">{exp.datos?.ruta ?? exp.datos?.tabla} {exp.datos?.filas != null ? `· ${exp.datos.filas.toLocaleString('es-AR')} filas` : ''}{exp.datos?.hash ? ` · hash ${exp.datos.hash}` : ''}</span>],
          ['filas', exp.filas ? `${exp.filas.entrenamiento.toLocaleString('es-AR')} entrenamiento · ${exp.filas.prueba.toLocaleString('es-AR')} prueba${exp.filas.validacion ? ` · ${exp.filas.validacion.toLocaleString('es-AR')} validación` : ''}` : '—'],
          ['entorno', <span className="mono">{Object.entries(exp.entorno ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>],
        ]} />
      </div>
    </Panel>
  );
}
