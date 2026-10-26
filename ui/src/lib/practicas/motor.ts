/* Motor de prácticas: progreso guardado en el navegador, ejecutar un paso, verificarlo.
   Sin React: la pantalla lo usa a través de state/practicas.ts y los tests lo prueban directo. */
import { ApiFailure } from '../../api/errors';
import { capabilities, type Capability } from '../capabilities';
import type { ClusterStatus } from '../../api/types';
import type { Check, Practice, Pregunta, Step, StepCtx, StepResult } from './tipos';

export const STORAGE_KEY = 'bds.practicas.v1';

export type DoneHow = 'run' | 'verify' | 'manual';

export interface StepDone { at: number; how: DoneHow }

/** La primera respuesta al multiple choice de un paso (las siguientes no cuentan) */
export interface Answer { pick: number; ok: boolean; at: number }

export interface PracticeProgress {
  done: Record<string, StepDone>;
  vars: Record<string, string>;
  startedAt: number;
  finishedAt?: number;
  /** Paso → primera respuesta del multiple choice */
  answers?: Record<string, Answer>;
  /** Cuándo se completó por primera vez (sobrevive a "Empezar de nuevo": deja ver las respuestas) */
  completedBefore?: number;
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
        ...(p.answers && typeof p.answers === 'object' && !Array.isArray(p.answers) ? { answers: p.answers } : {}),
        ...(typeof p.completedBefore === 'number' ? { completedBefore: p.completedBefore } : {}),
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
  return { ...p, [pr.id]: { ...cur, done, vars: { ...cur.vars, ...vars }, ...(all ? { finishedAt: cur.finishedAt ?? now, completedBefore: cur.completedBefore ?? now } : {}) } };
}

/** Guarda variables sin marcar el paso (por ejemplo, el id de un trabajo que todavía corre) */
export function setVars(p: Progress, pr: Practice, vars: Record<string, string>): Progress {
  const cur = p[pr.id] ?? empty();
  return { ...p, [pr.id]: { ...cur, vars: { ...cur.vars, ...vars } } };
}

/** Empieza de nuevo: borra pasos, variables y respuestas. Si ya la había completado alguna vez, lo recuerda */
export function resetPractice(p: Progress, id: string, now = Date.now()): Progress {
  const { [id]: old, ...rest } = p;
  const before = old?.completedBefore ?? old?.finishedAt;
  return before ? { ...rest, [id]: { done: {}, vars: {}, startedAt: now, completedBefore: before } } : rest;
}

/* ---------- Multiple choice ---------- */

/** Anota la respuesta a la pregunta de un paso. Solo cuenta la primera: después ya sabés cuál era */
export function answer(p: Progress, pr: Practice, stepId: string, pick: number, now = Date.now()): Progress {
  const step = pr.steps.find(s => s.id === stepId);
  const op = step?.pregunta?.opciones[pick];
  if (!op) return p;
  const cur = p[pr.id] ?? { ...empty(), startedAt: now };
  if (cur.answers?.[stepId]) return p;
  return { ...p, [pr.id]: { ...cur, answers: { ...cur.answers, [stepId]: { pick, ok: !!op.correcta, at: now } } } };
}

/** La opción correcta de una pregunta (su índice) */
export const correctIndex = (q: Pregunta) => q.opciones.findIndex(o => o.correcta);

/** Ya se puede ejecutar el paso: no tiene pregunta, ya la respondió o ya completó la práctica antes */
export function canRun(step: Step, pp?: PracticeProgress): boolean {
  return !step.pregunta || !!pp?.answers?.[step.id] || !!pp?.completedBefore;
}

/** Cuántas preguntas tiene, cuántas respondió y cuántas acertó al primer intento */
export function score(pr: Practice, pp?: PracticeProgress) {
  const asked = pr.steps.filter(s => s.pregunta);
  const ans = asked.map(s => pp?.answers?.[s.id]).filter((a): a is Answer => !!a);
  return { total: asked.length, answered: ans.length, firstTry: ans.filter(a => a.ok).length };
}

/** El orden en que se muestran las opciones: mezclado, pero siempre igual para el mismo paso
    (así la correcta no queda siempre arriba y al recargar no se mueve) */
export function optionOrder(stepId: string, n: number): number[] {
  let h = 2166136261;
  for (const ch of stepId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/* ---------- Comandos con variables ---------- */

/** Reemplaza {variable} por su valor; lo que todavía no se sabe queda como <variable> */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `<${k}>`);
}

/** Las variables de un paso: las que calcula plan() con el estado de ahora y, por encima, las que
    dejaron los pasos anteriores. Es lo mismo que usa la pantalla para mostrar el comando y run para correrlo */
export function stepVars(step: Step, status: ClusterStatus | null, vars: Record<string, string>): Record<string, string> {
  let planned: Record<string, string> = {};
  if (step.plan && status) {
    try { planned = step.plan(status, vars); } catch { planned = {}; }
  }
  return { ...planned, ...vars };
}

/** El comando del paso tal cual va a correr */
export const shownCommand = (step: Step, status: ClusterStatus | null, vars: Record<string, string>) => fill(step.command, stepVars(step, status, vars));

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

/** Nombre corto de cada capacidad, para la lista de lo que necesita una práctica */
export const CAP_LABEL: Partial<Record<Capability['id'], string>> = {
  'hdfs.read': 'HDFS (leer)', 'hdfs.write': 'HDFS', 'yarn.submit': 'YARN', mapreduce: 'MapReduce en YARN', tez: 'Tez',
  spark: 'Spark', pig: 'Pig', sqoop: 'Sqoop', hive: 'Hive', mysql: 'MariaDB (base tienda)', mongodb: 'MongoDB', ha: 'Alta disponibilidad (2 NameNodes)',
  pipeline: 'Pipeline', 'ml.sklearn': 'Machine Learning', 'ml.mllib': 'Spark MLlib', jupyter: 'JupyterLab',
};

