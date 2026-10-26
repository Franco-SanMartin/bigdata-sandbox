/* Detalle de un entrenamiento: métricas, matriz de confusión, predicciones contra lo real, lo aprendido, el modelo por dentro (3D), costo y trace. */
import { Suspense, lazy } from 'react';
import type { MlTask, ModelRun } from '../../api/types';
import { SampleTable, TraceView } from '../../components/Trace';
import { Meter } from '../../components/ui';
import { duration, mbLabel, nf } from '../../lib/format';

export const TASK: Record<MlTask, string> = { regresion: 'regresión', clasificacion: 'clasificación', clustering: 'agrupamiento' };
/** La métrica principal de cada tipo de problema */
export const MAIN: Record<MlTask, string> = { regresion: 'r2', clasificacion: 'aciertos', clustering: 'rand_ajustado' };
const METRIC: Record<string, { label: string; tip: string }> = {
  r2: { label: 'R²', tip: '1 = predice perfecto, 0 = igual que decir siempre el promedio' },
  error_medio: { label: 'error medio', tip: 'cuánto se equivoca en promedio, en la unidad del objetivo' },
  cv: { label: 'validación cruzada', tip: 'la misma métrica repartiendo los datos en 5 partes' },
  aciertos: { label: 'aciertos', tip: 'filas de prueba bien clasificadas' },
  rand_ajustado: { label: 'rand ajustado', tip: 'cuánto se parecen los grupos a los segmentos reales (1 = iguales)' },
  rand_sin_escalar: { label: 'rand sin escalar', tip: 'lo mismo sin escalar las columnas antes' },
  silhouette_k3: { label: 'silhouette k=3', tip: 'qué tan separados quedan los grupos (−1 a 1)' },
};
export const metricLabel = (k: string) => METRIC[k]?.label ?? k.replace(/_/g, ' ');
export const metricValue = (k: string, v: number) => (k === 'aciertos' ?`${nf(v * 100, 1)} %` : Math.abs(v) >= 100 ? nf(v) : nf(v, 3));
export const runTime = (s?: number) => (s == null ? '—' : s < 1 ? `${nf(s * 1000)} ms` : s < 60 ? `${nf(s, 1)} s` : duration(s));
export const ENGINE_LABEL = { sklearn: 'scikit-learn', mllib: 'Spark MLlib' } as const;
export const EngineChip = ({ engine }: { engine: 'sklearn' | 'mllib' }) => <span className={engine === 'sklearn' ? 'eng eng-uno' : 'eng eng-spark'}>{ENGINE_LABEL[engine]}</span>;
export const RefTag = () => <span className="tag ref" title="Valores de referencia: no se midieron en esta corrida">referencia</span>;

// three.js pesa: el dibujo 3D se baja recién cuando se abre un modelo que tiene algo para dibujar
const ModelViz = lazy(() => import('./viz/ModelViz'));

