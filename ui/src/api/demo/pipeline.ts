/* Pipeline en el modo demo: ventas_sucias.csv de punta a punta, con la herramienta que elijas en cada etapa.
   Los números salen de etl_pandas.py / etl_spark.py (103.000 → 97.200 filas) y de los scripts de ejemplos/. */
import type { DataSample, PipelineStage, PipelineStageInfo, PipelineState, PipelineTool, StepRequest, StepRun, ToolOption } from '../types';
import { fail } from '../errors';
import type { DemoEngine, StageDef } from './engine';
import { ETL_RESUMEN, LIMPIAS_HEAD, SUCIAS_HEAD } from './datasets';
import { LIMPIAS_COLS, POR, SUCIAS_COLS, mb, n, needHdfs, procUp, trace } from './common';
import type { DemoData } from './datos';
import { MODEL_LABEL, type DemoMl } from './ml';

const SUCIAS = '/user/root/ml/ventas_sucias.csv';
const LIMPIAS = '/user/root/ml/ventas_limpias';
const ORDER: PipelineStage[] = ['ingesta', 'etl', 'almacen', 'analisis', 'ml', 'resultados'];
const LABEL: Record<PipelineStage, string> = { ingesta: 'Ingesta', etl: 'ETL', almacen: 'Almacenamiento', analisis: 'Análisis', ml: 'Machine Learning', resultados: 'Resultados' };
const POR_OPT: ToolOption = { id: 'por', label: 'Agrupar por', kind: 'select', default: 'producto', choices: Object.entries(POR).map(([value, p]) => ({ value, label: p.label })) };
const COL: Record<string, string> = { sucursal: 'sucursal', producto: 'producto', mes: 'month(fecha)', pago: 'medio_pago' };
const sql = (por: string) => {
  const k = COL[por];
  const agg = por === 'producto' ? 'SUM(cantidad) AS unidades' : por === 'mes' ? '' : 'COUNT(*) AS filas';
  return `SELECT ${k}${agg ? `, ${agg}` : ''}, SUM(importe) AS facturado FROM ventas_limpias GROUP BY ${k} ORDER BY facturado DESC`;
};

type Ctx = { r: StepRun; o: Record<string, string | number | boolean>; done: (out: StepRun['output'], output: string, after?: DataSample) => void; fail: (why: string) => void };

export class DemoPipeline {
  runs: StepRun[] = [];
  private seq = 0;
  constructor(private e: DemoEngine, private ml: DemoMl, private data: DemoData) {}

  private ready(path: string) { return this.e.files.some(f => (f.path === path || f.path.startsWith(path + '/')) && !f.writing); }
  private last(stage: PipelineStage) { return this.runs.find(r => r.stage === stage); }

