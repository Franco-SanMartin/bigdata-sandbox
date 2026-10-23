/* Modo demo: la misma interfaz que el backend real, respondida por el cluster simulado. */
import type { SandboxApi } from '../types';
import { ApiFailure } from '../errors';
import { composeYaml, estimateRam, validate } from '../../lib/cluster';
import { DemoEngine, SPEED } from './engine';
import { DemoHdfs } from './hdfs';
import { DemoYarn } from './yarn';
import { DemoData } from './datos';
import { DemoMl } from './ml';
import { DemoPipeline } from './pipeline';

export { SPEED as DEMO_SPEED };

export function createDemoApi(): SandboxApi {
  const e = new DemoEngine();
  const hdfs = new DemoHdfs(e);
  const yarn = new DemoYarn(e);
  const data = new DemoData(e);
  const ml = new DemoMl(e);
  const pipe = new DemoPipeline(e, ml, data);
  const ok = <T>(v: T) => Promise.resolve(v);
  /** Los módulos nuevos tiran ApiFailure al validar: así llega como promesa rechazada, igual que del backend */
  const call = <T>(fn: () => T | Promise<T>) => Promise.resolve().then(fn);
  const copy = <T>(v: T): T => structuredClone(v);
  return {
    mode: 'demo',
    now: () => e.now(),
    status: () => ok(e.status()),
    activity: () => ok(e.activity()),
    subscribe: fn => e.subscribe(fn),
    validate: c => ok(validate(c, e.volumeNN)),
    estimate: c => ok(estimateRam(c)),
    compose: c => ok(composeYaml(c)),
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
    app: id => call(() => yarn.app(id)),
    appLogs: (id, c) => call(() => yarn.logs(id, c)),

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
  };
}
