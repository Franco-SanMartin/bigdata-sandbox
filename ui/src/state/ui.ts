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
import { parseHash, routeHash, routeParts, type PageId } from '../lib/route';
export { PAGES, parseHash, routeHash, routeParts, type PageId } from '../lib/route';
/** #hdfs/user/root → ['hdfs', 'user/root']. Lo que no es una pantalla conocida va a Inicio */
export const route = store<PageId>(parseHash(location.hash)[0]);
/** Lo que sigue a la pantalla en la ruta (carpeta de HDFS, id de trabajo, práctica…) */
export const routeArgStore = store<string>(parseHash(location.hash)[1]);
export const useRouteArg = () => routeArgStore.use();
/** El sufijo partido en tramos: #hdfs/user/root → ['user', 'root'] */
export const useRouteParts = () => routeParts(routeArgStore.use());
/** Ruta actual: la pantalla y su sufijo, para leer fuera de React */
export const currentRoute = (): [PageId, string] => [route.get(), routeArgStore.get()];
addEventListener('hashchange', () => {
  const [p, a] = parseHash(location.hash);
  if (p !== route.get()) route.set(p);
  if (a !== routeArgStore.get()) routeArgStore.set(a);
});
/** Va a una pantalla (y a lo que sigue: carpeta, proceso, evento…). Con replace no suma un paso al
    historial: sirve para elegir una fila sin que "atrás" tenga que recorrer cada clic */
export function navigate(p: PageId, arg = '', opts: { replace?: boolean } = {}) {
  const h = routeHash(p, arg);
  const [cp, ca] = parseHash(location.hash);
  if (cp !== p || ca !== arg.replace(/^\/+|\/+$/g, '')) {
    if (opts.replace) history.replaceState(history.state, '', h);
    else location.hash = h;
  }
  if (p !== route.get()) route.set(p);
  routeArgStore.set(arg.replace(/^\/+|\/+$/g, ''));
}
/** Cambia solo el sufijo de la pantalla actual */
export const setRouteArg = (arg: string, opts: { replace?: boolean } = { replace: true }) => navigate(route.get(), arg, opts);

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
/** Lo que está pasando y lo que falló deja rastro en la consola: esos avisos traen "Ver en consola"
    salvo que traigan su propia acción o pidan no tenerla (console: false) */
export function toast(t: Omit<ToastMsg, 'id'> & { console?: boolean }) {
  const { console: withConsole = t.kind === 'bad' || t.kind === 'run', ...rest } = t;
  const action = rest.action ?? (withConsole ? { label: 'Ver en consola', run: openConsole } : undefined);
  toasts.set(l => [...l.slice(-3), { ...rest, action, id: ++tid }]);
}
/** Abre el cajón de la consola sin filtro, con lo último arriba */
export function openConsole() { consoleFilter.set(null); consoleOpen.set(true); }
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
