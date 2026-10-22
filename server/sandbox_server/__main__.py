"""python3 -m sandbox_server: el proceso principal de la versión full.

Corre debajo de tini (PID 1), que le pasa el SIGTERM de 'docker stop'. Al
recibirlo corta las conexiones SSE (si no, uvicorn esperaría a que el
navegador cierre) y apaga el cluster en orden antes de salir.
"""
from __future__ import annotations

import os

import uvicorn

from .app import build_app


class Server(uvicorn.Server):
    def handle_exit(self, sig, frame) -> None:  # type: ignore[override]
        bus = getattr(self.config.app, "state", None)
        if bus is not None and getattr(bus, "bus", None) is not None:
            bus.bus.close()
        super().handle_exit(sig, frame)


def main() -> None:
    app = build_app()
    config = uvicorn.Config(
        app,
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8080")),
        log_level=os.environ.get("LOG_LEVEL", "warning"),
        access_log=False,
        # Las conexiones abiertas tienen 3 s para cerrar; después se apaga el cluster
        timeout_graceful_shutdown=3,
        proxy_headers=False,
    )
    Server(config).run()


if __name__ == "__main__":
    main()