export function ModelDetail({ run, label }: { run: ModelRun; label: string }) {
  const main = MAIN[run.task];
  const others = Object.entries(run.metrics).filter(([k]) => k !== main);
  return (
    <div className="md">
      <div className="md-h">
        <b>{label}</b>
        <EngineChip engine={run.engine} />
        <span className="muted">{TASK[run.task]}</span>
        <span className="badge" data-k={run.state === 'done' ? 'ok' : run.state === 'failed' ? 'bad' : 'run'}>{run.state === 'done' ? 'listo' : run.state === 'failed' ? 'falló' : 'entrenando'}</span>
        {run.reference && <RefTag />}
        <span className="mono muted md-id">{run.id}{run.appId ? ` · ${run.appId}` : ''}</span>
      </div>

      {run.state === 'running' && (
        <div className="md-run">
          <Meter value={run.progress * 100} max={100} kind="run" label="Avance del entrenamiento" />
          <span>{run.message}</span><span className="mono">{nf(run.progress * 100)} %</span>
        </div>
      )}
      {run.state === 'failed' && <div className="callout" data-k="bad" role="alert"><span><b>No terminó.</b> <span className="mono">{run.error ?? run.message}</span></span></div>}

      {run.reference && run.state === 'done' && (
        <div className="callout ref-note"><span><b>Valores de referencia, no medidos en esta corrida.</b> {run.engine === 'mllib'
          ? 'Las métricas, el tiempo y la memoria de Spark MLlib son los esperados; medilos con modelos_spark.py en el cluster.'
          : 'Se midió con 80/20, todas las columnas y los parámetros por defecto; con otra configuración el número real puede cambiar.'}</span></div>
      )}

      {run.state !== 'failed' && Object.keys(run.metrics).length > 0 && (
        <div className="stats md-stats" data-ref={run.reference || undefined}>
          <div className="stat"><span className="stat-l">{metricLabel(main)}</span><span className="stat-v">{run.metrics[main] != null ? metricValue(main, run.metrics[main]) : '—'}</span><span className="stat-s">{METRIC[main]?.tip}</span></div>
          {others.map(([k, v]) => <div key={k} className="stat"><span className="stat-l">{metricLabel(k)}</span><span className="stat-v">{metricValue(k, v)}</span><span className="stat-s">{METRIC[k]?.tip}</span></div>)}
          <div className="stat"><span className="stat-l">tiempo</span><span className="stat-v">{runTime(run.seconds)}</span><span className="stat-s">solo el fit()</span></div>
          <div className="stat"><span className="stat-l">memoria</span><span className="stat-v">{run.memoryMb != null ? mbLabel(run.memoryMb) : '—'}</span><span className="stat-s">{run.engine === 'mllib' ? 'driver + executors' : 'pico del proceso'}</span></div>
          {run.task === 'clustering'
            ? <div className="stat"><span className="stat-l">entrena</span><span className="stat-v">{nf(run.trainRows)}</span><span className="stat-s">filas, todas: se mide contra segmento_real</span></div>
            : <div className="stat"><span className="stat-l">entrena / prueba</span><span className="stat-v">{nf(run.trainRows)}<small>/ {nf(run.testRows)}</small></span><span className="stat-s">filas</span></div>}
        </div>
      )}

      <dl className="kv md-with">
        <dt>objetivo</dt><dd className="mono">{run.target === undefined ? '—' : run.target ?? 'ninguno (no supervisado)'}</dd>
        <dt>variables</dt><dd className="mono">{run.features?.join(', ') ?? '—'}</dd>
        <dt>parámetros</dt><dd className="mono">{run.params && Object.keys(run.params).length ? Object.entries(run.params).map(([k, v]) => `${k}=${v}`).join('  ') : 'por defecto'}</dd>
      </dl>

      {(run.confusion || run.predictions) && (
        <div className="md-grid">
          {run.confusion && <Confusion c={run.confusion} />}
          {run.predictions && <div><h3 className="md-t">predicciones contra lo real</h3><SampleTable sample={run.predictions} label="Predicciones contra lo real" /></div>}
        </div>
      )}

      {run.learned?.length ? (
        <div className="md-grid">
          {run.learned.map(l => (
            <div key={l.title}>
              <h3 className="md-t">{l.title.charAt(0).toLowerCase() + l.title.slice(1)}</h3>
              <div className="tbl-wrap"><table className="tbl" aria-label={l.title}><tbody>
                {l.rows.map((r, i) => <tr key={i}><td className="mono">{r[0]}</td><td className="r">{r[1]}</td>{r.length > 2 && <td className="muted">{r[2] ?? ''}</td>}</tr>)}
              </tbody></table></div>
            </div>
          ))}
        </div>
      ) : null}

      {run.state === 'done' && run.hasViz && (
        <Suspense fallback={<div className="callout" aria-busy="true"><span>Cargando el dibujo del modelo…</span></div>}>
          <ModelViz key={run.id} run={run} />
        </Suspense>
      )}
      {run.state === 'done' && !run.hasViz && run.vizError && (
        <div className="callout"><span><b>No se pudo armar el dibujo del modelo</b> (el modelo vale igual). <span className="mono">{run.vizError}</span></span></div>
      )}

      {run.trace && (
        <details className="md-trace">
          <summary>trace del entrenamiento</summary>
          <TraceView trace={run.trace} />
        </details>
      )}
    </div>
  );
}

/** Filas = lo real, columnas = lo que predijo. El gris de cada celda es la parte de su fila */
function Confusion({ c }: { c: NonNullable<ModelRun['confusion']> }) {
  const total = c.matrix.flat().reduce((a, b) => a + b, 0);
  const ok = c.matrix.reduce((a, r, i) => a + (r[i] ?? 0), 0);
  return (
    <div>
      <h3 className="md-t">matriz de confusión <span className="muted">· {nf(total)} filas de prueba · {nf(ok / Math.max(1, total) * 100, 1)} % en la diagonal</span></h3>
      <table className="ml-cm" aria-label="Matriz de confusión">
        <thead>
          <tr><th className="ax" colSpan={2} rowSpan={2} /><th className="ax" colSpan={c.labels.length}>predijo</th></tr>
          <tr>{c.labels.map(l => <th key={l}>{l}</th>)}</tr>
        </thead>
        <tbody>
          {c.matrix.map((row, i) => {
            const rt = row.reduce((a, b) => a + b, 0) || 1;
            return (
              <tr key={i}>
                {i === 0 && <th className="ax real" rowSpan={c.matrix.length}>real</th>}
                <th>{c.labels[i]}</th>
                {row.map((v, j) => (
                  <td key={j} data-d={i === j || undefined} data-hi={v / rt > 0.55 || undefined} style={{ ['--p' as string]: (v / rt).toFixed(3) }}>
                    <b>{nf(v)}</b><span>{nf(v / rt * 100, 1)} %</span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
