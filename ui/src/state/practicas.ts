/* Prácticas en el navegador: el progreso guardado (localStorage) y lo que está pasando ahora en
   cada paso (corriendo, qué dio). La lógica está en lib/practicas; acá solo el estado para React. */
import { useSyncExternalStore } from 'react';
import { api } from '../api';
import {
  answer, executeStep, loadProgress, markDone, resetPractice, saveProgress, setVars, verifyStep,
  type Practice, type Progress, type Step, type StepCtx, type StepOutcome,
} from '../lib/practicas';

/** Lo que pasa con un paso en esta visita (no se guarda: al recargar queda solo si está hecho) */
export interface StepLive {
  busy?: 'run' | 'verify';
  /** En qué está mientras espera */
  note?: string;
  outcome?: StepOutcome;
}

interface State { progress: Progress; live: Record<string, StepLive> }

let st: State = { progress: loadProgress(), live: {} };
const subs = new Set<() => void>();
const set = (n: Partial<State>) => { st = { ...st, ...n }; subs.forEach(f => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

const key = (pr: Practice, s: Step) => `${pr.id}/${s.id}`;

function setLive(k: string, v: StepLive | undefined) {
  const live = { ...st.live };
  if (v) live[k] = v; else delete live[k];
  set({ live });
}

function setProgress(p: Progress) {
  saveProgress(p);
  set({ progress: p });
}

export function usePractices(): State { return useSyncExternalStore(subscribe, () => st); }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function ctx(pr: Practice, k: string): StepCtx {
  const a = api();
  return {
    api: a,
    status: () => a.status(),
    vars: { ...(st.progress[pr.id]?.vars ?? {}) },
    sleep,
    progress: note => { const cur = st.live[k]; if (cur?.busy) setLive(k, { ...cur, note }); },
  };
}

async function go(pr: Practice, s: Step, mode: 'run' | 'verify') {
  const k = key(pr, s);
  if (st.live[k]?.busy) return;
  setLive(k, { busy: mode });
  const outcome = mode === 'run' ? await executeStep(s, ctx(pr, k)) : await verifyStep(s, ctx(pr, k));
  setLive(k, { outcome });
  if (outcome.ok) setProgress(markDone(st.progress, pr, s.id, mode, { ...(outcome.vars ?? {}), ...(outcome.result?.vars ?? {}) }));
  else if (outcome.result?.vars) {
    // corrió pero no verificó: igual guarda lo que dejó (el id del trabajo, por ejemplo)
    setProgress(setVars(st.progress, pr, outcome.result.vars));
  }
}

export const runStep = (pr: Practice, s: Step) => go(pr, s, 'run');
export const checkStep = (pr: Practice, s: Step) => go(pr, s, 'verify');

/** "Lo hice en la terminal": lo marca hecho sin verificar. Guarda las variables con las que se mostró
    el comando (qué DataNode, por ejemplo), así el paso siguiente muestra el mismo */
export function markManual(pr: Practice, s: Step, vars: Record<string, string> = {}) {
  setProgress(markDone(st.progress, pr, s.id, 'manual', vars));
  setLive(key(pr, s), undefined);
}

/** Deja fijas las variables con las que se mostró un paso (solo las que faltan: lo guardado gana) */
export function pinStep(pr: Practice, vars: Record<string, string>) {
  const cur = st.progress[pr.id]?.vars ?? {};
  const add = Object.fromEntries(Object.entries(vars).filter(([k]) => cur[k] == null));
  if (Object.keys(add).length) setProgress(setVars(st.progress, pr, add));
}

/** Responde el multiple choice de un paso (cuenta solo la primera vez) */
export function answerStep(pr: Practice, s: Step, pick: number) {
  setProgress(answer(st.progress, pr, s.id, pick));
}

export function undoStep(pr: Practice, s: Step) {
  const pp = st.progress[pr.id];
  if (!pp?.done[s.id]) return;
  const done = { ...pp.done };
  delete done[s.id];
  setProgress({ ...st.progress, [pr.id]: { ...pp, done, finishedAt: undefined } });
}

export function restartPractice(pr: Practice) {
  setProgress(resetPractice(st.progress, pr.id));
  const live = Object.fromEntries(Object.entries(st.live).filter(([k]) => !k.startsWith(`${pr.id}/`)));
  set({ live });
}

export const liveOf = (s: State, pr: Practice, step: Step): StepLive | undefined => s.live[key(pr, step)];
