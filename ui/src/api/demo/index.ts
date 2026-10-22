/* Modo demo: la misma interfaz que el backend real, respondida por el cluster simulado. */
import type { SandboxApi } from '../types';
import { composeYaml, estimateRam, validate } from '../../lib/cluster';
import { DemoEngine, SPEED } from './engine';

export { SPEED as DEMO_SPEED };

export function createDemoApi(): SandboxApi {
  const e = new DemoEngine();
  const ok = <T>(v: T) => Promise.resolve(v);
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
    dataNodes: () => ok(e.dataNodes()),
    files: () => ok(e.filesView()),
    putExample: x => ok(e.putExample(x)),
    setReplication: (p, n) => ok(e.setReplication(p, n)),
    addDataNode: () => ok(e.addDataNode()),
    apps: () => ok(e.apps()),
    submitExample: j => ok(e.submitExample(j)),
    killApp: id => ok(e.killApp(id)),
  };
}
