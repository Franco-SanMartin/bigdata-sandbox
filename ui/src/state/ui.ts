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

/* ---------- Rutas (#inicio, #hdfs/user/root…) ---------- */
import { parseHash, type PageId } from '../lib/route';
export { PAGES, parseHash, type PageId } from '../lib/route';
/** #hdfs/user/root → ['hdfs', 'user/root']. Lo que no es una pantalla conocida va a Inicio */
export const route = store<PageId>(parseHash(location.hash)[0]);
/** Lo que sigue a la pantalla en la ruta (carpeta de HDFS, id de trabajo, práctica…) */
export const routeArgStore = store<string>(parseHash(location.hash)[1]);
export const useRouteArg = () => routeArgStore.use();
addEventListener('hashchange', () => { const [p, a] = parseHash(location.hash); route.set(p); routeArgStore.set(a); });
export function navigate(p: PageId, arg = '') {
  const h = arg ? `${p}/${arg}` : p;
  if (decodeURIComponent(location.hash.slice(1)) !== h) location.hash = h;
  route.set(p); routeArgStore.set(arg);
}

/* ---------- Paneles ---------- */
export const consoleOpen = store(false);
export const helpOpen = store(false);
export const paletteOpen = store(false);
export const composeOpen = store(false);
/** La configuración que muestra el docker-compose.yml (el borrador de Configuración, si hay) */
export const composeDraft = store<ClusterConfig | null>(null);
export const consoleFilter = store<{ processId?: string; appId?: string } | null>(null);

/* ---------- Avisos ---------- */
export interface ToastMsg {
  id: number; title: string; description?: string; kind?: 'ok' | 'bad' | 'run' | 'info';
  /** Un botón en el aviso: "Ver en consola", "Deshacer", "Abrir" */
  action?: { label: string; run: () => void };
}
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
  /** Para lo que no se deshace: hay que escribir este texto para habilitar el botón */
  typeToConfirm?: string;
  resolve: (ok: boolean) => void;
}
export const confirmReq = store<ConfirmReq | null>(null);
export function confirm(r: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise(resolve => confirmReq.set({ ...r, resolve }));
}
