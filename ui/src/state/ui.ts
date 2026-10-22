/* Estado de la interfaz: ruta, paneles abiertos, avisos y confirmaciones. */
import { useSyncExternalStore } from 'react';
import type { ClusterConfig } from '../api/types';

function store<T>(init: T) {
  let v = init; const subs = new Set<() => void>();
  return {
    get: () => v,
    set: (n: T | ((p: T) => T)) => { v = typeof n === 'function' ? (n as (p: T) => T)(v) : n; subs.forEach(f => f()); },
    use: () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => v),
  };
}

/* ---------- Rutas (#cluster, #hdfs…) ---------- */
export const PAGES = ['cluster', 'hdfs', 'yarn', 'pipeline', 'datos', 'ml', 'consola', 'config'] as const;
export type PageId = typeof PAGES[number];
const readHash = (): PageId => { const h = location.hash.slice(1) as PageId; return PAGES.includes(h) ? h : 'cluster'; };
export const route = store<PageId>(readHash());
addEventListener('hashchange', () => route.set(readHash()));
export function navigate(p: PageId) { if (location.hash.slice(1) !== p) location.hash = p; route.set(p); }

/* ---------- Paneles ---------- */
export const consoleOpen = store(false);
export const helpOpen = store(false);
export const paletteOpen = store(false);
export const composeOpen = store(false);
/** La configuración que muestra el docker-compose.yml (el borrador de Configuración, si hay) */
export const composeDraft = store<ClusterConfig | null>(null);
export const consoleFilter = store<{ processId?: string; appId?: string } | null>(null);

/* ---------- Avisos ---------- */
export interface ToastMsg { id: number; title: string; description?: string; kind?: 'ok' | 'bad' | 'run' | 'info' }
export const toasts = store<ToastMsg[]>([]);
let tid = 0;
export function toast(t: Omit<ToastMsg, 'id'>) { toasts.set(l => [...l.slice(-3), { ...t, id: ++tid }]); }
export function dismissToast(id: number) { toasts.set(l => l.filter(x => x.id !== id)); }

/* ---------- Confirmaciones ---------- */
export interface ConfirmReq {
  title: string;
  description: string;
  facts?: [string, string][];
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}
export const confirmReq = store<ConfirmReq | null>(null);
export function confirm(r: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise(resolve => confirmReq.set({ ...r, resolve }));
}
