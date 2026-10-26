/* Machine Learning en el modo demo: clientes_senal.csv, recomendación de modelos y entrenamiento con
   scikit-learn (valores medidos con modelos_sklearn.py) o Spark MLlib (valores de referencia, en YARN). */
import type { MlDataset, MlRecommendation, MlTask, ModelChoice, ModelRun, ModelViz, TrainRequest } from '../types';
import { fail } from '../errors';
import type { DemoEngine, StageDef } from './engine';
import { CLIENTES_COLS, CLIENTES_HEAD, MLLIB, SKLEARN } from './datasets';
import { CLUSTER_FEATURES, DEFAULT_PARAMS } from '../../lib/ml';
import { n, needHdfs, needProc, trace } from './common';

const SENAL_PATH = '/user/root/ml/clientes_senal.csv';
const ROWS = 20000;

export const MODEL_LABEL: Record<string, string> = {
  lineal: 'Regresión lineal', tonto: 'Clasificador tonto (siempre la clase más común)', arbol: 'Árbol de decisión',
  logistica: 'Regresión logística', mlp: 'Red neuronal (MLP)', kmeans: 'KMeans',
};
const TASK_LABEL: Record<MlTask, string> = { regresion: 'regresión', clasificacion: 'clasificación', clustering: 'agrupamiento (clustering)' };
const METRIC: Record<MlTask, string> = { regresion: 'r2', clasificacion: 'aciertos', clustering: 'rand_ajustado' };
const TARGET: Record<MlTask, string | null> = { regresion: 'gasto_mes_siguiente', clasificacion: 'vuelve', clustering: null };
const FEATURES = ['antiguedad_meses', 'visitas_mes', 'ticket_promedio', 'reclamos', 'edad'];

/* Matriz de confusión con 4.000 filas de prueba (1.708 no vuelven, 2.292 vuelven), coherente con los aciertos medidos */
const CONFUSION: Record<string, number[][]> = {
  'sklearn:tonto': [[0, 1708], [0, 2292]], 'sklearn:arbol': [[1528, 180], [184, 2108]], 'sklearn:logistica': [[1310, 398], [334, 1958]], 'sklearn:mlp': [[1522, 186], [190, 2102]],
  'mllib:arbol': [[1526, 182], [186, 2106]], 'mllib:logistica': [[1308, 400], [336, 1956]], 'mllib:mlp': [[1518, 190], [198, 2094]],
};
/* Lo de adentro de cada modelo: lo que dejaron los jobs de verdad con los parámetros por defecto
   (ui/scripts/viz_demo.py). La red de MLlib se entrenó con la forma de la de Spark (sigmoide y softmax);
   el resto de MLlib usa el dibujo de scikit-learn. Cada uno se carga aparte, cuando se abre. */
const VIZ: Record<string, () => Promise<{ default: unknown }>> = {
  lineal: () => import('./viz/lineal.json'), arbol: () => import('./viz/arbol.json'), logistica: () => import('./viz/logistica.json'),
  tonto: () => import('./viz/tonto.json'), mlp: () => import('./viz/mlp.json'), 'mlp-mllib': () => import('./viz/mlp-mllib.json'),
  kmeans: () => import('./viz/kmeans.json'),
};

