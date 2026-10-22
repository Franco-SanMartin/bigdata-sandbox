/* Machine Learning: dataset con el rol de cada columna, qué modelo conviene, entrenamiento en vivo y el detalle de cada modelo. */
import { useEffect, useMemo, useState } from 'react';
import { Brain, Play, Power } from 'lucide-react';
import type { MlDataset, MlTask, ModelChoice, ModelRun } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { SampleTable } from '../../components/Trace';
import { Empty, Meter, Seg, Stepper } from '../../components/ui';
import { HELP } from '../../help/content';
import { trainModel } from '../../state/actions';
import { navigate } from '../../state/ui';
import { useStatus } from '../../state/store';
import { useApi } from '../../state/useApi';
import { mbLabel, nf } from '../../lib/format';
import { EngineChip, MAIN, ModelDetail, RefTag, TASK, metricLabel, metricValue, runTime } from './ModelDetail';
import './ml.css';

const TASKS: MlTask[] = ['regresion', 'clasificacion', 'clustering'];
const MODEL: Record<string, string> = { lineal: 'Regresión lineal', tonto: 'Clasificador tonto', arbol: 'Árbol de decisión', logistica: 'Regresión logística', mlp: 'Red neuronal (MLP)', kmeans: 'KMeans' };
const FIT: Record<ModelChoice['fit'], 'ok' | 'bad' | undefined> = { recomendado: 'ok', sirve: undefined, 'línea base': undefined, 'no conviene': 'bad' };

/** Hiperparámetros que se pueden tocar, con los valores por defecto de modelos_sklearn.py */
type Param = { key: string; label: string; def: number | string } & ({ kind: 'int'; min: number; max: number } | { kind: 'num' } | { kind: 'text'; hint: string });
const PARAMS: Record<string, Param[]> = {
  arbol: [{ key: 'max_depth', label: 'profundidad máxima', kind: 'int', min: 1, max: 20, def: 3 }],
  logistica: [{ key: 'C', label: 'C (regularización)', kind: 'num', def: 1 }],
  mlp: [{ key: 'hidden_layer_sizes', label: 'capas ocultas', kind: 'text', hint: 'neuronas por capa, separadas por coma', def: '16,8' }, { key: 'max_iter', label: 'iteraciones máximas', kind: 'int', min: 50, max: 5000, def: 500 }],
  kmeans: [{ key: 'n_clusters', label: 'grupos (k)', kind: 'int', min: 2, max: 10, def: 3 }, { key: 'n_init', label: 'arranques', kind: 'int', min: 1, max: 50, def: 10 }],
};
const defaults = (model: string) => Object.fromEntries((PARAMS[model] ?? []).map(p => [p.key, p.def]));

type Role = 'objetivo' | 'entrada' | 'ignorar';

