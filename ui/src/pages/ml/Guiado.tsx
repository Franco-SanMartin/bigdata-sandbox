/* ML guiado: el recorrido de clase con clientes_senal.csv (el dataset con reglas conocidas): qué modelo conviene,
   entrenamiento en vivo y el detalle de cada modelo con su dibujo 3D por dentro. Lo usa también el Pipeline. */
import { useEffect, useMemo, useState } from 'react';
import { Brain, Play } from 'lucide-react';
import type { MlDataset, MlTask, ModelChoice, ModelRun } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { SampleTable } from '../../components/Trace';
import { Meter, Seg, Stepper } from '../../components/ui';
import { EmptyState, GatedButton, Panel, SkeletonLines } from '../../components/base';
import type { Capability } from '../../lib/capabilities';
import { runFix, useCapabilities } from '../../state/capabilities';
import { trainModel } from '../../state/actions';
import { useStatus } from '../../state/store';
import { useApi } from '../../state/useApi';
import { mbLabel, nf } from '../../lib/format';
import { EngineChip, MAIN, ModelDetail, RefTag, TASK, metricLabel, metricValue, runTime } from './ModelDetail';
import { CLUSTER_FEATURES, DEFAULT_PARAMS } from '../../lib/ml';
import './ml.css';

const TASKS: MlTask[] = ['regresion', 'clasificacion', 'clustering'];
const MODEL: Record<string, string> = { lineal: 'Regresión lineal', tonto: 'Clasificador tonto', arbol: 'Árbol de decisión', logistica: 'Regresión logística', mlp: 'Red neuronal (MLP)', kmeans: 'KMeans' };
const FIT: Record<ModelChoice['fit'], 'ok' | 'bad' | undefined> = { recomendado: 'ok', sirve: undefined, 'línea base': undefined, 'no conviene': 'bad' };

/** Hiperparámetros que se pueden tocar; los valores por defecto (modelos_sklearn.py) están en lib/ml.ts */
type Param = { key: string; label: string } & ({ kind: 'int'; min: number; max: number } | { kind: 'num' } | { kind: 'text'; hint: string });
const PARAMS: Record<string, Param[]> = {
  arbol: [{ key: 'max_depth', label: 'profundidad máxima', kind: 'int', min: 1, max: 20 }],
  logistica: [{ key: 'C', label: 'C (regularización)', kind: 'num' }],
  mlp: [{ key: 'hidden_layer_sizes', label: 'capas ocultas', kind: 'text', hint: 'neuronas por capa, separadas por coma' }, { key: 'max_iter', label: 'iteraciones máximas', kind: 'int', min: 50, max: 5000 }],
  kmeans: [{ key: 'n_clusters', label: 'grupos (k)', kind: 'int', min: 2, max: 10 }, { key: 'n_init', label: 'arranques', kind: 'int', min: 1, max: 50 }],
};
const defaults = (model: string) => ({ ...DEFAULT_PARAMS[model] });
const def = (model: string, key: string) => DEFAULT_PARAMS[model]?.[key] ?? '';

