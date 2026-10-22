/* Elige la implementación: el backend real si responde, si no el modo demo.
   ?demo en la URL fuerza el modo demo aunque haya backend. */
import type { SandboxApi } from './types';
import { backendAvailable, createHttpApi } from './http';
import { createDemoApi } from './demo';

let current: SandboxApi | null = null;

export async function connect(): Promise<SandboxApi> {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  current = !forceDemo && (await backendAvailable()) ? createHttpApi() : createDemoApi();
  return current;
}

export function api(): SandboxApi {
  if (!current) throw new Error('api() antes de connect()');
  return current;
}
