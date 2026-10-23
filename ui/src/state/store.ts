/* Estado del cluster en el navegador: una foto que se refresca con cada evento de la API. */
import { useSyncExternalStore } from 'react';
import { api } from '../api';
import type { Activity, ApiEvent, BlockTransfer, ClusterStatus, DataNode, HdfsFile, YarnApp } from '../api/types';

export interface Snapshot {
  status: ClusterStatus | null;
  dataNodes: DataNode[];
  files: HdfsFile[];
  apps: YarnApp[];
  activity: Activity[];
  error: string | null;
  /** Sin conexión: cuándo es el próximo intento (ms) y cuántos fallaron seguidos */
  retryAt: number | null;
  failures: number;
}

let snap: Snapshot = { status: null, dataNodes: [], files: [], apps: [], activity: [], error: null, retryAt: null, failures: 0 };
/** Espera entre intentos sin conexión: 2, 4, 8 y después cada 15 s */
export const retryDelay = (failures: number) => Math.min(15000, 1000 * 2 ** Math.max(1, failures));
const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());
const transferSubs = new Set<(t: BlockTransfer) => void>();
const activitySubs = new Set<(a: Activity) => void>();
const eventSubs = new Set<(e: ApiEvent) => void>();

let queued = false;
function schedule(force = false) {
  if (queued) return;
  // Sin conexión no se insiste en cada tic: se espera la cuenta regresiva (o el botón Reintentar)
  if (!force && snap.retryAt && Date.now() < snap.retryAt) return;
  queued = true;
  // setTimeout y no requestAnimationFrame: rAF se frena con la pestaña en segundo plano
  setTimeout(async () => {
    queued = false;
    try {
      const a = api();
      // Primero el estado. /yarn/apps contesta 409 con el cluster apagado y 503 sin el
      // ResourceManager: en esos casos ni se pide (si no, la consola se llena de errores cada 2 s)
      const status = await a.status();
      snap = { ...snap, status };
      const yarn = status.phase === 'running' && status.processes.some(p => p.id === 'rm' && p.state === 'up');
      const [dataNodes, files, apps] = await Promise.all([a.dataNodes(), a.files(), yarn ? a.apps() : []]);
      snap = { ...snap, dataNodes, files, apps, error: null, retryAt: null, failures: 0 };
    } catch (e) {
      const failures = snap.failures + 1;
      snap = { ...snap, error: e instanceof Error ? e.message : String(e), failures, retryAt: Date.now() + retryDelay(failures) };
    }
    notify();
  }, 50);
}

export async function startStore() {
  const a = api();
  // Si el contenedor no contesta al abrir, la actividad se pide de nuevo cuando vuelva
  const loadActivity = () => a.activity().then(activity => { snap = { ...snap, activity }; notify(); }, () => { pendingActivity = true; });
  let pendingActivity = false;
  await loadActivity();
  subs.add(() => { if (pendingActivity && !snap.error && snap.status) { pendingActivity = false; loadActivity(); } });
  a.subscribe(ev => {
    if (ev.type === 'activity') { snap = { ...snap, activity: [ev.entry, ...snap.activity].slice(0, 400) }; activitySubs.forEach(f => f(ev.entry)); }
    if (ev.type === 'transfer') transferSubs.forEach(f => f(ev.transfer));
    eventSubs.forEach(f => f(ev));
    // Llegó un evento: el contenedor contesta, no hace falta esperar la cuenta regresiva
    schedule(true);
  });
  // Relojes, barras de progreso y, en vivo, por si se pierde un evento
  setInterval(() => schedule(), a.mode === 'demo' ? 1000 : 2000);
  schedule();
}

/** Reintentar ya, sin esperar la cuenta regresiva */
export function retryNow() { snap = { ...snap, retryAt: null }; notify(); schedule(true); }

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useSnapshot(): Snapshot { return useSyncExternalStore(subscribe, () => snap); }
export function useStatus(): ClusterStatus | null { return useSyncExternalStore(subscribe, () => snap.status); }
export const getSnapshot = () => snap;
export function onTransfer(f: (t: BlockTransfer) => void) { transferSubs.add(f); return () => { transferSubs.delete(f); }; }
export function onActivity(f: (a: Activity) => void) { activitySubs.add(f); return () => { activitySubs.delete(f); }; }
/** Cualquier evento de la API (hdfs, yarn, step, model…), para las pantallas que piden sus propios datos */
export function onEvent(f: (e: ApiEvent) => void) { eventSubs.add(f); return () => { eventSubs.delete(f); }; }
