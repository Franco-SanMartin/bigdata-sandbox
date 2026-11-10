/* Modo demo: la misma interfaz que el backend real, respondida por el cluster simulado. */
import type { SandboxApi } from '../types';
import { ApiFailure, fail } from '../errors';
import { composeYaml, estimateRam, validate } from '../../lib/cluster';
import { DemoEngine, SPEED } from './engine';
import { DemoHdfs } from './hdfs';
import { DemoYarn } from './yarn';
import { DemoData } from './datos';
import { DemoMl } from './ml';
import { DemoPipeline } from './pipeline';
import { DemoEstudio } from './estudio';
import { DemoBiblioteca } from './biblioteca';
import {
  demoAula, demoBorrarMedida, demoCaidas, demoEnergia, demoEscala, demoGuardarColas, demoGuardarPlano, demoLocalidad, demoMedir,
  demoTrabajoEnCola, demoTrafico,
} from './aula';

export { SPEED as DEMO_SPEED };

export function createDemoApi(): SandboxApi {
  const e = new DemoEngine();
  const hdfs = new DemoHdfs(e);
  const yarn = new DemoYarn(e);
  const data = new DemoData(e);
  const ml = new DemoMl(e);
  const pipe = new DemoPipeline(e, ml, data);
  const est = new DemoEstudio(e);
  const bib = new DemoBiblioteca(e, est);
  const ok = <T>(v: T) => Promise.resolve(v);
  /** Los módulos nuevos tiran ApiFailure al validar: así llega como promesa rechazada, igual que del backend */
  const call = <T>(fn: () => T | Promise<T>) => Promise.resolve().then(fn);
  const copy = <T>(v: T): T => structuredClone(v);
  const abierta = e.now();
  return {
    mode: 'demo',
    now: () => e.now(),
    status: () => ok(e.status()),
    activity: () => ok(e.activity()),
    subscribe: fn => e.subscribe(fn),
    validate: c => ok(validate(c, e.volumeNN)),
    estimate: c => ok(estimateRam(c)),
    compose: c => ok(composeYaml(c, e.status().image.tag)),
    saveConfig: c => ok(e.saveConfig(c)),
    start: c => ok(e.start(c)),
    stop: () => ok(e.stop()),
    apply: c => ok(e.apply(c)),
    resetVolume: () => ok(e.resetVolume()),
    processAction: (id, a) => ok(e.processAction(id, a)),
    action: id => call(() => { throw new ApiFailure(`El modo demo no guarda la salida de las acciones (${id}): mirá la consola`, 'not_found', 404); }),
    dataNodes: () => ok(e.dataNodes()),
    files: () => ok(e.filesView()),
    putExample: x => { e.putExample(x); return ok(undefined); },
    setReplication: (p, n) => ok(e.setReplication(p, n)),
    addDataNode: () => ok(e.addDataNode()),

    hdfsList: p => call(() => hdfs.list(p)),
    hdfsFile: p => call(() => hdfs.file(p)),
    hdfsUpload: r => call(() => hdfs.upload(r)),
    hdfsMkdir: p => call(() => hdfs.mkdir(p)),
    hdfsDelete: (p, r) => call(() => hdfs.remove(p, r)),
    fsck: p => call(() => hdfs.fsck(p)),
    replication: () => call(() => hdfs.replication()),
    hdfsCat: (p, o, l) => call(() => hdfs.cat(p, o, l)),
    hdfsDownload: p => call(() => hdfs.download(p)),
    hdfsMove: (f, t) => call(() => hdfs.move(f, t)),

    apps: () => ok(e.apps()),
    submitExample: j => ok(e.submitExample(j)),
    killApp: id => ok(e.killApp(id)),
    jobTemplates: () => call(() => yarn.templates()),
    submitJob: r => call(() => yarn.submit(r)),
    yarnCluster: () => call(() => yarn.cluster()),
    aula: () => ok(demoAula(abierta, e.now())),
    aulaGuardarPlano: p => call(() => demoGuardarPlano(p)),
    aulaTrafico: () => ok(demoTrafico(abierta, e.now())),
    aulaCaidas: () => ok(demoCaidas(abierta, e.now())),
    aulaGuardarColas: g => call(() => demoGuardarColas(g)),
    aulaTrabajoEnCola: (c, t) => call(() => demoTrabajoEnCola(c, t)),
    aulaLocalidad: id => call(() => demoLocalidad(id, abierta, e.now())),
    aulaEscala: () => ok(demoEscala(abierta, e.now())),
    aulaMedir: (t, c) => call(() => demoMedir(t, c, abierta, e.now())),
    aulaBorrarMedida: id => call(() => demoBorrarMedida(id, abierta, e.now())),
    aulaEnergia: (n, a, m) => call(() => demoEnergia(n, a, m, e.now())),
    app: id => call(() => yarn.app(id)),
    appLogs: (id, c) => call(() => yarn.logs(id, c)),
    yarnMetrics: ids => call(() => yarn.metrics(ids)),

    pipelineCatalog: () => call(() => pipe.catalog()),
    pipelineState: () => call(() => pipe.state()),
    runStep: r => call(() => pipe.run(r)),
    steps: () => call(() => copy(pipe.runs)),
    pipelineReset: () => call(() => pipe.reset()),

    catalog: () => call(() => data.catalog()),
    schema: (s, n) => call(() => data.schema(s, n)),
    query: (s, t) => call(() => data.query(s, t)),
    explain: (s, t) => call(() => data.explain(s, t)),
    queryExamples: () => call(() => data.examples()),

    mlDatasets: () => call(() => ml.datasets()),
    recommend: (d, t) => call(() => ml.recommend(d, t)),
    train: r => call(() => ml.train(r)),
    models: () => call(() => copy(ml.runs)),
    modelViz: id => call(() => ml.viz(id)),

    mlCatalog: () => call(() => est.catalog()),
    mlSources: () => call(() => est.sources()),
    mlExample: () => call(() => est.example()),
    mlGenerate: () => call(() => fail('unsupported', 'En el modo demo no se generan datos: con la imagen full, el generador escribe en HDFS con Spark en YARN (de mil a miles de millones de filas)')),
    mlProfile: (d, o, op) => call(() => est.profile(d, o, op)),
    mlCleaningPreview: (d, l) => call(() => est.cleaningPreview(d, l)),
    mlCleanings: () => call(() => est.cleanings()),
    mlCleaning: n => call(() => est.cleaning(n)),
    mlSaveCleaning: (n, l, nota) => call(() => est.saveCleaning(n, l, nota)),
    mlCheck: r => call(() => est.check(r)),
    mlCode: (r, parte) => call(() => est.code(r, parte)),
    mlTrain: r => call(() => est.train(r)),
    mlRunCode: () => call(() => est.runCode()),
    mlRuns: () => call(() => est.runs()),
    mlRun: (id, desde) => call(() => est.run(id, desde)),
    mlCancel: id => call(() => est.cancel(id)),
    mlExperiments: () => call(() => est.experiments()),
    mlExperiment: id => call(() => est.experiment(id)),
    mlDeleteExperiment: id => call(() => est.remove(id)),
    mlDownload: (id, f) => call(() => est.download(id, f)),
    mlToJupyter: () => call(() => fail('unsupported', 'En el modo demo no hay JupyterLab: con la imagen ml o full, el notebook se abre en el puerto 8888')),
    mlPredict: () => call(() => fail('unsupported', 'En el modo demo no hay modelos guardados para predecir: probalo con la imagen full')),
    mlLibrary: () => call(() => bib.lista()),
    mlLibraryModel: n => call(() => bib.modelo(n)),
    mlLibraryRegister: r => call(() => bib.registrar(r)),
    mlLibraryState: (n, r) => call(() => bib.estado(n, r)),
    mlLibraryDescribe: (n, d) => call(() => bib.describir(n, d)),
    mlLibraryCompare: (n, vs) => call(() => bib.comparar(n, vs)),
    mlLibraryPredict: (n, r) => call(() => bib.predecir(n, r)),
    mlLibraryBatchCode: (n, r) => call(() => bib.codigo(n, r)),
    mlLibraryBatch: (n, r) => call(() => bib.lote(n, r)),
    mlLibraryBatches: () => call(() => bib.lotes()),
    mlLibraryExport: () => call(() => fail('unsupported', 'En el modo demo no se arma el .zip: con la imagen full se baja el modelo con su ficha, un servicio mínimo (servir.py) y su Dockerfile')),
  };
}
