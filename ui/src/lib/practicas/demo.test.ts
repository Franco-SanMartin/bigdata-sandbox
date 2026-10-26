/* Las prácticas de punta a punta contra el cluster simulado del modo demo, con el reloj acelerado. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../../api/demo';
import type { ClusterConfig, SandboxApi } from '../../api/types';
import { executeStep, fill, shownCommand, stepVars } from './motor';
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
  const out: Record<string, { ok: boolean; why: string; shown: string; ran?: string }> = {};
  for (const s of pr.steps) {
    if (skip.includes(s.id)) continue;
    const c: StepCtx = { api, status: () => api.status(), vars, sleep };
    // lo que la página muestra antes de Ejecutar
    const st = await api.status();
    const shown = shownCommand(s, st, vars);
    // ninguna {variable} queda sin llenar en lo que se muestra (fill deja <nombre> si no la conoce)
    const v = stepVars(s, st, vars);
    // ni queda una {variable} que fill no sabe llenar (con punto, por ejemplo)
    for (const t of [shown, s.pregunta?.enunciado ?? '', ...(s.pregunta?.opciones.map(o => o.cmd) ?? [])]) {
      expect(fill(t, v), `${id}/${s.id}`).not.toMatch(/<[\w.]+>/);
      expect(fill(t, v), `${id}/${s.id}`).not.toMatch(/\{[\w.]+\}/);
    }
    const o = await executeStep(s, c);
    Object.assign(vars, o.result?.vars ?? {});
    // "Dónde queda" se muestra después de correr: ya con lo que dejó el paso
    for (const t of Object.values(s.donde ?? {})) expect(fill(t, { ...v, ...vars }), `${id}/${s.id} donde`).not.toMatch(/<[\w.]+>|\{[\w.]+\}/);
    out[s.id] = { ok: o.ok, why: o.error ?? o.check?.detail ?? o.result?.summary ?? '', shown, ran: o.result?.raw?.command };
  }
  return out;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('prácticas en el demo', () => {
  it('hdfs-basico: de la carpeta a bajar el archivo', async () => {
    await boot(TODO);
    const r = await play('hdfs-basico');
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
    await boot({ ...TODO, datanodes: 3 });
    const r = await play('hdfs-falla', ['start']);
    for (const [k, v] of Object.entries(r)) expect(v.ok, `${k}: ${v.why}`).toBe(true);
    // el DataNode que dice el comando es el que se apagó (antes mostraba "stop 2" y apagaba el 3)
    const down = (await api.status()).processes.filter(p => p.kind === 'datanode' && p.state !== 'up');
    expect(down).toHaveLength(1);
    const n = down[0].id.replace(/\D/g, '');
    expect(r.stop.shown).toBe(`datanode stop ${n}`);
    expect(r.stop.ran).toBe(r.stop.shown);
    const pr = practiceById('hdfs-falla')!;
    const start = pr.steps.find(s => s.id === 'start')!;
    const c: StepCtx = { api, status: () => api.status(), vars: { dn: down[0].id, dnNum: n }, sleep };
    expect(shownCommand(start, await api.status(), c.vars)).toBe(`datanode start ${n}`);
    const o = await executeStep(start, c);
    expect(o.ok, o.error ?? o.check?.detail).toBe(true);
    expect(o.result?.raw?.command).toBe(`datanode start ${n}`);
    expect((await api.status()).processes.find(p => p.id === down[0].id)?.state).toBe('up');
  }, 90000);

  it('lo que se muestra es lo que corre, en todas las prácticas', async () => {
    await boot(TODO);
    for (const id of ['hdfs-basico', 'mapreduce', 'pig', 'hive', 'mysql-sqoop', 'spark', 'mongodb']) {
      const r = await play(id);
      for (const [k, v] of Object.entries(r)) if (v.ran) expect(v.ran, `${id}/${k}`).toBe(v.shown);
    }
  }, 60000);

  it('ha: failover con 2 NameNodes', async () => {
    await boot({ ...TODO, namenodes: 2 });
    const nn = (await api.status()).processes.find(p => p.kind === 'namenode' && p.role === 'active')!.id.replace(/\D/g, '');
    const r = await play('ha');
    for (const [k, v] of Object.entries(r)) expect(v.ok, `${k}: ${v.why}`).toBe(true);
    // apaga y prende el que estaba activo, y lo que dice el comando es lo que corre
    expect(r.apagar.shown).toBe(`namenode stop ${nn}`);
    expect(r.volver.shown).toBe(`namenode start ${nn}`);
    for (const [k, v] of Object.entries(r)) if (v.ran) expect(v.ran, `ha/${k}`).toBe(v.shown);
  }, 60000);

  it('mapreduce: el wordcount de la entrada al part-r-00000', async () => {
    await boot(TODO);
    const r = await play('mapreduce');
    for (const [k, v] of Object.entries(r)) expect(v.ok, `${k}: ${v.why}`).toBe(true);
  }, 60000);

  it('spark: SparkPi, las ventas y el DAG', async () => {
    await boot(TODO);
    const r = await play('spark');
    for (const [k, v] of Object.entries(r)) expect(v.ok, `${k}: ${v.why}`).toBe(true);
  }, 60000);
});
