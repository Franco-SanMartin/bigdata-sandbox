"""Inscripción de las PCs del aula (RED=wireguard), en el maestro: TCP 8099.

Cada PC pasa dos veces (POST, líneas clave=valor, como la sonda):

  POST /reservar  nombre y código: le toca un número, el mismo si ya estaba
                  (nombre pcNN e IP 10.13.0.(10+NN)). Lo pide empresa-alumno.cmd
                  antes de crear el contenedor, que tiene que llamarse pcNN: Tez
                  se anuncia con el nombre de la máquina, y así se resuelve
                  en todo el cluster
  POST /unirse    lo mismo más su clave pública de WireGuard y lo que tiene (RAM,
                  cores): se la suma como peer del hub (wg0) y se le contesta con
                  la clave del hub y lo que decide el maestro para toda la clase
                  (replicación, tamaño de bloque, servicios)
  GET /ping       ok (las PCs lo piden por adentro del túnel: si contesta, anda)
  GET /pcs        las PCs inscriptas, en JSON

Cada PC queda en /hadoop/aula/pcs/<nombre> (clave=valor) y cada novedad en
/hadoop/aula/eventos.log, que muestra la vista Aula de la interfaz. Solo usa
la biblioteca estándar de Python (la imagen trabajador no trae otra cosa).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

AULA = Path(os.environ.get("AULA_DIR", "/hadoop/aula"))
PUERTO = int(os.environ.get("P_INSCRIPCION", "8099"))
RED = os.environ.get("RED_TUNEL", "10.13.0")
VERSION = os.environ.get("VERSION_AULA", "1")
MAX_PCS = 240
# Lo que decide el maestro para toda la clase (las PCs lo usan como clientes)
CLASE_VARS = {k: os.environ.get(k.upper(), "") for k in ("replication", "block_size", "servicios", "pcs_por_fila")}

_lock = threading.Lock()
_NOMBRE_RE = re.compile(r"[^A-Za-z0-9_.-]")
_CLAVE_RE = re.compile(r"^[A-Za-z0-9+/]{43}=$")


def limpiar(nombre: str) -> str:
    return _NOMBRE_RE.sub("", nombre)[:40]


def leer_kv(texto: str) -> dict[str, str]:
    d: dict[str, str] = {}
    for linea in texto.replace("\r", "").split("\n"):
        k, sep, v = linea.partition("=")
        if sep and re.fullmatch(r"[a-z_]{1,20}", k):
            d[k] = v.strip()[:200]
    return d


def escribir_kv(d: dict[str, object]) -> str:
    return "".join(f"{k}={str(v).replace(chr(10), ' ')}\n" for k, v in d.items())


def pcs() -> list[dict[str, str]]:
    out = []
    for f in sorted((AULA / "pcs").glob("*")):
        try:
            out.append(leer_kv(f.read_text()))
        except OSError:
            pass
    return sorted(out, key=lambda p: int(p.get("numero", "0") or 0))


def evento(texto: str) -> None:
    linea = f"{time.strftime('%H:%M:%S')} {texto}"
    print(linea, flush=True)
    with open(AULA / "eventos.log", "a", encoding="utf-8") as f:
        f.write(linea + "\n")


def wg(*args: str) -> None:
    subprocess.run(["wg", *args], check=True, capture_output=True, timeout=10)


def _guardar(f: Path, datos: dict[str, object]) -> None:
    tmp = f.with_suffix(".tmp")
    tmp.write_text(escribir_kv(datos))
    tmp.replace(f)


def asignar(c: dict[str, str]) -> tuple[str, dict[str, str], dict[str, object]]:
    """(nombre, lo que ya había, {numero, nodo, ip}) o ValueError con el motivo.
    El número sale del nombre de la PC: si ya se había inscripto, el mismo."""
    nombre = limpiar(c.get("nombre", ""))
    if not nombre:
        raise ValueError("falta el nombre de la PC")
    codigo = (AULA / "codigo").read_text().strip().upper()
    if c.get("codigo", "").strip().upper() != codigo:
        evento(f"{nombre}: código equivocado ({c.get('codigo', '')!r})")
        raise ValueError(f"el codigo {c.get('codigo', '')!r} no es el de esta clase: revisalo en la PC del profe")
    f = AULA / "pcs" / nombre
    viejo = leer_kv(f.read_text()) if f.exists() else {}
    if viejo:
        num = int(viejo["numero"])
    else:
        usados = [int(p.get("numero", "0") or 0) for p in pcs()]
        num = max(usados, default=0) + 1
        if num > MAX_PCS:
            raise ValueError(f"ya hay {MAX_PCS} PCs en la clase")
    return nombre, viejo, {"numero": num, "nodo": f"pc{num:02d}", "ip": f"{RED}.{10 + num}"}


def reservar(c: dict[str, str]) -> dict[str, object]:
    with _lock:
        try:
            nombre, viejo, n = asignar(c)
        except ValueError as e:
            return {"error": str(e)}
        if not viejo:
            _guardar(AULA / "pcs" / nombre, {**n, "nombre": nombre, "reservada": int(time.time())})
            evento(f"{nombre} reservó {n['nodo']} ({n['ip']})")
    return {**n, "version": VERSION}


def unirse(c: dict[str, str]) -> dict[str, object]:
    pub = c.get("pub", "")
    if not _CLAVE_RE.match(pub):
        return {"error": "clave de WireGuard invalida"}
    with _lock:
        try:
            nombre, viejo, n = asignar(c)
        except ValueError as e:
            return {"error": str(e)}
        try:
            if viejo.get("pub") and viejo["pub"] != pub:
                wg("set", "wg0", "peer", viejo["pub"], "remove")
            wg("set", "wg0", "peer", pub, "allowed-ips", f"{n['ip']}/32")
        except (subprocess.SubprocessError, OSError) as e:
            evento(f"{nombre}: no se pudo sumar al túnel ({e})")
            return {"error": "no se pudo sumar la PC al tunel del maestro"}
        _guardar(AULA / "pcs" / nombre, {
            **n, "nombre": nombre, "pub": pub,
            "ram_mb": c.get("ram_mb", ""), "cores": c.get("cores", ""), "yarn_mb": c.get("yarn_mb", ""),
            "vcores": c.get("vcores", ""), "cpu": c.get("cpu", ""), "ram_pc_gb": c.get("ram_pc_gb", ""),
            "version": c.get("version", ""),
            "inscripta": viejo.get("inscripta") or int(time.time()), "ultima": int(time.time())})
    aviso = "" if c.get("version") == VERSION else f" (OJO: versión {c.get('version')!r}, la del maestro es {VERSION})"
    otra_vez = " otra vez" if viejo.get("pub") else ""
    evento(f"{nombre} se sumó{otra_vez} como {n['nodo']} ({n['ip']}): Docker con {c.get('ram_mb', '?')} MB y "
           f"{c.get('cores', '?')} cores, presta {c.get('yarn_mb', '?')} MB{aviso}")
    return {"nodo": n["nodo"], "ip": n["ip"], "hub_pub": (AULA / "pub").read_text().strip(),
            "clase": (AULA / "clase").read_text().strip(), "version": VERSION, **CLASE_VARS}


class Pedido(BaseHTTPRequestHandler):
    server_version = "aula/" + VERSION

    def responder(self, cuerpo: str, tipo: str = "text/plain; charset=utf-8", codigo: int = 200) -> None:
        b = cuerpo.encode()
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self) -> None:  # noqa: N802 (nombre de http.server)
        if self.path == "/ping":
            self.responder("ok\n")
        elif self.path == "/pcs":
            self.responder(json.dumps(pcs(), ensure_ascii=False), "application/json")
        elif self.path == "/":
            self.responder(f"Inscripcion del aula (BigData Sandbox): {len(pcs())} PCs\n")
        else:
            self.responder("no existe\n", codigo=404)

    def do_POST(self) -> None:  # noqa: N802
        hacer = {"/unirse": unirse, "/reservar": reservar}.get(self.path)
        if hacer is None:
            self.responder("no existe\n", codigo=404)
            return
        try:
            largo = min(int(self.headers.get("Content-Length", "0")), 4096)
        except ValueError:
            largo = 0
        c = leer_kv(self.rfile.read(largo).decode("utf-8", "replace"))
        try:
            r = hacer(c)
        except Exception as e:  # noqa: BLE001 (una PC rara no puede tirar la inscripción)
            evento(f"error inscribiendo a {c.get('nombre', '?')}: {e}")
            r = {"error": "error en el maestro"}
        self.responder(escribir_kv(r))

    def log_message(self, *_: object) -> None:
        pass   # lo que importa ya sale en eventos.log


def main() -> None:
    (AULA / "pcs").mkdir(parents=True, exist_ok=True)
    srv = ThreadingHTTPServer(("0.0.0.0", PUERTO), Pedido)
    srv.daemon_threads = True
    evento(f"inscripción abierta en TCP {PUERTO}, código {(AULA / 'codigo').read_text().strip()}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
