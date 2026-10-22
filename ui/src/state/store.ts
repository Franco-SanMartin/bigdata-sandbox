/* Estado del cluster en el navegador: una foto que se refresca con cada evento de la API. */
import { useSyncExternalStore } from 'react';
import { api } from '../api';
import type { Activity, BlockTransfer, ClusterStatus, DataNode, HdfsFile, YarnApp } from '../api/types';

export interface Snapshot {
  status: ClusterStatus | null;
  dataNodes: DataNode[];
  files: HdfsFile[];
  apps: YarnApp[];
  activity: Activity[];
  error: string | null;
}

let snap: Snapshot = { status: null, dataNodes: [], files: [], apps: [], activity: [], error: null };
const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());
const transferSubs = new Set<(t: BlockTransfer) => void>();
const activitySubs = new Set<(a: Activity) => void>();

let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  // setTimeout y no requestAnimationFrame: rAF se frena con la pestaña en segundo plano
  setTimeout(async () => {
    queued = false;
    try {
      const a = api();
      const [status, dataNodes, files, apps] = await Promise.all([a.status(), a.dataNodes(), a.files(), a.apps()]);
      snap = { ...snap, status, dataNodes, files, apps, error: null };
    } catch (e) {
      snap = { ...snap, error: e instanceof Error ? e.message : String(e) };
    }
    notify();
  }, 50);
}

export async function startStore() {
  const a = api();
  snap = { ...snap, activity: await a.activity() };
  a.subscribe(ev => {
    if (ev.type === 'activity') { snap = { ...snap, activity: [ev.entry, ...snap.activity].slice(0, 400) }; activitySubs.forEach(f => f(ev.entry)); }
    if (ev.type === 'transfer') transferSubs.forEach(f => f(ev.transfer));
    schedule();
  });
  // Relojes, barras de progreso y, en vivo, por si se pierde un evento
  setInterval(schedule, a.mode === 'demo' ? 1000 : 2000);
  schedule();
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useSnapshot(): Snapshot { return useSyncExternalStore(subscribe, () => snap); }
export function useStatus(): ClusterStatus | null { return useSyncExternalStore(subscribe, () => snap.status); }
export const getSnapshot = () => snap;
export function onTransfer(f: (t: BlockTransfer) => void) { transferSubs.add(f); return () => { transferSubs.delete(f); }; }
export function onActivity(f: (a: Activity) => void) { activitySubs.add(f); return () => { activitySubs.delete(f); }; }
