/* Machine Learning: dataset, tipo de problema, modelo recomendado y los entrenamientos con sus métricas. Esqueleto. */
import { useState } from 'react';
import { Brain, Play } from 'lucide-react';
import type { MlTask, ModelRun } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { SampleTable, Slot } from '../../components/Trace';
import { Empty, Seg } from '../../components/ui';
import { HELP } from '../../help/content';
import { trainModel } from '../../state/actions';
import { useStatus } from '../../state/store';
import { useApi } from '../../state/useApi';
import { duration, nf } from '../../lib/format';

const TASK: Record<MlTask, string> = { regresion: 'Regresión', clasificacion: 'Clasificación', clustering: 'Agrupamiento' };
const FIT: Record<string, string> = { recomendado: 'ok', sirve: '', 'línea base': '', 'no conviene': 'bad' };
/** La métrica principal de cada tipo de problema */
const MAIN: Record<MlTask, [string, string]> = { regresion: ['r2', 'R²'], clasificacion: ['aciertos', 'Aciertos'], clustering: ['rand_ajustado', 'Rand ajustado'] };

export function MlPage() {
  const status = useStatus();
  const up = status?.phase === 'running' && status.config.services === 'todo';
  const [task, setTask] = useState<MlTask>('regresion');
  const isModel = (e: { type: string }) => e.type === 'model';
  const datasets = useApi(a => a.mlDatasets(), [up]);
  const ds = datasets.data?.[0];
  const rec = useApi(a => (ds ? a.recommend(ds.id, task) : Promise.resolve(null)), [ds?.id, task]);
  const models = useApi(a => a.models(), [], isModel);

  const cols: Column<ModelRun>[] = [
    { id: 'model', header: 'Modelo', sort: r => r.model, cell: r => r.model },
    { id: 'engine', header: 'Motor', cell: r => <span className={r.engine === 'sklearn' ? 'eng eng-uno' : 'eng eng-spark'}>{r.engine === 'sklearn' ? 'scikit-learn' : 'Spark MLlib'}</span> },
    { id: 'task', header: 'Problema', cell: r => TASK[r.task] },
    { id: 'state', header: 'Estado', cell: r => <span className="badge" data-k={r.state === 'done' ? 'ok' : r.state === 'failed' ? 'bad' : 'run'}>{r.state === 'running' ? `${nf(r.progress * 100)} %` : r.state === 'done' ? 'Listo' : 'Falló'}</span> },
    { id: 'metric', header: 'Métrica', align: 'right', sort: r => r.metrics[MAIN[r.task][0]] ?? -1, cell: r => { const [k, l] = MAIN[r.task]; const v = r.metrics[k]; return v == null ? '—' : `${l} ${k === 'aciertos' ? `${nf(v * 100, 1)} %` : nf(v, 3)}${r.reference ? ' (ref.)' : ''}`; } },
    { id: 'sec', header: 'Tiempo', align: 'right', sort: r => r.seconds ?? 0, cell: r => (r.seconds == null ? '—' : r.seconds < 1 ? `${nf(r.seconds * 1000)} ms` : duration(r.seconds)) },
    { id: 'rows', header: 'Entrena / prueba', align: 'right', cell: r => `${nf(r.trainRows)} / ${nf(r.testRows)}` },
  ];

  return (
    <div className="page-in">
      <div className="page-head">
        <div><h1>Machine Learning</h1><p>{HELP.ml.intro}</p></div>
        <div className="page-actions">
          <Seg value={task} onChange={setTask} label="Tipo de problema" options={(Object.keys(TASK) as MlTask[]).map(t => ({ value: t, label: TASK[t] }))} />
        </div>
      </div>
      {!up && <div className="callout" data-k="run" style={{ marginBottom: 16 }}><span><b>Para entrenar hace falta el cluster con todo.</b> Igual podés ver los datos y qué modelo conviene.</span></div>}
      <div className="grid cols-12">
        <section className="panel span-7">
          <div className="panel-h"><h2>{ds?.label ?? 'Datos'}</h2>{ds && <span className="sub mono">{ds.path} · {nf(ds.rows)} filas</span>}</div>
          <div className="panel-b">
            {ds ? <SampleTable sample={ds.sample} label="Muestra de los datos" /> : <Empty icon={<Brain size={20} />} title="Cargando datos" />}
            <div style={{ marginTop: 12 }}><Slot title="Acá va el rol de cada columna:">entrada, objetivo o ignorar (MlDataset.columns), y qué se puede predecir (targets).</Slot></div>
          </div>
        </section>
        <section className="panel span-5">
          <div className="panel-h"><h2>Qué modelo conviene</h2></div>
          <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rec.data ? <>
              <p style={{ fontSize: 13 }}>{rec.data.why}</p>
              <p className="muted" style={{ fontSize: 12 }}>{rec.data.engineAdvice}</p>
              {rec.data.choices.map(c => (
                <div key={c.engine + c.model} className="callout" style={{ justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b>{c.label}</b><span className={c.engine === 'sklearn' ? 'eng eng-uno' : 'eng eng-spark'}>{c.engine === 'sklearn' ? 'scikit-learn' : 'Spark MLlib'}</span><span className="badge" data-k={FIT[c.fit] || undefined}>{c.fit}</span></span>
                    <span className="muted">{c.why}</span>
                  </span>
                  <button className="btn btn-sm" type="button" disabled={!up} onClick={() => trainModel({ task, model: c.model, engine: c.engine, trainPct: 80, dataset: rec.data!.dataset })}><Play size={12} />Entrenar</button>
                </div>
              ))}
            </> : <span className="muted">{rec.error ?? 'Cargando…'}</span>}
          </div>
        </section>
        <section className="panel span-12">
          <div className="panel-h"><h2>Entrenamientos</h2><span className="sub">{models.data?.length ?? 0}</span></div>
          <div className="panel-b flush">
            <DataTable label="Entrenamientos" columns={cols} rows={models.data ?? []} rowKey={r => r.id} initialSort={{ id: 'sec', dir: -1 }} empty="Todavía no entrenaste ningún modelo." />
          </div>
          <div className="panel-b"><Slot title="Acá va el detalle de cada modelo:">lo aprendido (learned), la matriz de confusión, predicciones contra lo real y el trace del entrenamiento (ModelRun).</Slot></div>
        </section>
      </div>
    </div>
  );
}