const col = (r: (string | number | null)[], name: string) => Number(r[CLIENTES_COLS.indexOf(name)]);
/** Lo que predice cada modelo sobre las primeras filas, con lo que aprendió (coeficientes, reglas del árbol, grupos) */
function predictions(model: string): ModelRun['predictions'] {
  const rows = CLIENTES_HEAD;
  const note = 'Primeras filas del archivo, predichas con lo aprendido';
  if (model === 'lineal') return { columns: ['visitas_mes', 'ticket_promedio', 'reclamos', 'real', 'predicho', 'diferencia'], note, rows: rows.map(r => {
    const p = Math.round(4972.4 + 50.24 * col(r, 'antiguedad_meses') + 1507.16 * col(r, 'visitas_mes') + .8 * col(r, 'ticket_promedio') - 1503.02 * col(r, 'reclamos') + .16 * col(r, 'edad'));
    const real = col(r, 'gasto_mes_siguiente');
    return [col(r, 'visitas_mes'), col(r, 'ticket_promedio'), col(r, 'reclamos'), real, p, p - real];
  }) };
  if (model === 'arbol' || model === 'tonto') return { columns: ['antiguedad_meses', 'visitas_mes', 'reclamos', 'real', 'predicho'], note, rows: rows.map(r => {
    const p = model === 'tonto' || col(r, 'antiguedad_meses') > 35.5 || (col(r, 'visitas_mes') > 3.5 && col(r, 'reclamos') <= 1.5) ? 1 : 0;
    return [col(r, 'antiguedad_meses'), col(r, 'visitas_mes'), col(r, 'reclamos'), col(r, 'vuelve'), p];
  }) };
  if (model === 'kmeans') {
    const g: Record<string, number> = { mayorista: 0, ocasional: 1, frecuente: 2 };
    const seg = (r: (string | number | null)[]) => String(r[CLIENTES_COLS.indexOf('segmento_real')]);
    return { columns: ['visitas_mes', 'ticket_promedio', 'segmento_real', 'grupo'], note: 'Primeras filas del archivo con el grupo que les tocó', rows: rows.map(r => [col(r, 'visitas_mes'), col(r, 'ticket_promedio'), seg(r), g[seg(r)]]) };
  }
  return undefined;
}

export class DemoMl {
  runs: ModelRun[] = [];
  private seq = 0;
  constructor(private e: DemoEngine) {}

  datasets(): MlDataset[] {
    const inHdfs = this.e.files.some(f => f.path === SENAL_PATH && !f.writing);
    return [{
      id: 'senal', label: 'Clientes con señal (reglas conocidas)', path: inHdfs ? SENAL_PATH : '/datos/clientes_senal.csv', rows: ROWS, script: 'ejemplos/ml/generar_senal.py', inHdfs,
      columns: [
        { name: 'antiguedad_meses', type: 'int', role: 'entrada', note: 'de 1 a 60' },
        { name: 'visitas_mes', type: 'int', role: 'entrada', note: 'depende del segmento' },
        { name: 'ticket_promedio', type: 'int', role: 'entrada', note: 'depende del segmento, con ruido' },
        { name: 'reclamos', type: 'int', role: 'entrada', note: 'de 0 a 5' },
        { name: 'edad', type: 'int', role: 'entrada', note: 'no influye en nada: el modelo tendría que darse cuenta' },
        { name: 'segmento_real', type: 'string', role: 'respuesta', note: 'ocasional, frecuente o mayorista: para comparar los grupos de KMeans' },
        { name: 'gasto_mes_siguiente', type: 'int', role: 'objetivo', note: '5000 + 1500·visitas + 0,8·ticket − 1500·reclamos + 50·antigüedad + ruido' },
        { name: 'vuelve', type: 'int', role: 'objetivo', note: '1 si antigüedad ≥ 36, o visitas ≥ 4 y reclamos ≤ 1; 10 % dado vuelta' },
      ],
      targets: [
        { column: 'gasto_mes_siguiente', task: 'regresion', label: 'Cuánto va a gastar el mes que viene' },
        { column: 'vuelve', task: 'clasificacion', label: 'Si vuelve o no' },
        { column: null, task: 'clustering', label: 'Qué grupos de clientes hay (sin decirle la respuesta)' },
      ],
      sample: { columns: CLIENTES_COLS, rows: CLIENTES_HEAD, total: ROWS, format: 'csv' },
    }];
  }

