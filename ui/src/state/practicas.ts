/* Prácticas en el navegador: el progreso guardado (localStorage) y lo que está pasando ahora en
   cada paso (corriendo, qué dio). La lógica está en lib/practicas; acá solo el estado para React. */
import { useSyncExternalStore } from 'react';
import { api } from '../api';
import {
  answer, answerQuiz, executeStep, exportProgress, importProgress, loadProgress, markChallenge, markDone, resetPractice, saveProgress, setVars, terminalOutcome, verifyStep,
  type Practice, type Progress, type Step, type StepCtx, type StepOutcome,
} from '../lib/practicas';
import { terminal } from '../lib/terminal';
import { terminalOpen, toast } from './ui';
import { downloadText } from '../lib/csv';

/** Lo que pasa con un paso en esta visita (no se guarda: al recargar queda solo si está hecho) */
export interface StepLive {
  busy?: 'run' | 'verify' | 'term';
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

function ctx(pr: Practice, k: string, extra: Record<string, string> = {}): StepCtx {
  const a = api();
  return {
    api: a,
    status: () => a.status(),
    vars: { ...(st.progress[pr.id]?.vars ?? {}), ...extra },
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

/** "Correr en la terminal": escribe el comando en la terminal integrada (la abre si hace falta), espera a
    que vuelva el prompt, muestra lo que imprimió y, si el paso se puede verificar, verifica. Corre con las
    variables con las que se mostró el comando, así lo que se verifica es lo que se tipeó */
export async function runInTerminal(pr: Practice, s: Step, command: string, vars: Record<string, string> = {}) {
  const k = key(pr, s);
  if (st.live[k]?.busy) return;
  terminalOpen.set(true);
  setLive(k, { busy: 'term', note: 'Corriendo en la terminal de abajo: podés mirarlo ahí' });
  let run;
  try {
    run = await terminal.run(command);
  } catch (e) {
    setLive(k, { outcome: { ok: false, error: e instanceof Error ? e.message : String(e) } });
    return;
  }
  let verified: StepOutcome | undefined;
  if (s.verify) {
    setLive(k, { busy: 'verify', note: 'Mirando que haya quedado como tiene que dar' });
    verified = await verifyStep(s, ctx(pr, k, vars));
  }
  const outcome = terminalOutcome(command, run, verified);
  setLive(k, { outcome });
  if (outcome.ok) setProgress(markDone(st.progress, pr, s.id, verified ? 'verify' : 'manual', { ...vars, ...(outcome.vars ?? {}) }));
}

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

/** Autoevaluación: responde una pregunta (cuenta la primera) */
export function answerSelf(pr: Practice, qi: number, pick: number, ok: boolean) {
  setProgress(answerQuiz(st.progress, pr, qi, pick, ok));
}

export function solveChallenge(pr: Practice, solved: boolean) {
  setProgress(markChallenge(st.progress, pr, solved));
}

/** Baja el avance de todas las prácticas en un .json */
export function downloadProgress(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  downloadText(`practicas-bigdata-${day}.json`, exportProgress(st.progress, now.getTime()), 'application/json');
}

/** Junta un avance exportado con el de este navegador (de cada práctica queda la más avanzada) */
export async function uploadProgress(file: File) {
  try {
    const { progress, practices } = importProgress(await file.text(), st.progress);
    setProgress(progress);
    toast({ kind: 'ok', title: 'Avance importado', description: `${practices} práctica${practices === 1 ? '' : 's'} del archivo. De cada una quedó la versión más avanzada.` });
  } catch (e) {
    toast({ kind: 'bad', title: 'No se pudo importar', description: e instanceof Error ? e.message : String(e), console: false });
  }
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
