/* Motor de prácticas: progreso guardado en el navegador, ejecutar un paso, verificarlo.
   Sin React: la pantalla lo usa a través de state/practicas.ts y los tests lo prueban directo. */
import { ApiFailure } from '../../api/errors';
import { capabilities, type Capability } from '../capabilities';
import type { ClusterStatus } from '../../api/types';
import type { Check, Practice, Step, StepCtx, StepResult } from './tipos';

export const STORAGE_KEY = 'bds.practicas.v1';

export type DoneHow = 'run' | 'verify' | 'manual';

export interface StepDone { at: number; how: DoneHow }

export interface PracticeProgress {
  done: Record<string, StepDone>;
  vars: Record<string, string>;
  startedAt: number;
  finishedAt?: number;
}

export type Progress = Record<string, PracticeProgress>;

/** Dónde se guarda: localStorage en el navegador, un objeto en memoria en los tests */
export interface Storage { getItem(k: string): string | null; setItem(k: string, v: string): void }

function defaultStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Lee el progreso; si lo guardado está roto, arranca de cero sin romper la pantalla */
export function loadProgress(st: Storage | null = defaultStorage()): Progress {
  if (!st) return {};
  try {
    const raw = st.getItem(STORAGE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Progress = {};
    for (const [k, p] of Object.entries(v as Record<string, Partial<PracticeProgress>>)) {
      if (!p || typeof p !== 'object') continue;
      out[k] = {
        done: p.done && typeof p.done === 'object' ? p.done : {},
        vars: p.vars && typeof p.vars === 'object' ? p.vars : {},
        startedAt: typeof p.startedAt === 'number' ? p.startedAt : Date.now(),
        ...(typeof p.finishedAt === 'number' ? { finishedAt: p.finishedAt } : {}),
      };
    }
    return out;
  } catch { return {}; }
}

export function saveProgress(p: Progress, st: Storage | null = defaultStorage()) {
  if (!st) return;
  try { st.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* sin lugar o bloqueado: el progreso queda en memoria */ }
}

const empty = (): PracticeProgress => ({ done: {}, vars: {}, startedAt: Date.now() });

/** Marca un paso hecho y suma las variables que dejó. Devuelve un progreso nuevo */
export function markDone(p: Progress, pr: Practice, stepId: string, how: DoneHow, vars: Record<string, string> = {}, now = Date.now()): Progress {
  const cur = p[pr.id] ?? { ...empty(), startedAt: now };
  const done = { ...cur.done, [stepId]: { at: now, how } };
  const all = pr.steps.every(s => done[s.id]);
  return { ...p, [pr.id]: { ...cur, done, vars: { ...cur.vars, ...vars }, ...(all ? { finishedAt: cur.finishedAt ?? now } : {}) } };
}

/** Guarda variables sin marcar el paso (por ejemplo, el id de un trabajo que todavía corre) */
export function setVars(p: Progress, pr: Practice, vars: Record<string, string>): Progress {
  const cur = p[pr.id] ?? empty();
  return { ...p, [pr.id]: { ...cur, vars: { ...cur.vars, ...vars } } };
}

export function resetPractice(p: Progress, id: string): Progress {
  const { [id]: _, ...rest } = p;
  return rest;
}

/** El primer paso sin hacer (o null si está completa) */
export function currentStep(pr: Practice, pp?: PracticeProgress): Step | null {
  return pr.steps.find(s => !pp?.done[s.id]) ?? null;
}

export type PracticeState = 'nueva' | 'en-curso' | 'completa';

export function practiceState(pr: Practice, pp?: PracticeProgress): PracticeState {
  if (!pp || Object.keys(pp.done).length === 0) return 'nueva';
  return pr.steps.every(s => pp.done[s.id]) ? 'completa' : 'en-curso';
}

export function doneCount(pr: Practice, pp?: PracticeProgress) {
  return pr.steps.filter(s => pp?.done[s.id]).length;
}

/** Lo que bloquea una práctica o un paso ahora mismo: su capacidad o su requisito propio */
export function blocker(status: ClusterStatus | null, pr: Practice, step?: Step): Capability | null {
  const caps = capabilities(status);
  const cap = caps[step?.cap ?? pr.cap];
  if (cap.state !== 'ready') return cap;
  if (!status) return null;
  return step?.needs?.(status) ?? pr.needs?.(status) ?? null;
}

/** Las que conviene seguir: primero las empezadas, después las que se pueden hacer ya, en orden de guía */
export function suggested(list: Practice[], p: Progress, status: ClusterStatus | null, n = 3): Practice[] {
  const rank = (pr: Practice) => {
    const st = practiceState(pr, p[pr.id]);
    if (st === 'completa') return 3;
    const can = !blocker(status, pr);
    if (st === 'en-curso') return can ? 0 : 1;
    return can ? 1 : 2;
  };
  return list.map((pr, i) => ({ pr, i, r: rank(pr) }))
    .filter(x => x.r < 3)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, n).map(x => x.pr);
}