/** Una cosa que necesita la práctica; steps dice en qué pasos (vacío si la pide la práctica entera) */
export interface Need { key: string; label: string; cap: Capability; ready: boolean; steps: string[] }

/** Todo lo que necesita una práctica para correr sus pasos desde la interfaz (la capacidad de la
    práctica y la de cada paso, más sus condiciones), sin repetir y en orden de aparición.
    Así se ve antes de empezar qué falta y con qué botón se arregla, en vez de enterarse en el paso 4. */
export function requirements(status: ClusterStatus | null, pr: Practice): Need[] {
  const caps = capabilities(status);
  const out = new Map<string, Need>();
  const whole = new Set<string>();
  const add = (c: Capability, label: string, step?: string) => {
    const key = c.state === 'ready' ? c.id : `${c.id}:${c.reason ?? ''}`;
    if (!step) whole.add(key);
    const r = out.get(key) ?? { key, label, cap: c, ready: c.state === 'ready', steps: [] };
    if (step && !whole.has(key) && !r.steps.includes(step)) r.steps.push(step);
    out.set(key, r);
  };
  const one = (id: Capability['id'], needs: Step['needs'], step?: string) => {
    const c = caps[id];
    add(c, CAP_LABEL[id] ?? id, step);
    if (c.state === 'ready' && status && needs) { const n = needs(status); if (n) add(n, CAP_LABEL[n.id] ?? n.id, step); }
  };
  one(pr.cap, pr.needs);
  pr.steps.forEach((s, i) => { if (s.run && (s.cap || s.needs)) one(s.cap ?? pr.cap, s.needs ?? pr.needs, `${i + 1}`); });
  return [...out.values()];
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

/** Lo que la API no tiene: unsupported, o una ruta que el servidor no conoce (la interfaz es más nueva que él) */
export const notThere = (e: unknown): boolean =>
  e instanceof ApiFailure && (e.code === 'unsupported' || (e.code === 'not_found' && /^No hay [A-Z]+ \/api\//.test(e.message)));

/** Mensaje claro a partir de lo que tiró la API */
export function explain(e: unknown): { error: string; unsupported: boolean } {
  if (e instanceof ApiFailure) {
    if (notThere(e))
      return { unsupported: true, error: 'Este paso todavía no se puede correr desde la interfaz: hacelo con el comando en la terminal del contenedor y marcalo como hecho.' };
    return { unsupported: false, error: e.message };
  }
  return { unsupported: false, error: e instanceof Error ? e.message : String(e) };
}

/** Corre el paso (si tiene run) y después lo verifica (si tiene verify). Nunca tira: devuelve el error */
export async function executeStep(step: Step, ctx: StepCtx): Promise<StepOutcome> {
  let result: StepResult | undefined;
  try {
    if (step.plan) {
      const planned = stepVars(step, await ctx.status(), ctx.vars);
      ctx = { ...ctx, vars: planned };
    }
    if (step.run) result = await step.run(ctx);
    if (result && step.plan) result = { ...result, vars: { ...ctx.vars, ...(result.vars ?? {}) } };
    // La salida cruda sin comando lleva el del paso, con las mismas variables con las que corrió
    if (result?.raw && !result.raw.command) result = { ...result, raw: { ...result.raw, command: fill(step.command, { ...ctx.vars, ...(result.vars ?? {}) }) } };
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

/** Pregunta cada tanto hasta que se cumple o se acaba el tiempo. Devuelve el último valor.
    Espera cada vez un poco más (por defecto 3 s, 4,5 s… hasta 10 s) y nunca pide dos cosas a la vez:
    así no satura al NameNode ni llena la Consola mientras espera */
export async function waitFor<T>(
  ctx: Pick<StepCtx, 'sleep' | 'progress'>, get: () => Promise<T>, ok: (v: T) => boolean,
  opts: { seconds?: number; every?: number; max?: number; factor?: number; what?: string } = {},
): Promise<{ value: T; ok: boolean }> {
  const limit = (opts.seconds ?? 60) * 1000;
  const max = Math.max(opts.max ?? 10000, opts.every ?? 0);
  const factor = opts.factor ?? 1.5;
  let wait = opts.every ?? 3000;
  let waited = 0;
  let value = await get();
  while (!ok(value) && waited < limit) {
    if (opts.what) ctx.progress?.(opts.what);
    const ms = Math.min(wait, max, Math.max(250, limit - waited));
    await ctx.sleep(ms);
    waited += ms;
    wait = Math.min(max, Math.round(wait * factor));
    value = await get();
  }
  return { value, ok: ok(value) };
}

/** Las líneas que comparten todas las opciones (al principio y al final) se muestran una vez, aparte:
    así se ve a simple vista en qué se diferencian. Solo si son 2 líneas o más */
export function splitCommon(cmds: string[]): { pre: string[]; mid: string[]; post: string[] } {
  const ls = cmds.map(c => c.split('\n'));
  const min = Math.min(...ls.map(l => l.length));
  let a = 0;
  while (a < min - 1 && ls.every(l => l[a] === ls[0][a])) a++;
  let b = 0;
  while (b < min - 1 - a && ls.every(l => l[l.length - 1 - b] === ls[0][ls[0].length - 1 - b])) b++;
  if (a < 2) a = 0;
  if (b < 2) b = 0;
  return { pre: ls[0].slice(0, a), mid: ls.map(l => l.slice(a, l.length - b).join('\n')), post: ls[0].slice(ls[0].length - b) };
}
