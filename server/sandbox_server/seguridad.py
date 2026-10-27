"""La API de :full solo atiende a la propia interfaz.

Desde que la pantalla de ML deja editar y correr código, la API es, en los
hechos, una consola del contenedor. Un navegador abierto en cualquier otra
página no tiene que poder usarla. Tres barreras, todas en este archivo:

1. Host confiable (TrustedHostMiddleware de Starlette): solo localhost,
   127.0.0.1 y [::1] (más los de SANDBOX_HOSTS, separados por coma). Corta el
   "DNS rebinding": una página de internet que hace que su dominio apunte a
   127.0.0.1 para hablarle al contenedor como si fuera ella misma.
2. Origen: un POST, PUT, PATCH o DELETE que trae Origin (o, si no, Referer)
   tiene que venir de la misma interfaz (mismo esquema, host y puerto que el
   Host del pedido). Los navegadores siempre mandan Origin en un pedido que
   cambia algo; curl, los scripts y el humo no mandan ninguno de los dos y
   pasan (no son un navegador engañado: ya tienen el puerto en la mano).
3. Cuerpos JSON con Content-Type: application/json. Un formulario de otra
   página solo puede mandar text/plain, urlencoded o multipart sin pedir
   permiso (CORS); application/json obliga al navegador a preguntar antes, y
   este servidor no contesta que sí a nadie. La única excepción es la subida de
   archivos a HDFS (multipart), que igual tiene que pasar la barrera 2.
"""
from __future__ import annotations

import json
import os
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

HOSTS = ["localhost", "127.0.0.1", "[::1]"]
CAMBIAN = {"POST", "PUT", "PATCH", "DELETE"}
CON_CUERPO = {"POST", "PUT", "PATCH"}
# Rutas que reciben multipart/form-data (un archivo de la compu)
MULTIPART = {"/api/hdfs/upload"}


def hosts_permitidos(extra: str | None = None) -> list[str]:
    """localhost, 127.0.0.1 y [::1], más los de SANDBOX_HOSTS (p. ej. el nombre de la PC del profe)."""
    if extra is None:
        extra = os.environ.get("SANDBOX_HOSTS", "")
    out = list(HOSTS)
    for h in extra.split(","):
        h = h.strip().lower()
        if h and h not in out and "*" not in h:
            out.append(h)
    return out


def _rechazo(status: int, mensaje: str, code: str) -> tuple[int, bytes]:
    return status, json.dumps({"error": mensaje, "code": code}, ensure_ascii=False).encode()


def _origen(url: str) -> str | None:
    """'http://localhost:8080/algo' → 'http://localhost:8080' (None si no es una URL http)."""
    try:
        u = urlsplit(url)
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not u.netloc:
        return None
    return f"{u.scheme}://{u.netloc}".lower()


def revisar(scope: Scope) -> tuple[int, bytes] | None:
    """None si el pedido pasa; si no, (status, cuerpo JSON) del rechazo."""
    method = scope.get("method", "GET")
    if method not in CAMBIAN:
        return None
    h = Headers(scope=scope)
    propio = f"{scope.get('scheme', 'http')}://{h.get('host', '')}".lower()
    origin = h.get("origin")
    referer = h.get("referer")
    if origin is not None:
        # "null": un iframe con sandbox, un archivo abierto del disco... nunca es la interfaz
        if _origen(origin) != propio:
            return _rechazo(403, f"La API solo acepta pedidos de la propia interfaz ({propio}), no de {origin}",
                            "forbidden")
    elif referer is not None:
        if _origen(referer) != propio:
            return _rechazo(403, f"La API solo acepta pedidos de la propia interfaz ({propio})", "forbidden")
    path = scope.get("path", "")
    if method in CON_CUERPO and path.startswith("/api/") and _tiene_cuerpo(h):
        tipo = (h.get("content-type") or "").split(";")[0].strip().lower()
        if tipo == "application/json" or (tipo == "multipart/form-data" and path in MULTIPART):
            return None
        return _rechazo(415, "El cuerpo tiene que ir como JSON (Content-Type: application/json)", "invalid")
    return None


def _tiene_cuerpo(h: Headers) -> bool:
    if "transfer-encoding" in h:
        return True
    try:
        return int(h.get("content-length") or "0") > 0
    except ValueError:
        return True


class SoloLaInterfaz:
    """Barreras 2 y 3 (la 1 es TrustedHostMiddleware, que va por fuera de esta)."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            mal = revisar(scope)
            if mal is not None:
                status, body = mal
                await send({"type": "http.response.start", "status": status,
                            "headers": [(b"content-type", b"application/json"),
                                        (b"content-length", str(len(body)).encode())]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)