  catalog(): PipelineStageInfo[] {
    const run = this.e.phase === 'running';
    const todo = this.e.applied?.services === 'todo';
    const yarn = procUp(this.e, 'rm');
    const no = (ok: boolean, why: string) => (ok ? { available: true } : { available: false, unavailableReason: why });
    const off = !run ? 'El cluster está apagado' : '';
    const needTodo = off || (todo ? '' : 'Necesita los servicios completos (Spark, Hive y Python)');
    const needYarn = off || (yarn ? '' : 'YARN está apagado');
    const t = (x: Omit<PipelineTool, 'available' | 'options'> & { options?: ToolOption[] }, why: string): PipelineTool => ({ options: [], ...x, ...no(!why, why) });
    return [
      { stage: 'ingesta', label: LABEL.ingesta, description: 'Traer los datos crudos a HDFS', needs: 'Nada: es el principio', tools: [
        t({ id: 'put', label: 'hdfs dfs -put', engine: 'hdfs', recommended: true, command: 'hdfs dfs -put -f /datos/ventas_sucias.csv /user/root/ml/', whenToUse: 'El dato ya es un archivo (un CSV que te pasaron): se copia tal cual, cortado en bloques', whenNot: 'Si el dato vive en una base: ahí conviene Sqoop' }, off || (this.e.hdfsDown ? 'HDFS no responde' : '')),
        t({ id: 'sqoop', label: 'Sqoop import (MySQL → HDFS)', engine: 'mr', script: 'ejemplos/sqoop.sh', command: 'sqoop import --connect jdbc:mysql://localhost/tienda --table ventas -m 4 --target-dir /user/root/tienda/ventas', whenToUse: 'El dato está en una base relacional: Sqoop lanza un MapReduce con 4 mappers que leen la tabla en paralelo', whenNot: 'Para este pipeline: la tabla ventas de MySQL ya está limpia, no pasa por el ETL. Sirve para consultarla con Hive en Datos', options: [{ id: 'mappers', label: 'Mappers (-m)', kind: 'number', default: 4, help: 'Cuántas partes de la tabla se leen a la vez' }] }, needYarn || (procUp(this.e, 'mysql') ? '' : 'MySQL está apagado')),
      ] },
      { stage: 'etl', label: LABEL.etl, description: 'Limpiar: fechas en tres formatos, precios con coma, duplicados, faltantes', needs: 'ventas_sucias.csv (lo deja la ingesta)', tools: [
        t({ id: 'pandas', label: 'pandas', engine: 'uno', recommended: true, script: 'ejemplos/ml/etl_pandas.py', command: 'python3 ejemplos/ml/etl_pandas.py && hdfs dfs -put -f ventas_limpias.parquet /user/root/ml/ventas_limpias/', whenToUse: '4,5 MB entran de sobra en la memoria de una máquina: pandas lo limpia en un par de segundos y sin YARN', whenNot: 'Cuando el archivo no entra en la memoria de una máquina (decenas de GB)' }, needTodo),
        t({ id: 'pyspark', label: 'PySpark', engine: 'spark', script: 'ejemplos/ml/etl_spark.py', command: 'spark-submit ejemplos/ml/etl_spark.py', whenToUse: 'Los mismos pasos que pandas, repartidos en executors de YARN: es lo que escala a datos grandes', whenNot: 'Con 4,5 MB tarda mucho más que pandas: la sesión de Spark sola lleva 15 segundos' }, needTodo || needYarn),
        t({ id: 'pig', label: 'Pig', engine: 'mr', command: 'pig -x mapreduce etl.pig', whenToUse: 'Pipelines de transformación escritos en Pig Latin, sobre MapReduce', whenNot: 'Hoy casi no se usa: Spark lo reemplazó' }, 'No hay un script de ETL para ventas_sucias en la imagen'),
        t({ id: 'hive', label: 'Hive (INSERT … SELECT)', engine: 'tez', command: 'beeline -f etl.hql', whenToUse: 'Limpiezas que se escriben bien en SQL', whenNot: 'Las fechas en tres formatos y los precios con coma piden lógica que en SQL queda ilegible' }, 'No hay un script de ETL para ventas_sucias en la imagen'),
      ] },
      { stage: 'almacen', label: LABEL.almacen, description: 'Dejar el dato limpio en un formato que se pueda consultar', needs: 'ventas_limpias en HDFS (lo deja el ETL)', tools: [
        t({ id: 'hivetab', label: 'Tabla externa de Hive', engine: 'uno', recommended: true, command: `beeline -e "CREATE EXTERNAL TABLE ventas_limpias (…) STORED AS PARQUET LOCATION '${LIMPIAS}'"`, whenToUse: 'Para consultarlo con SQL: Hive anota en el Metastore dónde están los archivos y qué columnas tienen, sin moverlos', whenNot: 'Si solo lo vas a leer desde Spark o pandas: alcanza con los archivos' }, needTodo || (procUp(this.e, 'hiveserver2') ? '' : 'HiveServer2 está apagado')),
        t({ id: 'parquet', label: 'Archivos Parquet en HDFS', engine: 'hdfs', command: `hdfs dfs -ls ${LIMPIAS}`, whenToUse: 'Parquet guarda por columna y comprimido: Spark y pandas leen solo las columnas que usan', whenNot: 'Si querés SQL desde Hive: le falta la tabla' }, off),
      ] },
      { stage: 'analisis', label: LABEL.analisis, description: 'Resumir: facturado por sucursal, producto, mes o medio de pago', needs: 'ventas_limpias como tabla de Hive (Hive) o como Parquet (Spark SQL, pandas)', tools: [
        t({ id: 'hive', label: 'Hive', engine: 'tez', recommended: true, command: `beeline -e "${sql('producto')}"`, whenToUse: 'SQL de siempre sobre archivos de HDFS: HiveServer2 lo convierte en un trabajo Tez', whenNot: 'Para algo interactivo y chico: arrancar el trabajo Tez lleva unos segundos', options: [POR_OPT] }, needTodo || needYarn || (procUp(this.e, 'hiveserver2') ? '' : 'HiveServer2 está apagado')),
        t({ id: 'sparksql', label: 'Spark SQL', engine: 'spark', command: `spark-sql -e "${sql('producto')}"`, whenToUse: 'El mismo SQL, en executors de Spark: conviene si después seguís con Spark (ML, más transformaciones)', whenNot: 'Para una sola consulta chica: la sesión de Spark tarda más que la consulta', options: [POR_OPT] }, needTodo || needYarn),
        t({ id: 'pandas', label: 'pandas', engine: 'uno', script: 'ejemplos/ml/etl_pandas.py', command: "python3 -c \"import pandas as pd; pd.read_parquet('ventas_limpias.parquet').groupby('producto').importe.sum()\"", whenToUse: '97.200 filas entran en memoria: groupby tarda milisegundos', whenNot: 'Cuando los datos no entran en una máquina', options: [POR_OPT] }, needTodo),
      ] },
      { stage: 'ml', label: LABEL.ml, description: 'Entrenar un modelo. Usa clientes_senal.csv: en las ventas no hay nada que predecir con señal', needs: 'Los servicios completos (Python y Spark)', tools: [
        t({ id: 'sklearn', label: 'scikit-learn', engine: 'uno', recommended: true, script: 'ejemplos/ml/modelos_sklearn.py', command: 'python3 ejemplos/ml/modelos_sklearn.py', whenToUse: '20.000 filas: entrena en milisegundos en una máquina', whenNot: 'Cuando los datos no entran en memoria', options: [{ id: 'task', label: 'Problema', kind: 'select', default: 'regresion', choices: [{ value: 'regresion', label: 'Regresión: cuánto gasta' }, { value: 'clasificacion', label: 'Clasificación: si vuelve' }, { value: 'clustering', label: 'Agrupamiento: qué grupos hay' }] }] }, needTodo),
        t({ id: 'mllib', label: 'Spark MLlib', engine: 'spark', script: 'ejemplos/ml/modelos_spark.py', command: 'spark-submit ejemplos/ml/modelos_spark.py', whenToUse: 'Los mismos modelos, repartidos en executors: para datos que no entran en una máquina', whenNot: 'Con 20.000 filas: pide 3 GB a YARN y tarda mucho más', options: [{ id: 'task', label: 'Problema', kind: 'select', default: 'regresion', choices: [{ value: 'regresion', label: 'Regresión' }, { value: 'clasificacion', label: 'Clasificación' }, { value: 'clustering', label: 'Agrupamiento' }] }] }, needTodo || needYarn),
      ] },
      { stage: 'resultados', label: LABEL.resultados, description: 'Llevar el resumen a donde se usa: un CSV o una tabla de MySQL', needs: 'Un resumen en /user/root/resultados (lo deja el análisis)', tools: [
        t({ id: 'getmerge', label: 'hdfs dfs -getmerge', engine: 'hdfs', recommended: true, command: 'hdfs dfs -getmerge /user/root/resultados/por_producto por_producto.csv', whenToUse: 'Junta las partes del resultado en un solo CSV local, para abrirlo en una planilla', whenNot: 'Si el resultado lo tiene que leer otra aplicación desde una base', options: [POR_OPT] }, off),
        t({ id: 'mysql', label: 'Sqoop export (HDFS → MySQL)', engine: 'mr', script: 'ejemplos/sqoop.sh', command: 'sqoop export --connect jdbc:mysql://localhost/tienda --table resumen_producto --export-dir /user/root/resultados/por_producto -m 1', whenToUse: 'El resumen lo consume una aplicación que lee MySQL', whenNot: 'Para mirarlo una vez: getmerge es inmediato', options: [POR_OPT] }, needYarn || (procUp(this.e, 'mysql') ? '' : 'MySQL está apagado')),
      ] },
    ];
  }

