/* Elige la implementación: el backend real si responde, si no el modo demo.
   ?demo en la URL fuerza el modo demo aunque haya backend. El demo se carga aparte, solo si hace falta. */
import type { SandboxApi } from './types';
import { backendAvailable, createHttpApi } from './http';

let current: SandboxApi | null = null;

export async function connect(): Promise<SandboxApi> {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  current = !forceDemo && (await backendAvailable())
    ? createHttpApi()
    : (await import('./demo')).createDemoApi();
  return current;
}

export function api(): SandboxApi {
  if (!current) throw new Error('api() antes de connect()');
  return current;
}
