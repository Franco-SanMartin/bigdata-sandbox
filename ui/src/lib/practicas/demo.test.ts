/* Las prácticas de punta a punta contra el cluster simulado del modo demo, con el reloj acelerado. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../../api/demo';
import type { ClusterConfig, SandboxApi } from '../../api/types';
import { executeStep } from './motor';
import { practiceById } from './index';
import type { StepCtx } from './tipos';

const TODO: Partial<ClusterConfig> = { datanodes: 2, replication: 2, namenodes: 1, services: 'todo', mongodb: true };

let api: SandboxApi;
const sleep = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };

/** Algunas respuestas del demo tardan (setTimeout): mientras se espera una, el reloj falso avanza */
function fast(raw: SandboxApi): SandboxApi {
  return new Proxy(raw, {
    get(t, k) {
      const v = Reflect.get(t, k);
      if (typeof v !== 'function') return v;
      return (...a: unknown[]) => {
        const r = v.apply(t, a);
        if (!(r instanceof Promise)) return r;
        let done = false;
        const p = r.then(v => ({ v }), (e: unknown) => ({ e })).finally(() => { done = true; });
        return (async () => {
          for (let i = 0; i < 3000 && !done; i++) await vi.advanceTimersByTimeAsync(100);
          const x = await p;
          if ('e' in x) throw x.e;
          return x.v;
        })();
      };
    },
  });
}

async function boot(cfg: Partial<ClusterConfig>) {
  api = fast(createDemoApi());
  const s0 = await api.status();
  await api.start({ ...s0.config, ...cfg });
  for (let i = 0; i < 600 && (await api.status()).phase !== 'running'; i++) await sleep(1000);
  expect((await api.status()).phase).toBe('running');
  // que termine de levantar los servicios de arriba (HiveServer2, MongoDB…)
  await sleep(30000);
}

/** Corre todos los pasos de una práctica y devuelve id → resultado */
async function play(id: string, skip: string[] = []) {
  const pr = practiceById(id)!;
  const vars: Record<string, string> = {};
  const out: Record<string, { ok: boolean; why: string }> = {};
  for (const s of pr.steps) {
    if (skip.includes(s.id)) continue;
    const c: StepCtx = { api, status: () => api.status(), vars, sleep };
    const o = await executeStep(s, c);
    Object.assign(vars, o.result?.vars ?? {});
    out[s.id] = { ok: o.ok, why: o.error ?? o.check?.detail ?? o.result?.summary ?? '' };
  }
  return out;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('prácticas en el demo', () => {
  it('hdfs-basico: todo menos bajar el archivo (llega con el paquete de HDFS)', async () => {
    await boot(TODO);
    const r = await play('hdfs-basico', ['get']);
    for (const [k, v] of Object.entries(r)) expect(v.ok, `${k}: ${v.why}`).toBe(true);
  }, 60000);

  it('hive, mysql y mongodb', async () => {
    await boot(TODO);
    for (const id of ['hive', 'mongodb']) {
      const r = await play(id);
      for (const [k, v] of Object.entries(r)) expect(v.ok, `${id}/${k}: ${v.why}`).toBe(true);
    }
    const m = await play('mysql-sqoop');
    for (const k of ['productos', 'join', 'sqoop', 'ls']) expect(m[k].ok, `mysql-sqoop/${k}: ${m[k].why}`).toBe(true);
  }, 60000);

  it('pig: LOAD, FILTER y GROUP desde Consultas', async () => {
    await boot(TODO);
    const r = await play('pig');
    for (const [k, v] of Object.entries(r)) expect(v.ok, `${k}: ${v.why}`).toBe(true);
  }, 60000);

  it('hdfs-falla: se cae un DataNode, quedan sub-replicados y vuelve sano', async () => {
    await boot(TODO);
    const r = await play('hdfs-falla');
    for (const [k, v] of Object.entries(r)) expect(v.ok, `${k}: ${v.why}`).toBe(true);
  }, 60000);

  it('ha: failover con 2 NameNodes', async () => {
    await boot({ ...TODO, namenodes: 2 });
    const r = await play('ha');
    for (const [k, v] of Object.entries(r)) expect(v.ok, `${k}: ${v.why}`).toBe(true);
  }, 60000);

  it('spark: las ventas y el DAG (SparkPi llega con el paquete de trabajos)', async () => {
    await boot(TODO);
    const r = await play('spark');
    expect(r.ventas.ok, r.ventas.why).toBe(true);
    expect(r.dag.ok, r.dag.why).toBe(true);
  }, 60000);
});