  recommend(dataset: string, task: MlTask): MlRecommendation {
    if (dataset !== 'senal') fail('not_found', `No existe el dataset ${dataset}`);
    const ex = (eng: 'sklearn' | 'mllib', model: string) => {
      const r = (eng === 'sklearn' ? SKLEARN : MLLIB)[`${task}:${model}`];
      return r ? { seconds: r.seconds!, memoryMb: r.memoryMb!, metric: METRIC[task], value: r.metrics[METRIC[task]] } : undefined;
    };
    const c = (model: string, engine: 'sklearn' | 'mllib', fit: ModelChoice['fit'], why: string): ModelChoice => ({ model, label: MODEL_LABEL[model], engine, fit, why, expected: ex(engine, model) });
    const mllib = 'Mismo resultado, pero arranca una sesión de Spark en YARN y pide 3 GB: con 20.000 filas es mucho más lento';
    const choices: ModelChoice[] = task === 'regresion' ? [
      c('lineal', 'sklearn', 'recomendado', 'La regla real es una suma de columnas por números fijos: una recta la encuentra casi exacta'),
      c('lineal', 'mllib', 'sirve', mllib),
    ] : task === 'clasificacion' ? [
      c('arbol', 'sklearn', 'recomendado', 'La regla real son umbrales (antigüedad ≥ 36, visitas ≥ 4): es justo lo que aprende un árbol, y se puede leer'),
      c('mlp', 'sklearn', 'sirve', 'Acierta casi lo mismo que el árbol, pero tarda segundos y no se puede leer qué aprendió'),
      c('logistica', 'sklearn', 'sirve', 'Separa con una sola recta: la regla real tiene un "o", por eso acierta menos'),
      c('tonto', 'sklearn', 'línea base', 'Contesta siempre la clase más común: cualquier modelo que no le gane no sirve'),
      c('arbol', 'mllib', 'sirve', mllib),
      c('mlp', 'mllib', 'sirve', 'La misma forma de red con MultilayerPerceptronClassifier (sigmoide en las ocultas); arranca una sesión de Spark en YARN y pide 3 GB'),
    ] : [
      c('kmeans', 'sklearn', 'recomendado', 'Busca grupos de puntos cercanos. Hay que escalar las columnas antes: sin escalar, el ticket (miles) tapa todo lo demás'),
      c('kmeans', 'mllib', 'sirve', mllib),
    ];
    return {
      dataset, task, choices,
      why: task === 'regresion' ? 'Lo que querés predecir es un número (el gasto): es regresión'
        : task === 'clasificacion' ? 'Lo que querés predecir es una categoría (vuelve o no vuelve): es clasificación'
        : 'No hay una columna para predecir: querés encontrar grupos parecidos, es agrupamiento (aprendizaje no supervisado)',
      engineAdvice: 'Con 20.000 filas (menos de 1 MB) todo entra en la memoria de una máquina: scikit-learn tarda milisegundos. Spark MLlib conviene cuando los datos no entran en una sola máquina.',
    };
  }

  async viz(id: string): Promise<ModelViz> {
    const r = this.runs.find(x => x.id === id);
    if (!r || !r.hasViz) fail('not_found', `El modelo ${id} no tiene nada para dibujar`);
    const load = VIZ[r.engine === 'mllib' && r.model === 'mlp' ? 'mlp-mllib' : r.model];
    const v = structuredClone((await load()).default) as ModelViz;
    return { ...v, engine: r.engine };
  }

  private emit(r: ModelRun) { this.e.emit({ type: 'model', run: { ...r } }); this.e.emit(); }