/** Lo que devuelve ejecutar un paso: el resultado (si corrió), la verificación (si tiene) o el error */
export interface StepOutcome {
  ok: boolean;
  result?: StepResult;
  check?: Check;
  error?: string;
  /** El método todavía no existe en esta versión de la interfaz: el paso se hace en la terminal */
  unsupported?: boolean;
}

/** Mensaje claro a partir de lo que tiró la API */
export function explain(e: unknown): { error: string; unsupported: boolean } {
  if (e instanceof ApiFailure) {
    if (e.code === 'unsupported')
      return { unsupported: true, error: 'Este paso todavía no se puede correr desde la interfaz: hacelo con el comando en la terminal del contenedor y marcalo como hecho.' };
    return { unsupported: false, error: e.message };
  }
  return { unsupported: false, error: e instanceof Error ? e.message : String(e) };
}

/** Corre el paso (si tiene run) y después lo verifica (si tiene verify). Nunca tira: devuelve el error */
export async function executeStep(step: Step, ctx: StepCtx): Promise<StepOutcome> {
  let result: StepResult | undefined;
  try {
    if (step.run) result = await step.run(ctx);
  } catch (e) {
    return { ok: false, ...explain(e) };
  }
  if (!step.verify) return { ok: true, result };
  const vars = { ...ctx.vars, ...(result?.vars ?? {}) };
  try {
    const check = await step.verify({ ...ctx, vars });
    return { ok: check.ok, result, check };
  } catch (e) {
    const x = explain(e);
    return { ok: false, result, check: { ok: false, detail: x.error }, ...x };
  }
}

/** Solo la verificación (botón Verificar, para lo que se hizo en la terminal) */
export async function verifyStep(step: Step, ctx: StepCtx): Promise<StepOutcome> {
  if (!step.verify) return { ok: false, error: 'Este paso no tiene verificación automática: marcalo como hecho si te dio lo esperado.' };
  try {
    const check = await step.verify(ctx);
    return { ok: check.ok, check };
  } catch (e) {
    return { ok: false, ...explain(e) };
  }
}

/** Pregunta cada tanto hasta que se cumple o se acaba el tiempo. Devuelve el último valor */
export async function waitFor<T>(
  ctx: Pick<StepCtx, 'sleep' | 'progress'>, get: () => Promise<T>, ok: (v: T) => boolean,
  opts: { seconds?: number; every?: number; what?: string } = {},
): Promise<{ value: T; ok: boolean }> {
  const every = opts.every ?? 1500;
  const tries = Math.max(1, Math.ceil(((opts.seconds ?? 60) * 1000) / every));
  let value = await get();
  for (let i = 0; i < tries && !ok(value); i++) {
    if (opts.what) ctx.progress?.(opts.what);
    await ctx.sleep(every);
    value = await get();
  }
  return { value, ok: ok(value) };
}
