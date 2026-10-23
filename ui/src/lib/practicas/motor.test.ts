import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../../api/errors';
import type { ClusterStatus, SandboxApi } from '../../api/types';
import {
  STORAGE_KEY, currentStep, doneCount, executeStep, loadProgress, markDone, practiceState, resetPractice, saveProgress,
  setVars, suggested, verifyStep, waitFor, type Storage,
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
    expect(resetPractice(p, 'p')).toEqual({});
  });

  it('persiste y vuelve a leer lo mismo', () => {
    const st = mem();
    const p = markDone({}, P, 'a', 'verify', {}, 7);
    saveProgress(p, st);
    expect(loadProgress(st)).toEqual(p);
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
