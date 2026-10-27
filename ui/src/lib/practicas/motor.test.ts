import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../../api/errors';
import type { ClusterStatus, SandboxApi } from '../../api/types';
import {
  STORAGE_KEY, answer, canRun, currentStep, doneCount, executeStep, fill, loadProgress, markDone, optionOrder, practiceState,
  requirements, resetPractice, saveProgress, score, shownCommand, notThere, pinVars, setVars, stepVars, suggested, terminalOutcome, verifyStep, waitFor, type Storage,
} from './motor';
import { PRACTICES, practiceById } from './index';
import type { Practice, StepCtx } from './tipos';

const mem = (init: Record<string, string> = {}): Storage & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};

const P: Practice = {
  id: 'p', guide: '03', guideFile: '03-hdfs.md', title: 'Prueba', summary: '', minutes: 1, cap: 'hdfs.read', learn: [],
  steps: [
    { id: 'a', title: 'A', command: 'a', input: '', does: '', expect: '' },
    { id: 'b', title: 'B', command: 'b', input: '', does: '', expect: '' },
  ],
};

const ctx = (over: Partial<StepCtx> = {}): StepCtx => ({
  api: {} as SandboxApi, status: async () => ({}) as ClusterStatus, vars: {}, sleep: async () => {}, ...over,
});

describe('progreso', () => {
  it('arranca vacío y tolera lo guardado roto', () => {
    expect(loadProgress(mem())).toEqual({});
    expect(loadProgress(mem({ [STORAGE_KEY]: '{no es json' }))).toEqual({});
    expect(loadProgress(mem({ [STORAGE_KEY]: '[1,2]' }))).toEqual({});
    const p = loadProgress(mem({ [STORAGE_KEY]: JSON.stringify({ p: { done: 3, startedAt: 5 }, q: null }) }));
    expect(p).toEqual({ p: { done: {}, vars: {}, startedAt: 5 } });
  });

  it('marca pasos, guarda variables y cierra la práctica al completar', () => {
    let p = markDone({}, P, 'a', 'run', { app: 'x' }, 10);
    expect(practiceState(P, p.p)).toBe('en-curso');
    expect(currentStep(P, p.p)?.id).toBe('b');
    expect(p.p.vars).toEqual({ app: 'x' });
    p = setVars(p, P, { nn: 'nn1' });
    p = markDone(p, P, 'b', 'manual', {}, 20);
    expect(practiceState(P, p.p)).toBe('completa');
    expect(p.p.finishedAt).toBe(20);
    expect(doneCount(P, p.p)).toBe(2);
    expect(currentStep(P, p.p)).toBeNull();
    expect(p.p.vars).toEqual({ app: 'x', nn: 'nn1' });
    expect(p.p.completedBefore).toBe(20);
    expect(resetPractice(p, 'p', 30)).toEqual({ p: { done: {}, vars: {}, startedAt: 30, completedBefore: 20 } });
    expect(resetPractice(markDone({}, P, 'a', 'run'), 'p')).toEqual({});
  });

  it('guarda los campos nuevos al releer', () => {
    const st = mem({ [STORAGE_KEY]: JSON.stringify({ p: { done: {}, vars: {}, startedAt: 1, answers: { a: { pick: 1, ok: false, at: 2 } }, completedBefore: 9 } }) });
    expect(loadProgress(st).p).toEqual({ done: {}, vars: {}, startedAt: 1, answers: { a: { pick: 1, ok: false, at: 2 } }, completedBefore: 9 });
  });

  it('persiste y vuelve a leer lo mismo', () => {
    const st = mem();
    const p = markDone({}, P, 'a', 'verify', {}, 7);
    saveProgress(p, st);
    expect(loadProgress(st)).toEqual(p);
  });
});

const Q: Practice = {
  ...P,
  steps: [
    { ...P.steps[0], pregunta: { enunciado: '¿?', opciones: [{ cmd: 'x', porque: 'no' }, { cmd: 'a', correcta: true, porque: 'sí' }, { cmd: 'y', porque: 'no' }] } },
    { ...P.steps[1], pregunta: { enunciado: '¿?', opciones: [{ cmd: 'b', correcta: true, porque: 'sí' }, { cmd: 'z', porque: 'no' }] } },
  ],
};