  state(): PipelineState {
    const stages = ORDER.map(stage => {
      const r = this.last(stage);
      return { stage, label: LABEL[stage], state: r ? r.state : 'pending' as const, stepId: r?.id, tool: r?.tool, engine: r?.engine };
    });
    const running = this.runs.find(r => r.state === 'running');
    const firstPending = stages.find(s => s.state !== 'done');
    const current = running?.stage ?? firstPending?.stage ?? 'resultados';
    const i = ORDER.indexOf(current);
    const nextStage = running ? ORDER[i + 1] : firstPending ? ORDER[i + 1] : undefined;
    const HINT: Record<PipelineStage, string> = { ingesta: '', etl: 'Necesita ventas_sucias.csv en HDFS', almacen: 'Necesita ventas_limpias (lo deja el ETL)', analisis: 'Necesita la tabla de Hive o el Parquet', ml: 'Entrena con clientes_senal.csv', resultados: 'Necesita un resumen en /user/root/resultados' };
    const lastOut = this.runs.find(r => r.state === 'done' && r.output && r.stage !== 'ml');
    return {
      stages, current,
      next: nextStage ? { stage: nextStage, hint: HINT[nextStage] } : null,
      working: running ? { engine: running.engine, stepId: running.id, message: running.message } : null,
      dataset: lastOut?.output ? { path: lastOut.output.path, rows: lastOut.output.rows, sizeMb: lastOut.output.sizeMb, format: /parquet|limpias/.test(lastOut.output.path) ? 'parquet' : /resumen_|tienda\./.test(lastOut.output.path) ? 'tabla MySQL' : 'csv' } : null,
    };
  }

