"""Errores de la API con el mismo cuerpo que espera la interfaz:

    { "error": "mensaje para mostrar", "code": "cluster_stopped" }

Los códigos y sus status son los de ui/src/api/errors.ts (ApiErrorCode).
"""
from __future__ import annotations

STATUS = {
    "cluster_stopped": 409,  # el cluster no está en marcha
    "service_down": 503,     # el servicio que hace falta está apagado
    "not_found": 404,
    "invalid": 400,          # parámetros inválidos
    "busy": 409,             # ya hay algo corriendo que lo impide
    "unsupported": 501,      # no está en esta versión o en esta configuración
    "failed": 500,           # el comando falló: el mensaje trae la última línea de su salida
}


class ApiError(Exception):
    code = "failed"

    def __init__(self, message: str, code: str | None = None, **extra: object):
        super().__init__(message)
        if code is not None:
            self.code = code
        if self.code not in STATUS:
            raise ValueError(f"código de error desconocido: {self.code}")
        self.extra = {k: v for k, v in extra.items() if v is not None}

    @property
    def status(self) -> int:
        return STATUS[self.code]

    def body(self) -> dict:
        return {"error": str(self), "code": self.code, **self.extra}


def stopped() -> ApiError:
    return ApiError("El cluster está apagado: arrancalo desde Cluster", "cluster_stopped")


def code_for_status(status: int) -> str:
    """Para los errores que arma Starlette (404 de ruta, 405 de método...)."""
    if status == 404:
        return "not_found"
    if status in (400, 405, 413, 415, 422):
        return "invalid"
    if status == 409:
        return "busy"
    if status == 501:
        return "unsupported"
    if status == 503:
        return "service_down"
    return "failed"
