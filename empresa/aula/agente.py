"""Agente de apagado de una PC del aula (ROL=trabajador): TCP 8098.

Para la clase de «qué pasa si se apaga una PC» sin ir hasta la PC: el profe toca «apagar» en la vista Aula y el
maestro le pide a este agente que pare el DataNode y el NodeManager de la PC. El contenedor y el túnel siguen
andando, así que «prender» la vuelve a sumar sin tocar la PC.

  POST /apagar   codigo=<de la clase>, modo=golpe|ordenado
                 golpe: mata de un saque todo Java (DataNode, NodeManager y los contenedores de trabajos), como
                        si se cortara la luz: HDFS la da por muerta a los 40 s y YARN la pierde (LOST) al minuto
                 ordenado: para el NodeManager y el DataNode con sus comandos: YARN la ve SHUTDOWN enseguida y
                        HDFS igual espera los 40 s (un DataNode no avisa que se va)
  POST /prender  codigo=<de la clase>: vuelve a arrancar el DataNode y el NodeManager
  GET  /estado   nodo=, datanode=si|no, nodemanager=si|no

Solo atiende al maestro: con RED=wireguard escucha solo en la IP del túnel (10.13.0.x) y acepta pedidos de
10.13.0.1 (WireGuard no deja que otra PC se haga pasar por esa IP: cada peer tiene sus IPs); en el aula
simulada (RED=docker), de la IP que resuelve MAESTRO. Y pide el código de la clase. Con AGENTE=no no arranca.
Solo usa la biblioteca estándar de Python (la imagen trabajador no trae otra cosa).
"""
from __future__ import annotations

import hmac
import os
import re
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PUERTO = int(os.environ.get("P_AGENTE", "8098"))
LIB = "/opt/sandbox/lib.sh"
ACCIONES = {
    # -9 a todo Java: en la PC solo corren el DataNode, el NodeManager y los contenedores de los trabajos.
    # Primero por el nombre del servicio (-Dproc_..., lo mismo que mira estado()): en el CI el DataNode
    # sobrevivió a un pkill solo por nombre de proceso. El [-] evita que el patrón se encuentre a sí mismo
    "golpe": "pkill -9 -f '[-]Dproc_(datanode|nodemanager)'; pkill -9 -x java; sleep 1; ! pgrep -x java > /dev/null",
    "ordenado": f". {LIB}; if con_yarn; then yarn --daemon stop nodemanager; fi; datanode_stop 1",
    "prender": f". {LIB}; datanode_start 1; if con_yarn; then yarn --daemon start nodemanager; fi",
}
_lock = threading.Lock()


def leer_kv(texto: str) -> dict[str, str]:
    d: dict[str, str] = {}
    for linea in texto.replace("\r", "").split("\n"):
        k, sep, v = linea.partition("=")
        if sep and re.fullmatch(r"[a-z_]{1,20}", k):
            d[k] = v.strip()[:200]
    return d


def escribir_kv(d: dict[str, object]) -> str:
    return "".join(f"{k}={str(v).replace(chr(10), ' ')}\n" for k, v in d.items())


def limpiar_codigo(c: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "", c or "")[:40].upper()


def leer_env(archivo: Path) -> dict[str, str]:
    try:
        return {k: v for k, v in (l.split("=", 1) for l in archivo.read_text().splitlines() if "=" in l)}
    except OSError:
        return {}


