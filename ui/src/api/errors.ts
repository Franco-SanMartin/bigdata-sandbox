/* Error de la API: lo tiran igual el backend real (http.ts) y el modo demo. */
import type { ApiErrorCode } from './types';

const STATUS: Record<ApiErrorCode, number> = {
  cluster_stopped: 409, service_down: 503, not_found: 404, forbidden: 403, invalid: 400, busy: 409, unsupported: 501, failed: 500,
};

export class ApiFailure extends Error {
  /** extra: el resto del cuerpo del error (p. ej. detalle, la línea original de Spark, y errors) */
  constructor(message: string, public code?: ApiErrorCode, public status = code ? STATUS[code] : 500, public extra?: Record<string, unknown>) { super(message); }
}

/** La línea original de Spark o de Java que vino con el error (para mostrarla abajo del mensaje) */
export const detalleDe = (e: unknown): string | null => (e instanceof ApiFailure && typeof e.extra?.detalle === 'string' ? e.extra.detalle : null);

export function fail(code: ApiErrorCode, message: string): never { throw new ApiFailure(message, code); }

/** Código del error, si vino de la API */
export const errorCode = (e: unknown): ApiErrorCode | undefined => (e instanceof ApiFailure ? e.code : undefined);