describe('multiple choice', () => {
  it('cuenta solo la primera respuesta y deja ejecutar después de responder', () => {
    expect(canRun(Q.steps[0], undefined)).toBe(false);
    expect(canRun(P.steps[0], undefined)).toBe(true);
    let p = answer({}, Q, 'a', 0, 5);
    expect(p.p.answers?.a).toEqual({ pick: 0, ok: false, at: 5 });
    p = answer(p, Q, 'a', 1, 6);
    expect(p.p.answers?.a.ok).toBe(false);
    expect(canRun(Q.steps[0], p.p)).toBe(true);
    p = answer(p, Q, 'b', 0);
    expect(score(Q, p.p)).toEqual({ total: 2, answered: 2, firstTry: 1 });
    expect(answer(p, Q, 'b', 9)).toBe(p);
  });

  it('si ya la completó antes puede ver las respuestas sin responder', () => {
    expect(canRun(Q.steps[0], { done: {}, vars: {}, startedAt: 0, completedBefore: 1 })).toBe(true);
  });

  it('mezcla las opciones siempre igual para el mismo paso', () => {
    const o = optionOrder('put', 4);
    expect([...o].sort()).toEqual([0, 1, 2, 3]);
    expect(optionOrder('put', 4)).toEqual(o);
    const firsts = new Set(['mkdir', 'put', 'ls', 'cat', 'setrep', 'fsck', 'get', 'stop'].map(id => optionOrder(id, 4)[0]));
    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe('comandos con variables', () => {
  const S = { ...P.steps[0], command: 'datanode stop {dn}', plan: () => ({ dn: '3' }) };
  it('fill deja marcado lo que todavía no se sabe', () => {
    expect(fill('yarn logs -applicationId {app}', {})).toBe('yarn logs -applicationId <app>');
    expect(fill('{a}-{b}', { a: '1', b: '2' })).toBe('1-2');
  });

  it('lo que se muestra y lo que corre salen de lo mismo; lo guardado gana', async () => {
    const st = {} as ClusterStatus;
    expect(shownCommand(S, st, {})).toBe('datanode stop 3');
    expect(shownCommand(S, null, {})).toBe('datanode stop <dn>');
    expect(stepVars(S, st, { dn: '2' })).toEqual({ dn: '2' });
    const o = await executeStep({ ...S, run: async c => ({ summary: fill(S.command, c.vars) }) }, ctx());
    expect(o.result?.summary).toBe('datanode stop 3');
    expect(o.result?.vars).toEqual({ dn: '3' });
  });
});

describe('ejecutar y verificar', () => {
  it('corre, pasa las variables a la verificación y devuelve ok', async () => {
    const o = await executeStep({ ...P.steps[0], run: async () => ({ summary: 'listo', vars: { n: '3' } }), verify: async c => ({ ok: c.vars.n === '3', detail: c.vars.n }) }, ctx());
    expect(o.ok).toBe(true);
    expect(o.result?.summary).toBe('listo');
    expect(o.check?.detail).toBe('3');
  });

  it('un método que todavía no existe avisa que se hace en la terminal', async () => {
    const o = await executeStep({ ...P.steps[0], run: async () => { throw new ApiFailure('Bajar archivos: todavía no está', 'unsupported', 501); } }, ctx());
    expect(o.ok).toBe(false);
    expect(o.unsupported).toBe(true);
    expect(o.error).toMatch(/terminal/);
  });

  it('un error de la API llega con su mensaje y no tira', async () => {
    const o = await executeStep({ ...P.steps[0], run: async () => { throw new ApiFailure('El cluster está apagado', 'cluster_stopped'); } }, ctx());
    expect(o).toMatchObject({ ok: false, unsupported: false, error: 'El cluster está apagado' });
  });

  it('verificar sin verificación automática lo dice', async () => {
    const o = await verifyStep(P.steps[0], ctx());
    expect(o.ok).toBe(false);
    expect(o.error).toMatch(/marcalo/);
  });

  it('waitFor pregunta hasta que se cumple', async () => {
    let n = 0;
    const w = await waitFor(ctx(), async () => ++n, v => v >= 3, { seconds: 10, every: 1000 });
    expect(w).toEqual({ value: 3, ok: true });
    const z = await waitFor(ctx(), async () => 0, v => v > 0, { seconds: 2, every: 1000 });
    expect(z.ok).toBe(false);
  });

  it('waitFor espera cada vez más (3 s → 10 s) y no se pasa del tiempo', async () => {
    const slept: number[] = [];
    let calls = 0;
    const w = await waitFor(ctx({ sleep: async ms => { slept.push(ms); } }), async () => ++calls, () => false, { seconds: 40 });
    expect(w.ok).toBe(false);
    expect(slept.slice(0, 4)).toEqual([3000, 4500, 6750, 10000]);
    expect(Math.max(...slept)).toBeLessThanOrEqual(10000);
    expect(slept.reduce((a, b) => a + b, 0)).toBe(40000);
    expect(calls).toBe(slept.length + 1);
  });
});

describe('catálogo', () => {
  it('son las 9 prácticas de las guías, con ids únicos y cada paso con comando', () => {
    expect(PRACTICES.map(p => p.id)).toEqual(['hdfs-basico', 'hdfs-falla', 'mapreduce', 'pig', 'hive', 'mysql-sqoop', 'spark', 'ha', 'mongodb']);
    for (const p of PRACTICES) {
      expect(new Set(p.steps.map(s => s.id)).size).toBe(p.steps.length);
      for (const s of p.steps) {
        expect(s.command.length, `${p.id}/${s.id}`).toBeGreaterThan(0);
        expect(s.expect.length, `${p.id}/${s.id}`).toBeGreaterThan(0);
        expect(s.run || s.verify, `${p.id}/${s.id}`).toBeTruthy();
      }
    }
    expect(practiceById('hive')?.guide).toBe('06');
  });

  it('sugiere primero las empezadas y no las completas', () => {
    const [a, b] = PRACTICES;
    let p = markDone({}, b, b.steps[0].id, 'run');
    for (const s of a.steps) p = markDone(p, a, s.id, 'run');
    const sug = suggested(PRACTICES, p, null, 3);
    expect(sug[0].id).toBe(b.id);
    expect(sug.map(x => x.id)).not.toContain(a.id);
  });
});

describe('notThere', () => {
  it('una ruta que el servidor no conoce cuenta como unsupported; un archivo que no está, no', () => {
    expect(notThere(new ApiFailure('No hay GET /api/hdfs/cat', 'not_found'))).toBe(true);
    expect(notThere(new ApiFailure('Pig no está', 'unsupported'))).toBe(true);
    expect(notThere(new ApiFailure('No existe /user/root/x', 'not_found'))).toBe(false);
    expect(notThere(new Error('No hay GET /api/hdfs/cat'))).toBe(false);
  });
});

describe('requirements', () => {
  it('junta lo de la práctica y lo de cada paso, sin repetir, y dice en qué paso se usa', () => {
    const pr = practiceById('mysql-sqoop')!;
    const r = requirements(null, pr);
    expect(r.every(n => !n.ready && !!n.cap.reason)).toBe(true);
    const ids = r.map(n => n.cap.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r[0].cap.id).toBe(pr.cap);
    expect(r[0].steps).toEqual([]);
    const sq = r.find(n => n.cap.id === 'sqoop')!;
    const n = pr.steps.findIndex(s => s.cap === 'sqoop') + 1;
    expect(sq.steps).toContain(String(n));
  });
  it('cada práctica tiene al menos lo suyo en la lista', () => {
    for (const pr of PRACTICES) expect(requirements(null, pr)[0].cap.id, pr.id).toBe(pr.cap);
  });
});

describe('DataNode fijo en hdfs-falla', () => {
  const pr = practiceById('hdfs-falla')!;
  const step = (id: string) => pr.steps.find(s => s.id === id)!;
  const dn = (n: number, state: string) => ({ id: `dn${n}`, kind: 'datanode', name: `DataNode ${n}`, state }) as unknown as ClusterStatus['processes'][number];
  const st = (...states: string[]) => ({ processes: states.map((x, i) => dn(i + 1, x)) }) as unknown as ClusterStatus;

  it('el número se fija al mostrar "Apagar" y no cambia al apagarlo en la terminal', () => {
    const pin = pinVars(step('stop'), st('up', 'up', 'up'), {});
    expect(pin).toMatchObject({ dn: 'dn3', dnNum: '3' });
    const vars = { ...pin };
    // Ya apagado el 3 desde la terminal: "el último prendido" sería el 2, pero queda el 3
    expect(pinVars(step('stop'), st('up', 'up', 'down'), vars)).toBeNull();
    expect(shownCommand(step('stop'), st('up', 'up', 'down'), vars)).toContain('3');
    expect(shownCommand(step('start'), st('up', 'up', 'down'), vars)).toMatch(/start 3\b/);
  });

  it('si se perdió lo guardado, "Volver a prender" usa el que está apagado', () => {
    expect(shownCommand(step('start'), st('up', 'up', 'down'), {})).toMatch(/start 3\b/);
    expect(shownCommand(step('start'), st('up', 'down', 'up'), {})).toMatch(/start 2\b/);
  });
});

describe('Correr en la terminal', () => {
  const run = (exitCode: number) => ({ lines: ['Found 1 items', '-rw-r--r--   3 root supergroup  6 /x'], exitCode });
  it('sin verificación alcanza con el código 0, y la salida es la de la terminal', () => {
    const o = terminalOutcome('hdfs dfs -ls /x', run(0));
    expect(o.ok).toBe(true);
    expect(o.result?.raw).toEqual({ command: 'hdfs dfs -ls /x', exitCode: 0, origen: 'terminal', lines: [
      { stream: 'out', text: 'Found 1 items' }, { stream: 'out', text: '-rw-r--r--   3 root supergroup  6 /x' }] });
    const bad = terminalOutcome('hdfs dfs -ls /x', run(1));
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/código 1/);
  });
  it('con verificación manda lo que diga la verificación (aunque el comando haya salido bien)', () => {
    const v = terminalOutcome('hdfs dfs -ls /x', run(0), { ok: false, check: { ok: false, detail: 'Tiene réplica 2' } });
    expect(v.ok).toBe(false);
    expect(v.check?.detail).toBe('Tiene réplica 2');
    expect(v.result?.raw?.origen).toBe('terminal');
    const ok = terminalOutcome('x', run(0), { ok: true, check: { ok: true, detail: 'Réplica 3' }, vars: { dn: '2' } });
    expect(ok).toMatchObject({ ok: true, vars: { dn: '2' }, result: { summary: 'Corrió en tu terminal' } });
  });
});