class Agente:
    def __init__(self, env: dict[str, str] | None = None, ejecutar=None) -> None:
        env = dict(os.environ if env is None else env)
        self.red = (env.get("RED") or "docker").strip().lower()
        nodo_env = leer_env(Path(env.get("AULA_DIR", "/hadoop/aula")) / "nodo.env")
        self.nodo = nodo_env.get("NODO") or env.get("NODO") or socket.gethostname()
        self.codigo = limpiar_codigo(env.get("CODIGO", ""))
        tunel = env.get("RED_TUNEL", "10.13.0")
        if self.red == "wireguard":
            self.escucha = nodo_env.get("IP_TUNEL") or env.get("IP_TUNEL") or ""
            self.maestro = f"{tunel}.1"
        else:
            self.escucha = env.get("ESCUCHA_AGENTE", "0.0.0.0")
            self.maestro = env.get("MAESTRO") or "maestro"
        self.ejecutar = ejecutar or self._bash

    @staticmethod
    def _bash(script: str) -> tuple[int, str]:
        try:
            r = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.SubprocessError) as e:
            return 127, str(e)
        return r.returncode, (r.stdout + r.stderr).strip()

    def ip_maestro(self) -> str | None:
        try:
            return socket.gethostbyname(self.maestro)
        except OSError:
            return None

    def permitido(self, origen: str) -> bool:
        return origen == self.ip_maestro()

    def corre(self, que: str) -> bool:
        return self.ejecutar(f"pgrep -f 'proc_{que}' > /dev/null")[0] == 0

    def estado(self) -> dict[str, object]:
        return {"nodo": self.nodo, "datanode": "si" if self.corre("datanode") else "no",
                "nodemanager": "si" if self.corre("nodemanager") else "no"}

    def atender(self, metodo: str, ruta: str, origen: str, cuerpo: str = "") -> tuple[int, dict[str, object]]:
        """(código HTTP, respuesta) de un pedido. Sin red ni hilos: lo prueban los tests."""
        if not self.permitido(origen):
            return 403, {"error": "solo atiendo al maestro del aula"}
        if metodo == "GET" and ruta == "/estado":
            return 200, self.estado()
        if metodo != "POST" or ruta not in ("/apagar", "/prender"):
            return 404, {"error": "no existe"}
        c = leer_kv(cuerpo)
        dado = limpiar_codigo(c.get("codigo", ""))
        if not self.codigo or not hmac.compare_digest(dado.encode(), self.codigo.encode()):
            return 403, {"error": "el código de la clase no coincide"}
        accion = "prender" if ruta == "/prender" else (c.get("modo") or "golpe")
        if accion not in ACCIONES:
            return 400, {"error": "modo es golpe u ordenado"}
        if not _lock.acquire(blocking=False):
            return 409, {"error": "ya estoy apagando o prendiendo"}
        try:
            t0 = time.monotonic()
            rc, salida = self.ejecutar(ACCIONES[accion])
        finally:
            _lock.release()
        r: dict[str, object] = {"nodo": self.nodo, "accion": accion, "ms": int((time.monotonic() - t0) * 1000),
                                **self.estado()}
        if rc != 0:
            r["error"] = next((l for l in reversed(salida.splitlines()) if l.strip()), f"salió con {rc}")
            return 500, r
        siguen = [s for s in ("datanode", "nodemanager") if r[s] == "si"] if accion != "prender" else []
        if siguen:  # el maestro no la marca apagada si algo quedó vivo
            r["error"] = "siguen corriendo: " + ", ".join(siguen)
            return 500, r
        print(f"[agente] {accion} pedido por el maestro", flush=True)
        return 200, r


def servidor(agente: Agente, puerto: int = PUERTO) -> ThreadingHTTPServer:
    class Pedido(BaseHTTPRequestHandler):
        server_version = "agente-aula/1"

        def _responder(self, metodo: str) -> None:
            cuerpo = ""
            if metodo == "POST":
                try:
                    largo = min(int(self.headers.get("Content-Length", "0")), 4096)
                except ValueError:
                    largo = 0
                cuerpo = self.rfile.read(largo).decode("utf-8", "replace")
            codigo, r = agente.atender(metodo, self.path, self.client_address[0], cuerpo)
            b = escribir_kv(r).encode()
            self.send_response(codigo)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self) -> None:  # noqa: N802 (nombre de http.server)
            self._responder("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._responder("POST")

        def log_message(self, *_: object) -> None:
            pass

    srv = ThreadingHTTPServer((agente.escucha, puerto), Pedido)
    srv.daemon_threads = True
    return srv


def main() -> None:
    if (os.environ.get("AGENTE") or "si").strip().lower() == "no":
        return
    a = Agente()
    if not a.codigo:
        print("[agente] sin CODIGO de la clase: el agente de apagado no arranca", flush=True)
        return
    if not a.escucha:
        print("[agente] sin IP del túnel: el agente de apagado no arranca", flush=True)
        return
    try:
        srv = servidor(a)
    except OSError as e:
        print(f"[agente] no pude escuchar en {a.escucha}:{PUERTO}: {e}", flush=True)
        return
    print(f"[agente] {a.nodo}: atiendo al maestro ({a.maestro}) en {a.escucha}:{PUERTO}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