  reset() {
    if (this.runs.some(r => r.state === 'running')) fail('busy', 'Hay un paso corriendo: esperá a que termine');
    this.runs = [];
    this.e.act('Vos', 'info', 'Pipeline reiniciado', { action: 'Vuelve a la primera etapa', output: 'Lo que hay en HDFS queda como estaba' });
    this.e.emit();
  }

  private emit(r: StepRun) { this.e.emit({ type: 'step', step: { ...r } }); this.e.emit(); }

  run(req: StepRequest): string {
    const info = this.catalog().find(s => s.stage === req.stage);
    const tool = info?.tools.find(t => t.id === req.tool);
    if (!info || !tool) fail('not_found', `No existe la herramienta ${req.tool} en ${req.stage}`);
    if (this.e.phase !== 'running') fail('cluster_stopped', 'El cluster está apagado: arrancalo desde Cluster');
    if (!tool.available) fail('unsupported', tool.unavailableReason || 'No se puede usar ahora');
    if (this.runs.some(r => r.state === 'running')) fail('busy', 'Ya hay un paso corriendo');
    const o: Record<string, string | number | boolean> = Object.fromEntries(tool.options.map(x => [x.id, x.default]));
    Object.assign(o, req.options);
    const por = String(o.por || 'producto');
    if (tool.options.some(x => x.id === 'por') && !POR[por]) fail('invalid', `No se puede agrupar por ${por}`);
    // Lo que tiene que existir antes
    if (req.stage === 'etl' && req.tool === 'pyspark' && !this.ready(SUCIAS)) fail('invalid', 'PySpark lee de HDFS: primero subí ventas_sucias.csv (Ingesta → hdfs dfs -put)');
    if (req.stage === 'almacen' && !this.ready(LIMPIAS)) fail('invalid', 'Primero limpiá los datos (ETL): no hay nada en /user/root/ml/ventas_limpias');
    if (req.stage === 'analisis' && req.tool === 'hive' && !this.data.hiveExtra.has('default.ventas_limpias')) fail('invalid', 'Hive necesita la tabla: Almacenamiento → tabla externa de Hive');
    if (req.stage === 'analisis' && req.tool !== 'hive' && !this.ready(LIMPIAS)) fail('invalid', 'Primero limpiá los datos (ETL)');
    if (req.stage === 'resultados' && !this.ready(`/user/root/resultados/por_${por}`)) fail('invalid', `No hay un resumen por ${por}: corré Análisis agrupando por ${por}`);
    if (req.stage === 'ingesta' || req.stage === 'resultados' || req.tool === 'parquet') needHdfs(this.e);

    const command = req.stage === 'analisis' ? tool.command.replace(sql('producto'), sql(por)).replace(/groupby\('producto'\)/, `groupby('${por === 'pago' ? 'medio_pago' : por}')`)
      : req.stage === 'resultados' ? tool.command.replace(/por_producto/g, `por_${por}`).replace('resumen_producto', `resumen_${por}`)
      : req.tool === 'sqoop' ? tool.command.replace('-m 4', `-m ${o.mappers}`) : tool.command;
    const r: StepRun = { id: `p${++this.seq}`, stage: req.stage, tool: req.tool, engine: tool.engine, state: 'running', startedAt: this.e.now(), progress: 0, message: 'Arrancando', appIds: [] };
    r.trace = trace(command, '—', tool.label, 'Todavía corriendo', { engine: tool.engine });
    this.runs.unshift(r);
    this.e.act('Vos', 'info', `Pipeline · ${info.label}: ${tool.label}`, { command, action: tool.whenToUse });

    const ctx: Ctx = {
      r, o,
      done: (out, output, after) => {
        if (r.state !== 'running') return;
        r.state = 'done'; r.progress = 1; r.finishedAt = this.e.now(); r.output = out; r.message = output;
        r.trace = { ...r.trace!, output, after, appIds: r.appIds.length ? r.appIds : undefined };
        this.e.act(tool.label, 'ok', `${info.label}: ${output}`, { output: out?.path });
        this.emit(r);
      },
      fail: why => { if (r.state !== 'running') return; r.state = 'failed'; r.error = why; r.message = why; r.finishedAt = this.e.now(); this.e.act(tool.label, 'error', `${info.label}: ${why}`); this.emit(r); },
    };
    const step = (t: number, msg: string, p: number) => this.e.at(t, () => { if (r.state !== 'running') return; if (this.e.phase !== 'running') return ctx.fail('Se apagó el cluster'); r.message = msg; r.progress = p; this.emit(r); });
    const job = (type: 'MAPREDUCE' | 'TEZ' | 'SPARK', name: string, stages: StageDef[], am: number, input: string, then: () => void, extra: { rowsIn?: number; rowsOut?: number; out?: string } = {}) => {
      const appId = this.e.submitApp({ type, name, am, amStart: type === 'SPARK' ? 14 : type === 'TEZ' ? 8 : 6, taskMb: type === 'SPARK' ? 0 : am, executors: type === 'SPARK' ? 2 : 0, stages, ...extra }, { command, input, quiet: true });
      r.appIds.push(appId); r.message = 'Esperando contenedores de YARN'; this.emit(r);
      this.e.watch(appId, { tick: p => { r.progress = Math.min(.95, p); r.message = p < .05 ? 'Arrancando el ApplicationMaster' : `Corriendo en YARN (${Math.round(p * 100)} %)`; this.emit(r); }, done: then, fail: ctx.fail });
    };
    const blocks = (prefix: string) => this.e.files.filter(f => f.path.startsWith(prefix)).flatMap(f => f.blocks.map(b => b.id));
    const sucias = { columns: SUCIAS_COLS, rows: SUCIAS_HEAD, total: 103000, format: 'csv' };
    const limpias = { columns: LIMPIAS_COLS, rows: LIMPIAS_HEAD, total: 97200, format: 'parquet' };
    const bs = 128;

    switch (`${req.stage}:${req.tool}`) {
      case 'ingesta:put': {
        r.trace.input = '/datos/ventas_sucias.csv · 103.000 filas · 4,45 MB';
        r.trace.action = 'Lo corta en bloques y cada bloque viaja por la tubería de DataNodes';
        const f = this.e.putFile({ path: SUCIAS, mb: 4.45, local: 'ventas_sucias.csv', rows: '103.000 filas' }, () => ctx.done({ path: SUCIAS, rows: 103000, sizeMb: 4.45 }, `103.000 filas en ${SUCIAS}`, sucias), 'Pipeline');
        if (!f) ctx.fail('HDFS no responde');
        else { r.message = `Subiendo ${f.blocks.length} bloque${f.blocks.length > 1 ? 's' : ''}`; r.progress = .1; }
        break;
      }
      case 'ingesta:sqoop': {
        const m = Math.max(1, Math.min(8, Number(o.mappers) || 4));
        r.trace.input = 'MySQL tienda.ventas · 200.000 filas';
        r.trace.action = `MapReduce sin reduce: ${m} mappers leen la tabla por rangos de id y escriben en HDFS`;
        job('MAPREDUCE', 'sqoop import: ventas', [{ id: 'map', name: 'Map', description: `Cada mapper lee un rango de id con JDBC (${m} en total)`, dependsOn: [], durSec: 6, n: m, ops: ['DBInputFormat', 'SELECT … WHERE id >= ? AND id < ?', 'TextOutputFormat'] }], 512, 'tienda.ventas (MySQL)', () => {
          for (let i = 0; i < m; i++) this.e.putNow(`/user/root/tienda/ventas/part-m-${String(i).padStart(5, '0')}`, Math.round(6.9 / m * 100) / 100, bs, 'Sqoop');
          this.e.emit({ type: 'hdfs', path: '/user/root/tienda/ventas' });
          ctx.done({ path: '/user/root/tienda/ventas', rows: 200000, sizeMb: 6.9 }, `200.000 filas en ${m} archivos part-m`, { columns: ['id', 'fecha', 'sucursal', 'producto', 'cantidad', 'precio'], rows: [], total: 200000, note: 'Ya vienen limpias de MySQL: consultalas con Hive en Datos (tienda_ventas)' });
        }, { rowsIn: 200000, rowsOut: 200000, out: '/user/root/tienda/ventas' });
        break;
      }
      case 'etl:pandas': {
        r.trace.input = '/datos/ventas_sucias.csv · 103.000 filas (lo lee de la carpeta local, no de HDFS)';
        r.trace.action = 'Saca duplicados, unifica fechas y precios, descarta cantidades imposibles y completa faltantes';
        r.trace.before = sucias;
        [[1.5, 'Leyendo ventas_sucias.csv', .15], [2.5, 'Sacando 3.000 duplicados', .3], [3.2, 'Convirtiendo fechas en tres formatos', .45], [4, 'Arreglando precios con coma y sin coma', .6], [4.6, 'Completando faltantes', .75], [5.2, 'Guardando ventas_limpias.parquet', .85]].forEach(([t, m, p]) => step(t as number, m as string, p as number));
        this.e.at(6, () => {
          if (r.state !== 'running') return;
          if (this.e.hdfsDown) return ctx.fail('HDFS no responde: no se pudo subir el Parquet');
          r.message = 'hdfs dfs -put ventas_limpias.parquet';
          this.e.putFile({ path: `${LIMPIAS}/ventas_limpias.parquet`, mb: 1.62, local: 'ventas_limpias.parquet', rows: '97.200 filas' }, () => ctx.done({ path: LIMPIAS, rows: 97200, sizeMb: 1.62, summary: ETL_RESUMEN }, '103.000 → 97.200 filas, en Parquet', limpias), 'Pipeline');
        });
        break;
      }
      case 'etl:pyspark': {
        r.trace.input = `${SUCIAS} · 103.000 filas`;
        r.trace.action = 'Los mismos arreglos que pandas, en executors de Spark; escribe Parquet en HDFS';
        r.trace.before = sucias;
        const bl = blocks(SUCIAS);
        job('SPARK', 'etl_spark.py', [
          { id: 's0', name: 'Stage 0', description: 'csv(): lee el encabezado', dependsOn: [], durSec: 1.2, n: 1, blocks: bl.slice(0, 1), ops: ['FileScan csv', 'CollectLimit 1'] },
          { id: 's1', name: 'Stage 1', description: 'dropDuplicates: suma parcial por partición', dependsOn: ['s0'], durSec: 2.5, n: Math.max(1, bl.length), blocks: bl, ops: ['FileScan csv', 'HashAggregate (parcial)', 'Exchange hashpartitioning'] },
          { id: 's2', name: 'Stage 2', description: 'Fechas, precios, faltantes (mediana por producto) y write parquet', dependsOn: ['s1'], edge: 'shuffle', durSec: 3, n: 2, ops: ['HashAggregate (final)', 'Project', 'WriteFiles parquet'] },
        ], 1024, `${SUCIAS} · ${bl.length} bloque${bl.length > 1 ? 's' : ''}`, () => {
          this.e.files = this.e.files.filter(f => !f.path.startsWith(LIMPIAS + '/'));
          this.e.putNow(`${LIMPIAS}/part-00000.snappy.parquet`, .83, bs, 'Spark');
          this.e.putNow(`${LIMPIAS}/part-00001.snappy.parquet`, .81, bs, 'Spark');
          this.e.putNow(`${LIMPIAS}/_SUCCESS`, 0, bs, 'Spark');
          this.e.emit({ type: 'hdfs', path: LIMPIAS });
          ctx.done({ path: LIMPIAS, rows: 97200, sizeMb: 1.64, summary: ETL_RESUMEN }, '103.000 → 97.200 filas, en 2 archivos Parquet', limpias);
        }, { rowsIn: 103000, rowsOut: 97200, out: LIMPIAS });
        break;
      }
      case 'almacen:hivetab': {
        r.trace.input = `${LIMPIAS} (Parquet)`;
        r.trace.action = 'Hive anota la tabla en el Metastore: columnas, formato y carpeta. No mueve ni copia nada';
        step(1, 'CREATE EXTERNAL TABLE ventas_limpias', .5);
        this.e.at(2.5, () => { if (r.state !== 'running') return; this.data.hiveExtra.add('default.ventas_limpias'); ctx.done({ path: 'default.ventas_limpias', rows: 97200, sizeMb: 1.62 }, 'Tabla default.ventas_limpias lista para consultar', limpias); });
        break;
      }
      case 'almacen:parquet': {
        r.trace.input = LIMPIAS;
        r.trace.action = 'Nada que hacer: el ETL ya dejó Parquet, que guarda por columna y comprimido';
        const files = this.e.files.filter(f => f.path.startsWith(LIMPIAS + '/'));
        const size = files.reduce((a, f) => a + f.sizeMb, 0);
        this.e.at(1, () => ctx.done({ path: LIMPIAS, rows: 97200, sizeMb: size }, `${files.length} archivo${files.length > 1 ? 's' : ''} Parquet, ${mb(size)}`, limpias));
        break;
      }
      case 'analisis:hive': case 'analisis:sparksql': case 'analisis:pandas': {
        const p = POR[por];
        const out = `/user/root/resultados/por_${por}`;
        r.trace.input = 'ventas_limpias · 97.200 filas';
        r.trace.action = `${p.label}: agrupa y suma el importe`;
        r.trace.before = limpias;
        const after = { columns: p.columns, rows: p.rows, total: p.rows.length, format: 'csv' };
        const finish = (file: string, by: string) => {
          this.e.files = this.e.files.filter(f => !f.path.startsWith(out + '/'));
          this.e.putNow(`${out}/${file}`, .01, bs, by);
          this.e.emit({ type: 'hdfs', path: out });
          ctx.done({ path: out, rows: p.rows.length, sizeMb: .01 }, `${n(p.rows.length)} filas en ${out}`, after);
        };
        const bl = blocks(LIMPIAS);
        if (req.tool === 'hive') job('TEZ', `HIVE: INSERT OVERWRITE DIRECTORY '${out}' ${sql(por).slice(0, 40)}…`, [
          { id: 'm1', name: 'Map 1', description: 'Lee ventas_limpias y agrupa parcial', dependsOn: [], durSec: 3, n: Math.max(1, bl.length), blocks: bl, ops: ['TableScan', 'Group By Operator (parcial)', 'Reduce Output Operator'] },
          { id: 'r2', name: 'Reducer 2', description: `GROUP BY ${COL[por]}`, dependsOn: ['m1'], edge: 'SCATTER_GATHER', durSec: 2, n: 1, ops: ['Group By Operator (final)'] },
          { id: 'r3', name: 'Reducer 3', description: 'ORDER BY facturado DESC y escribe', dependsOn: ['r2'], edge: 'SCATTER_GATHER', durSec: 1.5, n: 1, ops: ['Select Operator', 'File Output Operator'] },
        ], 1024, 'default.ventas_limpias · 97.200 filas', () => finish('000000_0', 'Hive'), { rowsIn: 97200, rowsOut: p.rows.length, out });
        else if (req.tool === 'sparksql') job('SPARK', `spark-sql: por ${por}`, [
          { id: 's0', name: 'Stage 0', description: 'Lee las columnas que usa del Parquet y agrupa parcial', dependsOn: [], durSec: 2, n: Math.max(1, bl.length), blocks: bl, ops: ['FileScan parquet', 'HashAggregate (parcial)', 'Exchange hashpartitioning'] },
          { id: 's1', name: 'Stage 1', description: 'Suma final y ordena', dependsOn: ['s0'], edge: 'shuffle', durSec: 1.5, n: 1, ops: ['HashAggregate (final)', 'Sort', 'WriteFiles csv'] },
        ], 1024, `${LIMPIAS} · 97.200 filas`, () => finish('part-00000.csv', 'Spark'), { rowsIn: 97200, rowsOut: p.rows.length, out });
        else { step(1.5, 'Leyendo el Parquet', .4); step(2.2, 'groupby + sum', .8); this.e.at(2.8, () => { if (r.state === 'running') finish(`por_${por}.csv`, 'pandas'); }); }
        break;
      }
      case 'ml:sklearn': case 'ml:mllib': {
        const task = String(o.task || 'regresion') as 'regresion' | 'clasificacion' | 'clustering';
        if (!['regresion', 'clasificacion', 'clustering'].includes(task)) { this.runs.shift(); fail('invalid', `No existe el problema ${task}`); }
        const model = task === 'regresion' ? 'lineal' : task === 'clasificacion' ? 'arbol' : 'kmeans';
        let id: string;
        try { id = this.ml.train({ task, model, engine: req.tool as 'sklearn' | 'mllib', trainPct: 80, dataset: 'senal' }, m => (m.state === 'done' ? ctx.done({ path: 'clientes_senal.csv', rows: m.testRows }, `${MODEL_LABEL[model]}: ${m.message}`, m.trace?.after) : ctx.fail(m.error || 'Falló el entrenamiento'))); } catch (err) { this.runs.shift(); throw err; }
        r.modelId = id;
        r.trace.input = 'clientes_senal.csv · 20.000 filas';
        r.trace.action = `${MODEL_LABEL[model]} con ${req.tool === 'sklearn' ? 'scikit-learn' : 'Spark MLlib'}`;
        const loop = () => { if (r.state !== 'running') return; const m = this.ml.runs.find(x => x.id === id); if (m) { r.progress = m.progress; r.message = m.message; if (m.appId && !r.appIds.includes(m.appId)) r.appIds.push(m.appId); this.emit(r); } this.e.at(1, loop); };
        this.e.at(1, loop);
        break;
      }
      case 'resultados:getmerge': {
        r.trace.input = `/user/root/resultados/por_${por}`;
        r.trace.action = 'Junta las partes en un solo archivo local';
        const p = POR[por];
        this.e.at(1.5, () => ctx.done({ path: `por_${por}.csv`, rows: p.rows.length }, `por_${por}.csv con ${n(p.rows.length)} filas, en la carpeta local`, { columns: p.columns, rows: p.rows, total: p.rows.length, format: 'csv' }));
        break;
      }
      case 'resultados:mysql': {
        const p = POR[por];
        const table = `tienda.resumen_${por}`;
        r.trace.input = `/user/root/resultados/por_${por} · ${n(p.rows.length)} filas`;
        r.trace.action = `MapReduce sin reduce: un mapper lee el archivo y hace INSERT en ${table}`;
        job('MAPREDUCE', `sqoop export: resumen_${por}`, [{ id: 'map', name: 'Map', description: 'Lee el resumen de HDFS e inserta con JDBC', dependsOn: [], durSec: 4, n: 1, ops: ['TextInputFormat', 'INSERT INTO … VALUES (…)'] }], 512, `/user/root/resultados/por_${por}`, () => {
          this.data.mysqlExtra.set(table, { rows: p.rows.length, columns: p.columns.map((c, i) => ({ name: c, type: i === 0 ? 'VARCHAR(20)' : 'BIGINT' })) });
          ctx.done({ path: table, rows: p.rows.length }, `${n(p.rows.length)} filas en ${table}`, { columns: p.columns, rows: p.rows, total: p.rows.length });
        }, { rowsIn: p.rows.length, rowsOut: p.rows.length });
        break;
      }
      default: this.runs.shift(); fail('unsupported', `${tool.label} no se puede correr en el modo demo`);
    }
    this.emit(r);
    return r.id;
  }
}