export function MlPage() {
  const status = useStatus();
  const running = status?.phase === 'running';
  const up = running && status.config.services === 'todo';
  const [task, setTask] = useState<MlTask>('clasificacion');
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [model, setModel] = useState('arbol');
  const [engine, setEngine] = useState<'sklearn' | 'mllib'>('sklearn');
  const [trainPct, setTrainPct] = useState(80);
  const [params, setParams] = useState<Record<string, number | string>>(defaults('arbol'));
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<'cols' | 'sample'>('cols');

  const datasets = useApi(a => a.mlDatasets(), [running], e => e.type === 'hdfs');
  const ds = datasets.data?.[0];
  const rec = useApi(a => (ds ? a.recommend(ds.id, task) : Promise.resolve(null)), [ds?.id, task]);
  const models = useApi(a => a.models(), [], e => e.type === 'model');
  const runs = useMemo(() => [...(models.data ?? [])].sort((a, b) => b.startedAt - a.startedAt), [models.data]);
  const live = runs.find(r => r.state === 'running');
  const shown = runs.find(r => r.id === sel) ?? runs[0];

  const target = ds?.targets.find(t => t.task === task)?.column ?? null;
  const inputs = (ds?.columns ?? []).filter(c => c.role === 'entrada').map(c => c.name);
  const features = inputs.filter(c => !ignored.has(c));
  const choices = rec.data?.task === task ? rec.data.choices : [];
  const models4task = [...new Set(choices.map(c => c.model))];
  const choice = choices.find(c => c.model === model && c.engine === engine);

  // Al cambiar de problema, el formulario arranca con el modelo recomendado
  useEffect(() => {
    if (!choices.length || choices.some(c => c.model === model)) return;
    const best = choices.find(c => c.fit === 'recomendado') ?? choices[0];
    applyChoice(best);
  }, [rec.data]);

  function applyChoice(c: ModelChoice) { setModel(c.model); setEngine(c.engine); setParams(defaults(c.model)); }
  function pickModel(m: string) { setModel(m); setParams(defaults(m)); if (!choices.some(c => c.model === m && c.engine === engine)) setEngine('sklearn'); }

  function setRole(col: string, role: Role, ds: MlDataset) {
    if (role === 'objetivo') { const t = ds.targets.find(x => x.column === col); if (t) setTask(t.task); return; }
    if (ds.targets.some(x => x.column === col)) { if (target === col) setTask('clustering'); return; }
    setIgnored(s => { const n = new Set(s); if (role === 'ignorar') n.add(col); else n.delete(col); return n; });
  }

  async function train() {
    if (!ds) return;
    const id = await trainModel({ task, model, engine, trainPct, dataset: ds.id, target, features, params });
    if (id) setSel(id);
  }

  const cols: Column<ModelRun>[] = [
    { id: 'at', header: '#', sort: r => r.startedAt, cell: r => <span className="mono muted">{r.id}</span> },
    { id: 'model', header: 'modelo', sort: r => r.model, cell: r => MODEL[r.model] ?? r.model },
    { id: 'engine', header: 'motor', cell: r => <EngineChip engine={r.engine} /> },
    { id: 'state', header: 'estado', cell: r => <span className="badge" data-k={r.state === 'done' ? 'ok' : r.state === 'failed' ? 'bad' : 'run'}>{r.state === 'running' ? `${nf(r.progress * 100)} %` : r.state === 'done' ? 'listo' : 'falló'}</span> },
    { id: 'metric', header: 'métrica', align: 'right', sort: r => r.metrics[MAIN[r.task]] ?? -1, cell: r => { const k = MAIN[r.task]; const v = r.metrics[k]; return v == null ? '—' : <span className="ml-metric">{r.reference && <RefTag />}<span className="muted">{metricLabel(k)}</span> {metricValue(k, v)}</span>; } },
    { id: 'sec', header: 'tiempo', align: 'right', sort: r => r.seconds ?? 0, cell: r => runTime(r.seconds) },
    { id: 'mem', header: 'memoria', align: 'right', sort: r => r.memoryMb ?? 0, cell: r => (r.memoryMb == null ? '—' : mbLabel(r.memoryMb)) },
  ];

  const trainRows = ds ? Math.round(ds.rows * trainPct / 100) : 0;

  return (
    <div className="page-in">
      <div className="page-head">
        <div><h1>Machine Learning</h1><p>{HELP.ml.intro}</p></div>
        <div className="page-actions">
          <Seg value={task} onChange={setTask} label="Tipo de problema" options={TASKS.map(t => ({ value: t, label: TASK[t] }))} />
        </div>
      </div>
      {!up && (
        <div className="callout" data-k={status?.phase === 'starting' ? 'run' : undefined} style={{ marginBottom: 16, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{status?.phase === 'starting' ? <><b>El cluster está arrancando.</b> Se puede entrenar cuando terminen Spark y Python.</>
            : running ? <><b>Para entrenar hace falta SERVICIOS=todo</b> (Spark y Python). Igual se ven los datos y qué modelo conviene.</>
            : <><b>El cluster está apagado.</b> Se ven los datos y qué modelo conviene; para entrenar, prendelo.</>}</span>
          {!running && status?.phase !== 'starting' && <button className="btn btn-sm" type="button" onClick={() => navigate('cluster')}><Power size={12} />Ir a Cluster</button>}
        </div>
      )}
      <div className="grid cols-12">
        <section className="panel span-7">
          <div className="panel-h">
            <h2>{ds?.label ?? 'Datos'}</h2>
            <span className="end"><Seg value={view} onChange={setView} label="Vista del dataset" options={[{ value: 'cols', label: 'columnas' }, { value: 'sample', label: 'muestra' }]} /></span>
          </div>
          {datasets.error ? <div className="panel-b"><div className="callout" data-k="bad"><span>{datasets.error}</span></div></div>
            : !ds ? <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{datasets.loading ? [0, 1, 2, 3].map(i => <div key={i} className="skel" style={{ height: 24 }} />) : <Empty icon={<Brain size={20} />} title="Sin datasets" />}</div>
            : view === 'sample' ? <SampleTable sample={ds.sample} label="Muestra del dataset" />
            : (
              <div className="tbl-wrap">
                <table className="tbl ml-cols" aria-label="Rol de cada columna">
                  <thead><tr><th>columna</th><th>tipo</th><th>rol</th><th>qué es</th></tr></thead>
                  <tbody>
                    {ds.columns.map(c => {
                      const isTarget = ds.targets.some(t => t.column === c.name);
                      const role: Role = isTarget ? (target === c.name ? 'objetivo' : 'ignorar') : c.role === 'entrada' && !ignored.has(c.name) ? 'entrada' : 'ignorar';
                      return (
                        <tr key={c.name} data-role={c.role === 'respuesta' ? 'respuesta' : role}>
                          <td className="mono">{c.name}</td>
                          <td className="mono muted">{c.type}</td>
                          <td>{c.role === 'respuesta' ? <span className="tag">solo para comparar</span> : (
                            <Seg value={role} onChange={v => setRole(c.name, v, ds)} label={`Rol de ${c.name}`}
                              options={isTarget ? [{ value: 'objetivo', label: 'objetivo' }, { value: 'ignorar', label: 'ignorada' }] : [{ value: 'entrada', label: 'variable' }, { value: 'ignorar', label: 'ignorada' }]} />
                          )}</td>
                          <td className="muted">{c.note}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="ml-sum">
                  <span className="mono">{ds.path}{ds.inHdfs ? ' (hdfs)' : ''}</span>
                  <span><b>{nf(ds.rows)}</b> filas</span>
                  <span>objetivo <b className="mono">{target ?? 'ninguno'}</b></span>
                  <span>{TASK[task]}</span>
                  <span><b>{features.length}</b> de {inputs.length} variables</span>
                  {ds.targets.find(t => t.task === task) && <span className="muted">{ds.targets.find(t => t.task === task)!.label.toLowerCase()}</span>}
                </p>
              </div>
            )}
        </section>

        <section className="panel span-5">
          <div className="panel-h"><h2>Qué modelo conviene</h2><span className="sub">{TASK[task]}</span></div>
          {rec.error ? <div className="panel-b"><div className="callout" data-k="bad"><span>{rec.error}</span></div></div>
            : !rec.data ? <div className="panel-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2].map(i => <div key={i} className="skel" style={{ height: 40 }} />)}</div>
            : <>
              <div className="ml-why"><p>{rec.data.why}.</p><p className="muted">{rec.data.engineAdvice}</p></div>
              <ul className="ml-rec">
                {choices.map(c => (
                  <li key={c.engine + c.model} aria-current={c.model === model && c.engine === engine}>
                    <div className="hd">
                      <b>{c.label}</b><EngineChip engine={c.engine} />{c.fit !== 'sirve' && <span className="badge" data-k={FIT[c.fit]}>{c.fit}</span>}
                      <button className="btn btn-sm btn-ghost" type="button" onClick={() => applyChoice(c)}>usar</button>
                    </div>
                    <p>{c.why}</p>
                    {c.expected && <p className="exp">{metricLabel(c.expected.metric)} {metricValue(c.expected.metric, c.expected.value)} · {runTime(c.expected.seconds)} · {mbLabel(c.expected.memoryMb)}{c.engine === 'mllib' && ' · referencia'}</p>}
                  </li>
                ))}
              </ul>
            </>}
        </section>

        <section className="panel span-4">
          <div className="panel-h"><h2>Entrenar</h2></div>
          <div className="panel-b ml-form">
            <label className="ml-f"><span className="ml-fl">modelo</span>
              <select className="input" value={model} onChange={e => pickModel(e.target.value)} disabled={!models4task.length}>
                {models4task.map(m => <option key={m} value={m}>{MODEL[m] ?? m}</option>)}
              </select>
            </label>
            <div className="ml-f"><span className="ml-fl">motor</span>
              <Seg value={engine} onChange={setEngine} label="Motor" options={[
                { value: 'sklearn', label: 'scikit-learn' },
                { value: 'mllib', label: 'Spark MLlib', disabled: !choices.some(c => c.model === model && c.engine === 'mllib'), tip: 'Este modelo no está en MLlib para este problema' },
              ]} />
            </div>
            <div className="ml-f"><span className="ml-fl">para entrenar</span>
              <span className="ml-pct"><Stepper value={trainPct} onChange={setTrainPct} min={50} max={95} label="Porcentaje para entrenar" id="ml-pct" /><span className="muted">% · {nf(trainRows)} / {nf((ds?.rows ?? 0) - trainRows)} filas</span></span>
            </div>
            {(PARAMS[model] ?? []).map(p => (
              <label key={p.key} className="ml-f"><span className="ml-fl">{p.label} <span className="mono muted">{p.key}</span></span>
                {p.kind === 'int' ? <Stepper value={Number(params[p.key] ?? p.def)} onChange={v => setParams(x => ({ ...x, [p.key]: v }))} min={p.min} max={p.max} label={p.label} />
                  : <input className="input mono" value={String(params[p.key] ?? p.def)} inputMode={p.kind === 'num' ? 'decimal' : undefined} placeholder={p.kind === 'text' ? p.hint : undefined}
                      onChange={e => setParams(x => ({ ...x, [p.key]: p.kind === 'num' && e.target.value.trim() !== '' && !isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value }))} />}
              </label>
            ))}
            {!PARAMS[model] && <p className="muted" style={{ fontSize: 12 }}>Sin hiperparámetros para tocar.</p>}
            <div className="ml-go">
              <button className="btn btn-primary" type="button" disabled={!up || !!live || !features.length || !choice} onClick={train}><Play size={13} />Entrenar</button>
              <span className="muted">{!features.length ? 'Falta al menos una variable' : choice?.expected ? `esperado ${runTime(choice.expected.seconds)}` : ''}</span>
            </div>
            {live && (
              <div className="ml-live" aria-live="polite">
                <div className="hd"><b>{MODEL[live.model] ?? live.model}</b><EngineChip engine={live.engine} /><span className="mono">{nf(live.progress * 100)} %</span></div>
                <Meter value={live.progress * 100} max={100} kind="run" label="Avance del entrenamiento" />
                <span className="muted">{live.message}{live.appId && <> · <span className="mono">{live.appId}</span></>}</span>
              </div>
            )}
          </div>
        </section>

        <section className="panel span-8">
          <div className="panel-h"><h2>Entrenamientos</h2><span className="sub">{runs.length}</span></div>
          <div className="panel-b flush">
            <DataTable label="Entrenamientos" columns={cols} rows={runs} rowKey={r => r.id} selected={shown?.id ?? null} onRowClick={r => setSel(r.id)} initialSort={{ id: 'at', dir: -1 }}
              empty={models.error ?? 'Todavía no se entrenó ningún modelo.'} />
          </div>
        </section>

        <section className="panel span-12">
          <div className="panel-h"><h2>Detalle</h2></div>
          <div className="panel-b">
            {shown ? <ModelDetail run={shown} label={MODEL[shown.model] ?? shown.model} />
              : <Empty icon={<Brain size={20} />} title="Sin modelos">Elegí un modelo y entrenalo: acá aparecen sus métricas, la matriz de confusión, las predicciones y lo que aprendió.</Empty>}
          </div>
        </section>
      </div>
    </div>
  );
}