export function Guiado() {
  const status = useStatus();
  const running = status?.phase === 'running';
  const caps = useCapabilities();
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

  // En clustering arrancan marcadas solo las dos columnas que separan los segmentos; en los otros, todas
  const inputsKey = inputs.join(',');
  useEffect(() => {
    setIgnored(new Set(task === 'clustering' ? inputs.filter(c => !CLUSTER_FEATURES.includes(c)) : []));
  }, [task, inputsKey]);

  // Al cambiar de problema, el formulario arranca con el modelo recomendado
  useEffect(() => {
    if (!choices.length || choices.some(c => c.model === model)) return;
    const best = choices.find(c => c.fit === 'recomendado') ?? choices[0];
    applyChoice(best);
  }, [rec.data]);

  function applyChoice(c: ModelChoice) { setModel(c.model); setEngine(c.engine); setParams(defaults(c.model)); }
  function pickModel(m: string) { setModel(m); setParams(defaults(m)); if (!choices.some(c => c.model === m && c.engine === engine)) setEngine('sklearn'); }

  function toggle(col: string) {
    setIgnored(s => { const n = new Set(s); if (n.has(col)) n.delete(col); else n.add(col); return n; });
  }
  function useAsTarget(col: string, ds: MlDataset) {
    const t = ds.targets.find(x => x.column === col);
    if (t) setTask(t.task);
  }

  // Entrenar, con cualquiera de los dos motores, necesita SERVICIOS=todo (Spark y Python en el contenedor):
  // si scikit-learn está listo pero falta eso, el motivo y el arreglo son los de MLlib
  const trainCap: Capability = engine === 'mllib' ? caps['ml.mllib']
    : caps['ml.sklearn'].state !== 'ready' ? caps['ml.sklearn']
    : status && status.config.services !== 'todo' ? caps['ml.mllib']
    : caps['ml.sklearn'];

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
    <div className="ml-guiado">
      <div className="ml-guiado-bar">
        <p className="muted">El recorrido de clase con <span className="mono">clientes_senal.csv</span>: reglas conocidas, el modelo recomendado y su dibujo por dentro. Para todo lo demás, el Estudio.</p>
        <Seg value={task} onChange={setTask} label="Tipo de problema" options={TASKS.map(t => ({ value: t, label: TASK[t] }))} />
      </div>
      {status && trainCap.state !== 'ready' && (
        <div className="capnote" data-k={trainCap.state} role="status">
          <span className="dot" data-s={trainCap.state === 'starting' ? 'starting' : 'off'} aria-hidden="true" />
          <span><b>Entrenar:</b> {trainCap.reason}. Los datos y qué modelo conviene se ven igual.</span>
          {trainCap.fix && trainCap.fix.kind !== 'wait' && <button type="button" className="btn btn-sm" onClick={() => runFix(trainCap.fix)}>{trainCap.fixLabel}</button>}
        </div>
      )}
      <div className="grid cols-12">
        <Panel className="span-7" title={ds?.label ?? 'Datos'} sub={ds ? `${nf(ds.rows)} filas` : undefined}
          end={<Seg value={view} onChange={setView} label="Vista del dataset" options={[{ value: 'cols', label: 'columnas' }, { value: 'sample', label: 'muestra' }]} />}
          flush>
          {datasets.error ? <div className="ml-pad"><EmptyState compact kind="error" title="No se pudo leer el dataset">{datasets.error}</EmptyState></div>
            : !ds ? <div className="ml-pad">{datasets.loading ? <SkeletonLines n={5} /> : <EmptyState compact icon={<Brain size={20} aria-hidden="true" />} title="Sin datasets">El dataset de clientes se genera al arrancar el cluster.</EmptyState>}</div>
            : view === 'sample' ? <SampleTable sample={ds.sample} label="Muestra del dataset" />
            : (
              <div>
                <ul className="ml-cols" aria-label="Columnas del dataset">
                  {ds.columns.map(c => {
                    const tgt = ds.targets.find(t => t.column === c.name);
                    if (c.role === 'respuesta') return (
                      <li key={c.name} data-role="respuesta">
                        <span className="ml-ck" aria-hidden="true" />
                        <span className="mono ml-cn">{c.name}</span><span className="mono muted ml-ct">{c.type}</span>
                        <span className="ml-cnote muted">{c.note}</span>
                        <span className="tag">solo para comparar</span>
                      </li>
                    );
                    if (tgt) {
                      const on = target === c.name;
                      return (
                        <li key={c.name} data-role={on ? 'objetivo' : 'otro-objetivo'}>
                          <span className="ml-ck" aria-hidden="true" />
                          <span className="mono ml-cn">{c.name}</span><span className="mono muted ml-ct">{c.type}</span>
                          <span className="ml-cnote muted">{c.note}</span>
                          {on ? <span className="badge" data-k="ok">objetivo</span>
                            : <button type="button" className="btn btn-sm btn-ghost" onClick={() => useAsTarget(c.name, ds)}>Predecir esta ({TASK[tgt.task].toLowerCase()})</button>}
                        </li>
                      );
                    }
                    const used = !ignored.has(c.name);
                    return (
                      <li key={c.name} data-role={used ? 'entrada' : 'ignorar'}>
                        <input type="checkbox" className="ml-ck" id={`col-${c.name}`} checked={used} onChange={() => toggle(c.name)} />
                        <label htmlFor={`col-${c.name}`} className="mono ml-cn">{c.name}</label><span className="mono muted ml-ct">{c.type}</span>
                        <span className="ml-cnote muted">{c.note}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="ml-sum">
                  <span className="mono">{ds.path}{ds.inHdfs ? ' (hdfs)' : ''}</span>
                  <span>objetivo <b className="mono">{target ?? 'ninguno'}</b></span>
                  <span><b>{features.length}</b> de {inputs.length} variables</span>
                  {ds.targets.find(t => t.task === task) && <span className="muted">{ds.targets.find(t => t.task === task)!.label.toLowerCase()}</span>}
                </p>
              </div>
            )}
        </Panel>

        <Panel className="span-5" title="Qué modelo conviene" sub={TASK[task]} flush>
          {rec.error ? <div className="ml-pad"><EmptyState compact kind="error" title="No se pudo pedir la recomendación">{rec.error}</EmptyState></div>
            : !rec.data ? <div className="ml-pad"><SkeletonLines n={4} /></div>
            : <>
              <div className="ml-why"><p>{rec.data.why}.</p><p className="muted">{rec.data.engineAdvice}</p></div>
              <ul className="ml-rec">
                {choices.map(c => (
                  <li key={c.engine + c.model} aria-current={c.model === model && c.engine === engine}>
                    <div className="ml-hd">
                      <b>{c.label}</b><EngineChip engine={c.engine} />{c.fit !== 'sirve' && <span className="badge" data-k={FIT[c.fit]}>{c.fit}</span>}
                      <button className="btn btn-sm btn-ghost" type="button" onClick={() => applyChoice(c)}>usar</button>
                    </div>
                    <p>{c.why}</p>
                    {c.expected && <p className="exp">{metricLabel(c.expected.metric)} {metricValue(c.expected.metric, c.expected.value)} · {runTime(c.expected.seconds)} · {mbLabel(c.expected.memoryMb)}{c.engine === 'mllib' && ' · referencia'}</p>}
                  </li>
                ))}
              </ul>
            </>}
        </Panel>

        <Panel className="span-4" title="Entrenar">
          <div className="ml-form">
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
              {task === 'clustering'
                ? <span className="ml-pct"><span className="muted">todas las filas ({nf(ds?.rows ?? 0)}): clustering no separa prueba, se mide contra segmento_real</span></span>
                : <span className="ml-pct"><Stepper value={trainPct} onChange={setTrainPct} min={50} max={95} label="Porcentaje para entrenar" id="ml-pct" /><span className="muted">% · {nf(trainRows)} / {nf((ds?.rows ?? 0) - trainRows)} filas</span></span>}
            </div>
            {(PARAMS[model] ?? []).map(p => (
              <label key={p.key} className="ml-f"><span className="ml-fl">{p.label} <span className="mono muted">{p.key}</span></span>
                {p.kind === 'int' ? <Stepper value={Number(params[p.key] ?? def(model, p.key))} onChange={v => setParams(x => ({ ...x, [p.key]: v }))} min={p.min} max={p.max} label={p.label} />
                  : <input className="input mono" value={String(params[p.key] ?? def(model, p.key))} inputMode={p.kind === 'num' ? 'decimal' : undefined} placeholder={p.kind === 'text' ? p.hint : undefined}
                      onChange={e => setParams(x => ({ ...x, [p.key]: p.kind === 'num' && e.target.value.trim() !== '' && !isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value }))} />}
              </label>
            ))}
            {!PARAMS[model] && <p className="muted" style={{ fontSize: 12 }}>Sin hiperparámetros para tocar.</p>}
            <div className="ml-go">
              <GatedButton cap={trainCap} className="btn btn-primary" onClick={train}
                blockedBy={live ? 'Esperá a que termine el entrenamiento que está corriendo' : !features.length ? 'Marcá al menos una columna como variable' : !choice ? 'Elegí un modelo de la lista' : null}>
                <Play size={13} aria-hidden="true" />Entrenar
              </GatedButton>
              {choice?.expected && features.length > 0 && <span className="muted">esperado {runTime(choice.expected.seconds)}</span>}
            </div>
            {live && (
              <div className="ml-live" aria-live="polite">
                <div className="ml-hd"><b>{MODEL[live.model] ?? live.model}</b><EngineChip engine={live.engine} /><span className="mono">{nf(live.progress * 100)} %</span></div>
                <Meter value={live.progress * 100} max={100} kind="run" label="Avance del entrenamiento" />
                <span className="muted">{live.message}{live.appId && <> · <span className="mono">{live.appId}</span></>}</span>
              </div>
            )}
          </div>
        </Panel>

        <Panel className="span-8" title="Entrenamientos" end={runs.length > 0 ? <span className="badge-count">{runs.length}</span> : undefined} flush>
          <DataTable label="Entrenamientos" columns={cols} rows={runs} rowKey={r => r.id} selected={shown?.id ?? null} onRowClick={r => setSel(r.id)} initialSort={{ id: 'at', dir: -1 }}
            empty={models.error ?? 'Todavía no se entrenó ningún modelo.'} />
        </Panel>

        <Panel className="span-12" title="Detalle">
          {shown ? <ModelDetail run={shown} label={MODEL[shown.model] ?? shown.model} />
            : <EmptyState compact icon={<Brain size={20} aria-hidden="true" />} title="Sin modelos">Elegí un modelo y entrenalo: acá aparecen sus métricas, la matriz de confusión, las predicciones y lo que aprendió.</EmptyState>}
        </Panel>
      </div>
    </div>
  );
}
