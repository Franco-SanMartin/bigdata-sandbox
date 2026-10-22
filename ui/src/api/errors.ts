/* Error de la API: lo tiran igual el backend real (http.ts) y el modo demo. */
import type { ApiErrorCode } from './types';

const STATUS: Record<ApiErrorCode, number> = {
  cluster_stopped: 409, service_down: 503, not_found: 404, invalid: 400, busy: 409, unsupported: 501, failed: 500,
};

export class ApiFailure extends Error {
  constructor(message: string, public code?: ApiErrorCode, public status = code ? STATUS[code] : 500) { super(message); }
}

export function fail(code: ApiErrorCode, message: string): never { throw new ApiFailure(message, code); }

/** Código del error, si vino de la API */
export const errorCode = (e: unknown): ApiErrorCode | undefined => (e instanceof ApiFailure ? e.code : undefined);