  train(req: TrainRequest, onEnd?: (r: ModelRun) => void): string {
    const key = `${req.task}:${req.model}`;
    const table = req.engine === 'sklearn' ? SKLEARN : MLLIB;
    if (req.dataset && req.dataset !== 'senal') fail('not_found', `No existe el dataset ${req.dataset}`);
    if (!table[key]) fail('unsupported', `${MODEL_LABEL[req.model] || req.model} no sirve para ${TASK_LABEL[req.task]}${req.engine === 'mllib' ? ' en Spark MLlib' : ''}`);
    if (!(req.trainPct >= 50 && req.trainPct <= 95)) fail('invalid', 'El porcentaje para entrenar va de 50 a 95');
    if (this.e.phase !== 'running') fail('cluster_stopped', 'El cluster está apagado: arrancalo desde Cluster');
    if (this.e.applied?.services !== 'todo') fail('unsupported', 'Machine Learning necesita los servicios completos (Spark y Python)');
    if (req.engine === 'mllib') { needProc(this.e, 'rm', 'YARN'); needHdfs(this.e); }
    if (this.runs.some(r => r.state === 'running')) fail('busy', 'Ya hay un entrenamiento corriendo');
    const target = req.target === undefined ? TARGET[req.task] : req.target;
    if (target !== TARGET[req.task]) fail('invalid', req.task === 'clustering' ? 'Clustering no usa columna objetivo' : `Para ${TASK_LABEL[req.task]} el objetivo es ${TARGET[req.task]}`);
    const features = req.features ?? (req.task === 'clustering' ? CLUSTER_FEATURES : FEATURES);
    if (!features.length) fail('invalid', 'Elegí al menos una columna de entrada');
    const bad = features.find(f => !FEATURES.includes(f));
    if (bad) fail('invalid', `${bad} no se puede usar como entrada`);
    const params = { ...DEFAULT_PARAMS[req.model], ...req.params };
    const sameAsMeasured = (req.task === 'clustering' || req.trainPct === 80) && features.length === (req.task === 'clustering' ? CLUSTER_FEATURES : FEATURES).length && Object.entries(params).every(([k, v]) => String(DEFAULT_PARAMS[req.model][k]) === String(v));

    const res = table[key];
    // Clustering no separa filas de prueba: entrena con todas y se mide contra segmento_real (como el backend)
    const trainRows = req.task === 'clustering' ? ROWS : Math.round(ROWS * req.trainPct / 100);
    const id = `m${++this.seq}`;
    const sk = req.engine === 'sklearn';
    const command = sk ? `python3 ejemplos/ml/modelos_sklearn.py   # ${MODEL_LABEL[req.model]}` : `spark-submit ejemplos/ml/modelos_spark.py   # ${MODEL_LABEL[req.model]}`;
    const r: ModelRun = {
      id, task: req.task, model: req.model, engine: req.engine, dataset: 'senal', state: 'running', startedAt: this.e.now(), progress: 0,
      message: sk ? 'Leyendo clientes_senal.csv' : 'Pidiendo contenedores a YARN', trainRows, testRows: ROWS - trainRows, metrics: {}, reference: !sk || !sameAsMeasured, target, features, params,
      trace: trace(command, `clientes_senal.csv · ${n(ROWS)} filas · ${req.task === 'clustering' ? 'todas para entrenar (se mide contra segmento_real)' : `${n(trainRows)} para entrenar y ${n(ROWS - trainRows)} para probar`}`,
        `${MODEL_LABEL[req.model]} (${TASK_LABEL[req.task]}) con ${sk ? 'scikit-learn, en una sola máquina' : 'Spark MLlib, repartido en executors de YARN'}`,
        'Todavía entrenando', { engine: sk ? 'uno' : 'spark', before: { columns: CLIENTES_COLS, rows: CLIENTES_HEAD, total: ROWS, format: 'csv' } }),
    };
    this.runs.unshift(r);
    this.e.act('Vos', 'info', `Entrenando ${MODEL_LABEL[req.model]} con ${sk ? 'scikit-learn' : 'Spark MLlib'}`, { command, input: r.trace!.input, action: r.trace!.action, output: id });

    const finish = () => {
      r.state = 'done'; r.progress = 1; r.finishedAt = this.e.now();
      r.metrics = { ...res.metrics }; r.seconds = res.seconds; r.memoryMb = res.memoryMb; r.learned = res.learned;
      const cm = CONFUSION[`${req.engine}:${req.model}`];
      if (cm) { const k = r.testRows / 4000; r.confusion = { labels: ['no vuelve', 'vuelve'], matrix: cm.map(row => row.map(v => Math.round(v * k))) }; }
      r.predictions = predictions(req.model);
      r.hasViz = req.model in VIZ;
      const m = METRIC[req.task];
      r.message = `${m} = ${String(res.metrics[m]).replace('.', ',')}${sameAsMeasured ? '' : ' (medido con 80/20, todas las columnas y los parámetros por defecto)'}`;
      r.trace = { ...r.trace!, output: `${r.message} · ${res.seconds} s · ${n(res.memoryMb!)} MB${r.reference ? ' · valores de referencia' : ''}`,
        after: { columns: ['métrica', 'valor'], rows: Object.entries(res.metrics).map(([k, v]) => [k, v]), note: !r.reference ? 'Medido con modelos_sklearn.py (16.000 filas para entrenar y 4.000 para probar)' : sk ? 'Valores de referencia: medidos con 80/20, todas las columnas y los parámetros por defecto' : 'Valores de referencia: medilos con modelos_spark.py en el sandbox' } };
      this.e.act(sk ? 'scikit-learn' : 'Spark MLlib', 'ok', `${MODEL_LABEL[req.model]}: ${r.message}`, { output: r.trace.output, appId: r.appId });
      this.emit(r); onEnd?.(r);
    };
    const failRun = (why: string) => { r.state = 'failed'; r.error = why; r.message = why; r.finishedAt = this.e.now(); this.emit(r); onEnd?.(r); };

    if (sk) {
      // Arrancar Python e importar pandas y scikit-learn lleva un par de segundos; el entrenamiento, lo medido
      const fit = Math.max(.5, res.seconds!);
      const steps: [number, string, number][] = [[1.5, 'Separando columnas de entrada y objetivo', .25], [2.2, req.task === 'clustering' ? 'Escalando las columnas (StandardScaler)' : `train_test_split: ${n(trainRows)} / ${n(ROWS - trainRows)}`, .35], [2.4, `Entrenando (${MODEL_LABEL[req.model]})`, .5], [2.4 + fit, req.task === 'clustering' ? 'Comparando los grupos con segmento_real' : `Probando con ${n(ROWS - trainRows)} filas que no vio`, .9]];
      steps.forEach(([t, msg, p]) => this.e.at(t, () => { if (r.state !== 'running') return; r.message = msg; r.progress = p; this.emit(r); }));
      this.e.at(3 + fit, () => { if (r.state !== 'running') return; if (this.e.phase !== 'running') failRun('Se apagó el cluster'); else finish(); });
    } else {
      const go = () => {
        const fitSec = Math.max(3, res.seconds! - 14);
        const st: StageDef[] = [
          { id: 's0', name: 'Stage 0', description: 'csv(): lee el encabezado', dependsOn: [], durSec: 1.2, n: 1, ops: ['FileScan csv', 'CollectLimit 1'] },
          { id: 's1', name: 'Stage 1', description: 'inferSchema y randomSplit([0.8, 0.2], seed=42), con cache', dependsOn: ['s0'], durSec: 2, n: 1, ops: ['FileScan csv', 'Sample', 'InMemoryRelation'] },
          { id: 's2', name: 'Stage 2', description: `fit(): ${MODEL_LABEL[req.model]}, repartido en los executors`, dependsOn: ['s1'], durSec: fitSec, n: 2, ops: ['VectorAssembler', MODEL_LABEL[req.model]] },
          { id: 's3', name: 'Stage 3', description: 'transform() + evaluador sobre las filas de prueba', dependsOn: ['s2'], edge: 'shuffle', durSec: 1.5, n: 1, ops: ['transform', 'Evaluator'] },
        ];
        const appId = this.e.submitApp({ type: 'SPARK', name: `modelos_spark.py: ${MODEL_LABEL[req.model]}`, am: 1024, amStart: 14, taskMb: 0, executors: 2, stages: st, rowsIn: ROWS }, { command, input: `${SENAL_PATH} · ${n(ROWS)} filas` });
        r.appId = appId; r.trace = { ...r.trace!, appIds: [appId] }; r.message = 'Arrancando la sesión de Spark en YARN'; this.emit(r);
        this.e.watch(appId, { tick: p => { r.progress = Math.min(.95, p); r.message = p < .05 ? 'Arrancando la sesión de Spark en YARN' : 'Entrenando en los executors'; this.emit(r); }, done: finish, fail: failRun });
      };
      if (this.e.files.some(f => f.path === SENAL_PATH && !f.writing)) go();
      else { r.message = 'MLlib lee de HDFS: subiendo clientes_senal.csv'; this.e.putFile({ path: SENAL_PATH, local: 'clientes_senal.csv', mb: 0.66, rows: '20.000 filas' }, () => go()); }
    }
    this.emit(r);
    return id;
  }
}
