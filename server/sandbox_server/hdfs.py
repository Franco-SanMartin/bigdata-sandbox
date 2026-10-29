"""HDFS: el árbol de carpetas, el detalle de cada archivo, subir, borrar,
fsck y la re-replicación (rutas /api/hdfs/... de ui/API.md).

De dónde sale cada cosa:

- Listados y metadatos: WebHDFS del NameNode activo
  (http://localhost:<web>/webhdfs/v1<ruta>?op=LISTSTATUS|GETFILESTATUS|CONTENT_SUMMARY),
  sin levantar una JVM por pedido.
- Vista previa: WebHDFS ?op=OPEN&length=... (lo mismo que hdfs dfs -cat | head).
- Bloques y réplicas: hdfs fsck <ruta> -files -blocks -locations (no hay REST
  que diga en qué DataNode está cada bloque).
- Contadores de re-replicación: JMX del NameNode (FSNamesystem).
- Lo que hace el usuario (subir, borrar, carpeta, replicación, fsck): el
  comando real por ActionRunner, con su rastro (comando, qué entra, qué hace,
  cómo quedan los datos).

Las copias de bloques (evento SSE 'transfer') se deducen comparando las
ubicaciones de cada bloque entre dos fsck: un bloque nuevo es una escritura
(cliente -> DataNode -> DataNode, la tubería de HDFS) y una ubicación nueva de
un bloque que ya estaba es una re-replicación. El fsck se corre solo mientras
hay algo que mirar (una subida en curso, bloques sub-replicados o un cambio en
la cantidad de bloques).
"""
from __future__ import annotations

import asyncio
import itertools
import json
import math
import os
import posixpath
import re
import shlex
import shutil
import signal
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from . import config as cfg
from . import probes
from .actions import Action, ActionRunner, Run
from .boot import now_ms
from .errors import ApiError
from .events import EventBus
from .specs import dn_http

MB = 1024 * 1024
PREVIEW_BYTES = 64 * 1024
PREVIEW_ROWS = 10
MAX_UPLOAD_MB = int(os.environ.get("SANDBOX_MAX_UPLOAD_MB", "2048"))
COPYING = "._COPYING_"   # lo que agrega hdfs dfs -put mientras escribe
# Con HDFS quieto (sub-replicados sin adónde copiarse y nada más moviéndose), un fsck de fondo cada tanto
QUIET_FSCK = 30.0
CAT_DEFAULT = 64 * 1024
CAT_MAX = 1024 * 1024       # tope de un tramo de /api/hdfs/cat
# Carpetas que arma el arranque y usan los servicios: no se mueven
NO_MOVE = {"/", "/tmp", "/user", "/user/root", "/user/hive", "/user/hive/warehouse", "/apps", "/apps/tez",
           "/apps/spark", "/spark-logs"}

# Ejemplos de la imagen: archivo en /datos, cómo se genera si no está, filas y
# dónde lo deja putExample. Los generadores son los de datos/ejemplos.
EXAMPLES: dict[str, dict] = {
    "ventas": {"local": "ventas_grandes.csv", "gen": "python3 ejemplos/generar_ventas.py",
               "script": "ejemplos/generar_ventas.py", "rows": "200.000 filas", "put": "/user/root/ventas"},
    "sucias": {"local": "ventas_sucias.csv", "gen": "python3 ejemplos/ml/generar_sucios.py",
               "script": "ejemplos/ml/generar_sucios.py", "rows": "103.000 filas", "put": "/user/root/ml"},
    "numeros": {"local": "numeros.txt", "gen": "seq 1 1000000 > numeros.txt", "script": None,
                "rows": "1.000.000 líneas", "put": "/user/root"},
    "senal": {"local": "clientes_senal.csv", "gen": "python3 ejemplos/ml/generar_senal.py",
              "script": "ejemplos/ml/generar_senal.py", "rows": "20.000 filas", "put": None},
    "texto": {"local": "ejemplos/texto.txt", "gen": None, "script": "ejemplos/texto.txt",
              "rows": "4 líneas", "put": None},
}


# ---------------------------------------------------------------------------
# Rutas y formatos
# ---------------------------------------------------------------------------


def clean(raw: object) -> str:
    """Ruta absoluta de HDFS normalizada (/user/root/x). Acepta hdfs://host/..."""
    if not isinstance(raw, str) or not raw.strip():
        raise ApiError("Falta la ruta de HDFS (por ejemplo /user/root)", "invalid")
    p = raw.strip()
    m = re.match(r"^hdfs://[^/]*(/.*)?$", p)
    if m:
        p = m.group(1) or "/"
    if any(c in p for c in "\0\n\r") or ":" in p:
        raise ApiError(f"Ruta de HDFS inválida: {raw}", "invalid")
    p = posixpath.normpath("/" + p)
    return "/" + p.lstrip("/") if p != "/" else "/"


def parent_of(p: str) -> str | None:
    return None if p == "/" else (posixpath.dirname(p) or "/")


def name_of(p: str) -> str:
    return posixpath.basename(p) or "/"


def inside(path: str, d: str) -> bool:
    return d == "/" or path == d or path.startswith(d + "/")


def perm_str(octal: str | int | None, is_dir: bool) -> str:
    """'755' -> rwxr-xr-x; '1777' -> rwxrwxrwt (el sticky bit de /tmp)."""
    try:
        v = int(str(octal), 8)
    except (TypeError, ValueError):
        return "rwxr-xr-x" if is_dir else "rw-r--r--"
    out = ""
    for shift in (6, 3, 0):
        b = (v >> shift) & 7
        out += ("r" if b & 4 else "-") + ("w" if b & 2 else "-") + ("x" if b & 1 else "-")
    if v & 0o1000:
        out = out[:8] + ("t" if out[8] == "x" else "T")
    return out


def mb(n: float) -> float:
    return round(n / MB, 6)


def fmt_mb(x: float) -> str:
    if 0 < x < 0.01:
        return f"{round(x * MB):,} bytes".replace(",", ".")
    return f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".").rstrip("0").rstrip(",") + " MB"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def written_by(path: str) -> str:
    """Qué lo escribió, por dónde está (HDFS no lo guarda)."""
    if path.startswith("/user/hive/warehouse/"):
        return "Hive"
    if path.startswith(("/apps/", "/spark-logs")):
        return "arranque" if path.startswith("/apps/") else "Spark"
    m = re.search(r"/resultados/(hive|mr|spark|pig|pandas)_", path)
    if m:
        return {"hive": "Hive", "mr": "MapReduce", "spark": "Spark", "pig": "Pig", "pandas": "pandas"}[m.group(1)]
    if re.search(r"/part-[rm]-\d+", path):
        return "MapReduce"
    if re.search(r"/part-\d+-[0-9a-f-]+", path):
        return "Spark"
    return "cliente HDFS"


def entry_from_status(st: dict, base: str, block_size_default: float | None) -> dict:
    """HdfsEntry a partir de un FileStatus de WebHDFS (LISTSTATUS)."""
    name = st.get("pathSuffix") or name_of(base)
    path = base if not st.get("pathSuffix") else (base.rstrip("/") + "/" + name)
    is_dir = st.get("type") == "DIRECTORY"
    e = {"path": path, "name": name, "type": "dir" if is_dir else "file", "owner": st.get("owner", ""),
         "group": st.get("group", ""), "permission": perm_str(st.get("permission"), is_dir),
         "modifiedAt": int(st.get("modificationTime", 0))}
    if is_dir:
        e["children"] = int(st.get("childrenNum", 0))
    else:
        size = int(st.get("length", 0))
        bs = int(st.get("blockSize", 0)) or int((block_size_default or 128) * MB)
        e.update({"sizeMb": mb(size), "replication": int(st.get("replication", 0)), "blockSizeMb": mb(bs),
                  "blocks": math.ceil(size / bs) if size else 0,
                  "state": "writing" if name.endswith(COPYING) else "ok"})
    return e


# ------------------------------------------------------------------ fsck


_SUMMARY = {
    "Total size": "totalSize", "Total files": "files", "Total blocks (validated)": "blocks",
    "Minimally replicated blocks": "minimallyReplicated", "Over-replicated blocks": "overReplicated",
    "Under-replicated blocks": "underReplicated", "Default replication factor": "defaultReplication",
    "Average block replication": "avgReplication", "Missing blocks": "missing", "Corrupt blocks": "corrupt",
}
_UNDER = re.compile(r"Under replicated (?:BP-[^:]+:)?(blk_\d+_\d+)\. Target Replicas is (\d+) but found (\d+) live")


def parse_fsck_report(text: str, path: str) -> dict:
    """Los números del resumen de hdfs fsck (sección 'Replicated Blocks') y los
    bloques con problemas, como los marca fsck."""
    r = {"path": path, "healthy": False, "totalSizeMb": 0.0, "dirs": 0, "files": 0, "blocks": 0,
         "minimallyReplicated": 0, "underReplicated": 0, "overReplicated": 0, "missing": 0, "corrupt": 0,
         "defaultReplication": 0, "avgReplication": 0.0, "liveDataNodes": 0, "problems": []}
    section = "top"
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("Replicated Blocks:"):
            section = "rep"
            continue
        if s.startswith("Erasure Coded Block Groups:"):
            section = "ec"
            continue
        if ":" not in s or section == "ec":
            continue
        k, _, v = s.partition(":")
        k, v = k.strip(), v.strip()
        num = re.match(r"^([\d.]+)", v)
        if k == "Number of data-nodes" and num:
            r["liveDataNodes"] = int(float(num.group(1)))
        elif k == "Total dirs" and num:
            r["dirs"] = int(num.group(1))
        elif section in ("rep", "top") and k in _SUMMARY and num:
            key = _SUMMARY[k]
            if key == "totalSize":
                r["totalSizeMb"] = mb(int(num.group(1)))
            elif key == "avgReplication":
                r[key] = float(num.group(1))
            else:
                r[key] = int(float(num.group(1)))
    last = next((l for l in reversed(text.splitlines()) if "is HEALTHY" in l or "is CORRUPT" in l), "")
    r["healthy"] = "is HEALTHY" in last
    # Problemas por bloque, a partir del detalle (-files -blocks)
    files = probes.parse_fsck(text)
    for f in files:
        if f["state"] == "writing":
            continue  # el pipeline sigue abierto: le faltan copias porque se está escribiendo
        for b in f["blocks"]:
            k = len(b["locations"])
            if k == 0:
                r["problems"].append({"file": f["path"], "block": b["name"], "issue": "missing", "replicas": 0,
                                      "expected": f["replication"]})
            elif 0 < k < f["replication"]:
                r["problems"].append({"file": f["path"], "block": b["name"], "issue": "under", "replicas": k,
                                      "expected": f["replication"]})
            elif k > f["replication"]:
                r["problems"].append({"file": f["path"], "block": b["name"], "issue": "over", "replicas": k,
                                      "expected": f["replication"]})
    seen = {(p["file"], p["block"]) for p in r["problems"]}
    cur = None
    for line in text.splitlines():
        m = probes._FSCK_FILE.match(line)
        if m:
            cur = m.group("path")
        u = _UNDER.search(line)
        if u and cur and (cur, u.group(1)) not in seen:
            r["problems"].append({"file": cur, "block": u.group(1), "issue": "under", "replicas": int(u.group(3)),
                                  "expected": int(u.group(2))})
            seen.add((cur, u.group(1)))
        if cur and line.startswith(cur + ":") and "CORRUPT" in line:
            for p in r["problems"]:
                if p["file"] == cur and p["issue"] == "missing" and r["corrupt"]:
                    p["issue"] = "corrupt"
    return r


# ------------------------------------------------------------- vista previa


def _cell(v: str) -> object:
    v = v.strip()
    if re.fullmatch(r"-?\d{1,15}", v):
        return int(v)
    if re.fullmatch(r"-?\d+\.\d+", v):
        try:
            return float(v)
        except ValueError:
            pass
    return v


def preview_from(path: str, data: bytes, size: int) -> dict:
    """DataSample con las primeras filas de un archivo (como hdfs dfs -cat | head)."""
    truncated = len(data) < size
    low = path.lower()
    if low.endswith(".parquet") or data[:4] == b"PAR1":
        return {"columns": [], "rows": [], "format": "parquet",
                "note": "Parquet es binario y columnar: se lee con pyarrow, Spark o Hive (no con cat)"}
    if b"\0" in data[:4096] or low.endswith((".jar", ".gz", ".tar", ".zip", ".snappy", ".orc", ".avro")):
        note = ("Archivo binario: librerías que YARN reparte a cada contenedor" if path.startswith("/apps/")
                else "Archivo binario: no tiene líneas para mostrar")
        return {"columns": [], "rows": [], "format": "binario", "note": note}
    text = data.decode("utf-8", "replace")
    lines = text.split("\n")
    if truncated and len(lines) > 1:
        lines = lines[:-1]          # la última quedó cortada
    if lines and lines[-1] == "":
        lines = lines[:-1]
    head = [l.rstrip("\r") for l in lines[: PREVIEW_ROWS + 1]]
    sep = next((s for s in (",", "\t", ";", "\x01") if head and head[0].count(s) >= 1
                and all(l.count(s) == head[0].count(s) for l in head[1:] if l)), None)
    note = "Primeras líneas (hdfs dfs -cat | head)" if truncated else None
    if sep and len(head) > 1:
        first = head[0].split(sep)
        has_header = any(re.search(r"[A-Za-z_]", c) for c in first) and not any(
            isinstance(_cell(c), (int, float)) for c in first)
        if has_header:
            cols, body = [c.strip() for c in first], head[1: PREVIEW_ROWS + 1]
        else:
            cols, body = [f"c{i + 1}" for i in range(len(first))], head[:PREVIEW_ROWS]
        s = {"columns": cols, "rows": [[_cell(c) for c in l.split(sep)] for l in body if l],
             "format": "csv" if sep in (",", ";") else "texto con separador"}
        if not truncated:
            s["total"] = len(lines) - (1 if has_header else 0)
    else:
        s = {"columns": ["línea"], "rows": [[_cell(l)] for l in head[:PREVIEW_ROWS]], "format": "texto"}
        if not truncated:
            s["total"] = len(lines)
    if note:
        s["note"] = note
    return s


def local_preview(p: Path) -> dict | None:
    try:
        with p.open("rb") as fh:
            data = fh.read(PREVIEW_BYTES)
        return preview_from(str(p), data, p.stat().st_size)
    except OSError:
        return None


def bounded_int(raw: object, name: str, lo: int, hi: int, default: int) -> int:
    """Entero de un parámetro (query o JSON) dentro de [lo, hi]."""
    if raw in (None, ""):
        return default
    if isinstance(raw, bool):
        raise ApiError(f"{name} tiene que ser un número entero", "invalid")
    try:
        v = int(str(raw).strip()) if not isinstance(raw, int) else raw
    except ValueError:
        raise ApiError(f"{name} tiene que ser un número entero", "invalid") from None
    if not lo <= v <= hi:
        raise ApiError(f"{name} va de {lo} a {hi}", "invalid")
    return v


def cat_chunk(data: bytes, offset: int, total: int) -> dict:
    """Un tramo leído con OPEN&offset&length: si quedó contenido después, se corta
    en el último salto de línea (así no queda una línea ni un carácter a medias) y
    length dice cuántos bytes se usaron, para pedir el tramo siguiente."""
    binary = b"\0" in data
    used = data
    if not binary and offset + len(data) < total:
        cut = data.rfind(b"\n")
        if cut >= 0:
            used = data[: cut + 1]
    return {"offset": offset, "length": len(used), "totalBytes": total,
            "text": "" if binary else used.decode("utf-8", "replace"),
            "truncated": offset + len(used) < total, "binary": binary}


def cat_command(path: str, offset: int, length: int) -> str:
    q = shlex.quote(path)
    if offset:
        return f"hdfs dfs -cat {q} | tail -c +{offset + 1} | head -c {length}"
    return f"hdfs dfs -cat {q} | head -c {length}"


def attachment(name: str) -> str:
    """Content-Disposition para bajar un archivo con su nombre (también con tildes)."""
    ascii_name = re.sub(r'[^A-Za-z0-9._-]+', "_", name) or "archivo"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(name, safe='')}"


# ---------------------------------------------------------------------------
# HTTP sin JVM
# ---------------------------------------------------------------------------


def http_get(url: str, timeout: float = 5.0, limit: int | None = None) -> tuple[int, bytes]:
    """(status, cuerpo). status 0 si no se pudo conectar."""
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (siempre localhost)
            return r.status, r.read(limit) if limit else r.read()
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.read()
        except OSError:
            return e.code, b""
    except (urllib.error.URLError, OSError, ValueError):
        return 0, b""


def http_stream(url: str, chunk: int = 1 << 20):
    """Generador con el cuerpo de url, de a chunk bytes (para bajar archivos
    sin tenerlos enteros en memoria). Sigue el 307 del NameNode al DataNode."""
    with urllib.request.urlopen(url, timeout=30) as r:  # noqa: S310 (siempre localhost)
        while True:
            b = r.read(chunk)
            if not b:
                break
            yield b


async def _kill_client(proc: asyncio.subprocess.Process) -> None:
    """El cliente hdfs es un script que lanza la JVM: se mata el grupo entero."""
    if proc.returncode is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            try:
                proc.kill()
            except ProcessLookupError:
                pass
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        pass


# ---------------------------------------------------------------------------
# El módulo
# ---------------------------------------------------------------------------


class Hdfs:
    def __init__(self, cluster, runner: ActionRunner, bus: EventBus):
        self.c = cluster
        self.runner = runner
        self.bus = bus
        # Se pueden reemplazar en los tests
        self.http = http_get
        self.stream = http_stream
        # Subidas en curso: ruta final -> id de la acción
        self.uploads: dict[str, str] = {}
        # Última ubicación conocida de cada bloque (id -> DataNodes) y a qué archivo es
        self.known: dict[int, set[int]] = {}
        self.block_names: dict[int, tuple[str, str]] = {}
        self.baseline = False
        self.recent: deque[dict] = deque(maxlen=50)
        self._fsck: tuple[float, list[dict], str] | None = None
        self._fsck_lock = asyncio.Lock()
        self._last_blocks: int | None = None
        self._last_files: int | None = None
        self._last_dn: str = ""
        # Cómo estaba HDFS en el último fsck de fondo: si no cambió nada, no hace falta otro
        self._quiet_sig: str = ""
        # Clientes hdfs (cada uno una JVM) corriendo ahora: el apagado los mata
        self._clients: set[asyncio.subprocess.Process] = set()
        self._seq = itertools.count(1)
        self.tmp_root = Path(os.environ.get("SANDBOX_UPLOADS", tempfile.gettempdir())) / "sandbox-subidas"
        cluster.watchers.append(self.watch)
        cluster.stoppers.append(self.halt)

    # ------------------------------------------------------------ util

    @property
    def block_mb(self) -> float | None:
        return cfg.block_size_mb(self.c.config["blockSize"])

    def _base(self) -> str:
        port = self.c.nn_active_port or 9870
        return f"http://localhost:{port}/webhdfs/v1"

    async def webhdfs(self, path: str, op: str, **params: object) -> dict | None:
        """Pide op sobre path. None si no existe; ApiError si HDFS no responde."""
        q = urllib.parse.urlencode({"op": op, "user.name": "root", **params})
        url = f"{self._base()}{urllib.parse.quote(path)}?{q}"
        status, body = await asyncio.to_thread(self.http, url)
        if status == 0:
            raise ApiError("HDFS no responde: no hay ningún NameNode activo", "service_down")
        try:
            doc = json.loads(body or b"{}")
        except ValueError:
            doc = {}
        if status == 404:
            return None
        if status >= 400:
            ex = (doc.get("RemoteException") or {})
            msg = ex.get("message") or f"WebHDFS respondió {status}"
            if ex.get("exception") == "StandbyException" or status == 403 and "standby" in msg.lower():
                raise ApiError("HDFS no responde: el NameNode está en standby", "service_down")
            raise ApiError(msg, "failed")
        return doc

    async def status_of(self, path: str) -> dict | None:
        doc = await self.webhdfs(path, "GETFILESTATUS")
        return None if doc is None else doc.get("FileStatus") or {}

    async def exec(self, argv: list[str], timeout: float = 60) -> tuple[int, str, str]:
        """Comando sin dejar rastro en la consola (para los sondeos). Solo con el cluster
        andando: un hdfs lanzado mientras arranca o se apaga es una JVM que reintenta
        contra un NameNode que no está y sigue viva después de 'stopped'."""
        if self.c.phase != "running":
            raise ApiError(f"HDFS no responde: el cluster está {self.c.phase}", "service_down")
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL, start_new_session=True)
        except OSError as e:
            raise ApiError(f"No se pudo correr {argv[0]}: {e}", "failed") from e
        self._clients.add(proc)
        try:
            if self.c.phase != "running":
                # El apagado empezó mientras se lanzaba
                await _kill_client(proc)
            else:
                try:
                    out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
                except asyncio.TimeoutError:
                    await _kill_client(proc)
                    raise ApiError(f"{shlex.join(argv)} tardó más de {timeout:g} s", "failed") from None
        finally:
            self._clients.discard(proc)
        if self.c.phase != "running":
            # Lo cortó el apagado (halt): su salida está a medias
            raise ApiError(f"HDFS no responde: el cluster está {self.c.phase}", "service_down")
        return proc.returncode or 0, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")

    async def halt(self) -> None:
        """Al apagar el cluster (Cluster.stoppers): mata los clientes hdfs en vuelo,
        como el fsck de fondo de watch(), y espera a que terminen."""
        self._fsck = None
        procs = list(self._clients)
        await asyncio.gather(*(_kill_client(p) for p in procs))

    def _live_dns(self) -> list[dict]:
        return self.datanodes()

    def datanodes(self) -> list[dict]:
        running = {int(p["id"][2:]) for p in self.c.processes
                   if p["kind"] == "datanode" and p["state"] in ("up", "starting")}
        expected = max([self.c.config["datanodes"], *running])
        # En el maestro del aula, el DataNode 1 es el suyo (el "archivo")
        hosts = {"maestro": 1} if self.c.aula else None
        return probes.datanodes_from_jmx(self.c.nn_jmx, now_ms(), expected, running, hosts=hosts)

    def _live_count(self) -> int:
        return sum(1 for d in self.datanodes() if d["state"] in ("live", "stale")) or self.c.hdfs.get("liveDataNodes", 0)

    def _fsn(self) -> dict:
        beans = probes.jmx_beans(self.c.nn_jmx or {})
        return probes._bean(beans, "FSNamesystem")

    # ------------------------------------------------- fsck y transferencias

    async def fsck_all(self, max_age: float = 2.0) -> list[dict]:
        """hdfs fsck / -files -blocks -locations -openforwrite, con caché corta."""
        async with self._fsck_lock:
            if self._fsck and time.monotonic() - self._fsck[0] < max_age:
                return self._fsck[1]
            rc, out, err = await self.exec(["hdfs", "fsck", "/", "-files", "-blocks", "-locations", "-openforwrite"])
            if "Connecting to namenode" not in out + err and not probes._FSCK_FILE.search(out):
                last = next((l for l in reversed((err or out).splitlines()) if l.strip()), "sin salida")
                raise ApiError(f"hdfs fsck falló: {last}", "failed")
            files = probes.parse_fsck(out, self.block_mb)
            self.observe(files)
            self._fsck = (time.monotonic(), files, out)
            return files

    def _down(self) -> set[int]:
        return {d["id"] for d in self.datanodes() if d["state"] == "dead"}

    def _drop_down(self, b: dict, down: set[int]) -> None:
        """Justo después de que el NameNode da por muerto a un DataNode, el fsck
        lo sigue listando un rato como ubicación (visto con Hadoop 3.3.6): esas
        copias van a 'stale', no a 'locations'."""
        gone = [x for x in b["locations"] if x in down]
        if gone:
            b["locations"] = [x for x in b["locations"] if x not in down]
            self.known.setdefault(b["id"], set()).update(gone)

    def observe(self, files: list[dict]) -> list[dict]:
        """Compara las ubicaciones de cada bloque con las de la vez anterior y
        publica las copias nuevas (evento 'transfer'). Devuelve las copias."""
        dns = {d["id"]: d["state"] for d in self.datanodes()}
        alive = {i for i, s in dns.items() if s in ("live", "stale", "starting")}
        down = {i for i, s in dns.items() if s == "dead"}
        moved: list[dict] = []
        current: dict[int, set[int]] = {}
        for f in files:
            for b in f["blocks"]:
                self._drop_down(b, down)
                locs = list(b["locations"])
                current[b["id"]] = set(locs)
                self.block_names[b["id"]] = (f["path"], b["name"])
                prev = self.known.get(b["id"])
                if not self.baseline:
                    continue
                if prev is None:
                    # Bloque nuevo: la tubería de escritura cliente -> DN -> DN
                    for i, to in enumerate(locs):
                        moved.append({"block": b["id"], "from": "client" if i == 0 else locs[i - 1], "to": to})
                else:
                    srcs = [x for x in locs if x in prev]
                    for to in locs:
                        if to not in prev:
                            moved.append({"block": b["id"], "from": srcs[0] if srcs else "client", "to": to})
        # Lo que quedó en DataNodes caídos se recuerda como copia 'stale'
        for bid, locs in current.items():
            prev = self.known.get(bid, set())
            keep = {x for x in prev if x not in alive and x not in locs}
            self.known[bid] = locs | keep
        for bid in [b for b in self.known if b not in current]:
            del self.known[bid]
            self.block_names.pop(bid, None)
        for f in files:
            for b in f["blocks"]:
                b["stale"] = sorted(self.known.get(b["id"], set()) - set(b["locations"]))
        self.baseline = True
        t = now_ms()
        for m in moved:
            self.recent.appendleft({**m, "at": t})
            self.bus.publish("transfer", {"transfer": m})
        return moved

    async def watch(self) -> None:
        """Después de cada sondeo: avisa por SSE qué cambió en HDFS."""
        h = self.c.hdfs
        if self.c.phase != "running" or not h.get("available"):
            self.baseline = False
            self._last_blocks = self._last_files = None
            return
        dn_sig = json.dumps([(d["id"], d["state"]) for d in self.datanodes()])
        fsn = self._fsn()
        busy = bool(self.uploads) or h.get("underReplicated") or int(fsn.get("PendingReplicationBlocks", 0) or 0) \
            or h.get("overReplicated") or (self._last_blocks is not None and h.get("blocks") != self._last_blocks) \
            or dn_sig != self._last_dn or not self.baseline
        if self._last_files is not None and h.get("files") != self._last_files:
            self.bus.publish("hdfs", {"path": "/"})
        self._last_blocks, self._last_files, self._last_dn = h.get("blocks"), h.get("files"), dn_sig
        if busy:
            try:
                await self.fsck_all(max_age=self._fsck_age())
            except ApiError:
                pass

    def _fsck_age(self, moving: float = 1.5) -> float:
        """Cada cuánto vale la pena otro fsck (un proceso Java entero cada vez). Mientras algo se mueve
        (subidas, copias en la cola, DataNodes que cambian, bloques nuevos), seguido; si HDFS quedó quieto
        con bloques sub-replicados que no tienen adónde copiarse, una vez cada QUIET_FSCK segundos."""
        h = self.c.hdfs
        pending = int(self._fsn().get("PendingReplicationBlocks", 0) or 0)
        sig = json.dumps([h.get("blocks"), h.get("files"), h.get("underReplicated"), h.get("overReplicated"),
                          h.get("missing"), self._last_dn, sorted(self.uploads)])
        quiet = sig == self._quiet_sig and not pending and not self.uploads
        self._quiet_sig = sig
        return QUIET_FSCK if quiet else moving

    # ------------------------------------------------------------ consultas

    async def files(self) -> list[dict]:
        if self.c.phase != "running" or not self.c.hdfs.get("available"):
            return []
        try:
            files = [dict(f) for f in await self.fsck_all()]
        except ApiError:
            # El cluster se apagó mientras corría el fsck (la interfaz sigue
            # sondeando un instante): no es un error, ya no hay archivos que ver.
            if self.c.phase != "running" or not self.c.hdfs.get("available"):
                return []
            raise
        # Fecha de modificación: un LISTSTATUS por carpeta (WebHDFS, sin JVM)
        mtimes: dict[str, int] = {}
        for d in sorted({parent_of(f["path"]) or "/" for f in files})[:100]:
            try:
                doc = await self.webhdfs(d, "LISTSTATUS")
            except ApiError:
                break
            for st in ((doc or {}).get("FileStatuses") or {}).get("FileStatus", []):
                mtimes[d.rstrip("/") + "/" + st.get("pathSuffix", "")] = int(st.get("modificationTime", 0))
        for f in files:
            if f["path"] in self.uploads or f["path"].endswith(COPYING):
                f["state"] = "writing"
            f["writtenBy"] = written_by(f["path"])
            f["modifiedAt"] = mtimes.get(f["path"], 0)
        return files

    async def _states(self) -> dict[str, str]:
        """Estado de cada archivo (ok/under/missing): solo hace falta un fsck si el
        NameNode dice que hay bloques con problemas."""
        h = self.c.hdfs
        if not (h.get("underReplicated") or h.get("missing")):
            return {}
        try:
            return {f["path"]: f["state"] for f in await self.fsck_all(max_age=5)}
        except ApiError:
            return {}

    async def listing(self, raw: object) -> dict:
        self.c.need_hdfs()
        path = clean(raw)
        st = await self.status_of(path)
        if st is None:
            raise ApiError(f"No existe {path}", "not_found")
        if st.get("type") == "FILE":
            raise ApiError(f"{path} es un archivo, no una carpeta", "invalid")
        doc = await self.webhdfs(path, "LISTSTATUS")
        if doc is None:
            raise ApiError(f"No existe {path}", "not_found")
        entries = [entry_from_status(x, path, self.block_mb)
                   for x in (doc.get("FileStatuses") or {}).get("FileStatus", [])]
        states = await self._states()
        for e in entries:
            if e["type"] == "file":
                if e["path"] in self.uploads:
                    e["state"] = "writing"
                elif e["state"] != "writing":
                    e["state"] = states.get(e["path"], "ok")
        entries.sort(key=lambda e: (e["type"] != "dir", e["name"]))
        return {"path": path, "parent": parent_of(path), "entries": entries}

    async def detail(self, raw: object) -> dict:
        self.c.need_hdfs()
        path = clean(raw)
        st = await self.status_of(path)
        if st is None:
            raise ApiError(f"No existe el archivo {path}", "not_found")
        if st.get("type") == "DIRECTORY":
            raise ApiError(f"{path} es una carpeta: abrila en el árbol", "invalid")
        rc, out, err = await self.exec(["hdfs", "fsck", path, "-files", "-blocks", "-locations", "-openforwrite"])
        parsed = probes.parse_fsck(out, None)
        f = next((x for x in parsed if x["path"] == path), None)
        size = int(st.get("length", 0))
        bs = int(st.get("blockSize", 0)) or int((self.block_mb or 128) * MB)
        if f is None:
            f = {"path": path, "sizeMb": mb(size), "replication": int(st.get("replication", 0)), "blocks": [],
                 "state": "ok"}
        f["blockSizeMb"] = mb(bs)
        down = self._down()
        for b in f["blocks"]:
            self._drop_down(b, down)
            b["stale"] = sorted(self.known.get(b["id"], set()) - set(b["locations"]))
        if path in self.uploads or path.endswith(COPYING) or "OPENFORWRITE" in out:
            f["state"] = "writing"
        status, data = (0, b"")
        if size:
            status, data = await asyncio.to_thread(
                self.http, f"{self._base()}{urllib.parse.quote(path)}?op=OPEN&user.name=root&length={PREVIEW_BYTES}",
                10.0, PREVIEW_BYTES)
        if size and status != 200:
            preview = {"columns": [], "rows": [], "note": "No se pudo leer el archivo (¿bloques perdidos?)"}
        else:
            preview = preview_from(path, data, size)
        return {**f, "writtenBy": written_by(path), "modifiedAt": int(st.get("modificationTime", 0)),
                "owner": st.get("owner", ""), "permission": perm_str(st.get("permission"), False),
                "preview": preview, "fsck": [l for l in (out.rstrip("\n").split("\n") if out else [])]}

    async def fsck(self, raw: object) -> dict:
        self.c.need_hdfs()
        path = clean(raw)
        if await self.status_of(path) is None:
            raise ApiError(f"No existe {path}", "not_found")
        shown = f"hdfs fsck {path} -files -blocks -locations"
        # fsck sale con 1 si el sistema está CORRUPT: eso no es que el comando falló
        run = await self.runner.run(Action(
            f"fsck de {path}", f"{shown.replace(path, shlex.quote(path))}; rc=$?; [ $rc -le 1 ]",
            display=shown, input=path,
            action="Le pregunta al NameNode, bloque por bloque, cuántas copias vivas tiene y en qué DataNode está "
                   "cada una. No lee los datos", timeout=120))
        raw_lines = [l["text"] for l in run.lines]
        text = "\n".join(raw_lines)
        if run.state != "done" and not re.search(r"is (HEALTHY|CORRUPT)", text):
            raise ApiError(run.error or next((l for l in reversed(raw_lines) if l.strip()), "hdfs fsck falló"),
                           "failed")
        r = parse_fsck_report(text, path)
        if path == "/":
            self.observe(probes.parse_fsck(text, self.block_mb))
        under, missing = r["underReplicated"], r["missing"]
        out = ("Sano: todos los bloques con sus copias" if r["healthy"] and not under else
               f"Sano, pero {plural(under, 'bloque')} con menos copias de las pedidas" if r["healthy"] else
               f"{plural(missing, 'bloque')} sin ninguna copia" if missing else "CORRUPT")
        r["raw"] = raw_lines
        r["trace"] = {"command": shown, "input": f"{plural(r['files'], 'archivo')} bajo {path}",
                      "action": "Le pregunta al NameNode, bloque por bloque, cuántas copias vivas tiene y en qué "
                                "DataNode está cada una. No lee los datos",
                      "output": out, "engine": "hdfs"}
        return r

    async def replication(self) -> dict:
        """La cola de re-replicación, armada con el fsck (bloque por bloque) y los contadores de JMX.

        underReplicated es el contador de JMX (todo el cluster, lo que el NameNode ya sabe). El fsck puede
        ir unos segundos atrás: sigue listando como ubicación a un DataNode recién muerto. Por eso las copias
        se cuentan solo en DataNodes vivos, y noRoom dice cuántos bloques no tienen adónde copiarse (piden más
        copias que DataNodes vivos hay): esos no entran en la cola aunque cuenten como sub-replicados."""
        self.c.need_hdfs()
        h = self.c.hdfs
        fsn = self._fsn()
        pending = int(fsn.get("PendingReplicationBlocks", 0) or 0)
        now = now_ms()
        dns = self.datanodes()
        stale = [{"dataNode": d["id"], "deadInSec": max(0, round((d["deadAt"] - now) / 1000))}
                 for d in dns if d["state"] == "stale" and d.get("deadAt")]
        live_ids = {d["id"] for d in dns if d["state"] in ("live", "stale")}
        live = self._live_count()
        tasks: list[dict] = []
        no_room = 0
        if h.get("underReplicated") or h.get("overReplicated") or pending:
            try:
                files = await self.fsck_all(max_age=self._fsck_age(3))
            except ApiError:
                files = []
            for f in files:
                if f["state"] == "writing":
                    continue
                for b in f["blocks"]:
                    locs = [l for l in b["locations"] if not live_ids or l in live_ids]
                    k = len(locs)
                    if 0 < k < f["replication"]:
                        if k >= live:
                            no_room += 1
                        for _ in range(k, max(k, min(f["replication"], live))):
                            tasks.append({"block": b["name"], "file": f["path"], "kind": "copy",
                                          "from": locs[0], "state": "running" if pending else "pending"})
                    elif k > f["replication"]:
                        tasks.append({"block": b["name"], "file": f["path"], "kind": "delete",
                                      "from": locs[-1], "state": "pending"})
        return {"underReplicated": int(h.get("underReplicated", 0)), "pending": pending,
                "missing": int(h.get("missing", 0)), "overReplicated": int(h.get("overReplicated", 0)),
                "noRoom": no_room, "liveDataNodes": live,
                "stale": stale, "tasks": tasks, "recent": list(self.recent)}

    # ------------------------------------------------------------- acciones

    def _flags(self, replication: object, block_size: object) -> tuple[list[str], int | None, float | None]:
        flags: list[str] = []
        rep = None
        if replication not in (None, ""):
            try:
                rep = int(replication)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                raise ApiError("La replicación es un número de 1 a 9", "invalid") from None
            if not 1 <= rep <= 9:
                raise ApiError("La replicación va de 1 a 9", "invalid")
            flags += ["-D", f"dfs.replication={rep}"]
        bs = None
        if block_size not in (None, ""):
            bs = cfg.block_size_mb(str(block_size))
            if not bs:
                raise ApiError(f"Tamaño de bloque inválido: {block_size} (por ejemplo 128m o 2m)", "invalid")
            flags += ["-D", f"dfs.blocksize={str(block_size).strip().lower()}"]
        return flags, rep, bs

    async def upload(self, dest_raw: object, *, example: object = None, local: Path | None = None,
                     name: str | None = None, replication: object = None, block_size: object = None,
                     cleanup: Path | None = None, source: str = "Vos") -> dict:
        try:
            self.c.need_hdfs()
            dest = clean(dest_raw)
            flags, rep, bs = self._flags(replication, block_size)
            datos = self.c.s.datos_dir
            gen = None
            if example not in (None, ""):
                ex = EXAMPLES.get(str(example))
                if ex is None:
                    raise ApiError(f"No hay un ejemplo {example}: {', '.join(EXAMPLES)}", "invalid")
                if ex["script"] and not (datos / ex["script"]).exists():
                    raise ApiError(f"{ex['script']} no está en esta versión de la imagen", "unsupported")
                local = datos / ex["local"]
                name = local.name
                rows = ex["rows"]
                if ex["gen"] and not (local.exists() and local.stat().st_size > 0):
                    gen = ex["gen"]
            elif local is not None:
                rows = "archivo de tu compu"
            else:
                raise ApiError("Falta el archivo: example o file", "invalid")
            assert local is not None and name
            st = await self.status_of(dest)
            if st is not None and st.get("type") == "FILE":
                raise ApiError(f"{dest} es un archivo: elegí una carpeta", "invalid")
            path = (dest.rstrip("/") or "") + "/" + name
            if path in self.uploads:
                raise ApiError(f"{path} se está escribiendo", "busy")
        except ApiError:
            if cleanup:
                shutil.rmtree(cleanup, ignore_errors=True)
            raise
        size = local.stat().st_size if local.exists() else None
        bs_mb = bs or self.block_mb or 128
        rep_eff = rep or self.c.config["replication"]
        live = self._live_count() or rep_eff
        copies = min(rep_eff, live)
        put = ["hdfs", "dfs", *flags, "-put", "-f", str(local), dest.rstrip("/") + "/"]
        shown = shlex.join(put)
        steps = [f"hdfs dfs -mkdir -p {shlex.quote(dest)}", shown]
        if gen:
            steps.insert(0, gen)
            shown = f"{gen} && {shown}"
        script = f"set -e\ncd {shlex.quote(str(datos))}\n" + "\n".join(steps)
        if cleanup:
            script = f"trap 'rm -rf {shlex.quote(str(cleanup))}' EXIT\n" + script
        nblocks = math.ceil(size / (bs_mb * MB)) if size else None
        trace = {
            "command": shown,
            "input": f"{name} · {rows}" + (f" · {fmt_mb(mb(size))}" if size else " · se genera antes de subir"),
            "action": f"Lo corta en bloques de {bs_mb:g} MB; cada bloque va a un DataNode, que lo pasa al siguiente "
                      f"hasta tener {plural(copies, 'copia')}",
            "output": f"{path}: " + (f"{plural(nblocks, 'bloque')} × {plural(copies, 'copia')}" if nblocks
                                     else plural(copies, "copia") + " de cada bloque"),
            "engine": "hdfs",
        }
        after = local_preview(local) if size else None
        if after:
            trace["after"] = after
        box: dict[str, Run] = {}

        async def done() -> object:
            run = box.get("run")
            self.uploads.pop(path, None)
            self.bus.publish("hdfs", {"path": dest})
            if run is None or run.exitCode != 0:
                return None
            try:
                files = await self.fsck_all(max_age=0)
            except ApiError:
                return path
            f = next((x for x in files if x["path"] == path), None)
            if f is None:
                return path
            return f"{path}: {plural(len(f['blocks']), 'bloque')} · " + \
                   f"{sum(len(b['locations']) for b in f['blocks'])} copias en DataNodes " + \
                   ", ".join(sorted({str(x) for b in f["blocks"] for x in b["locations"]}))

        run = self.runner.start(Action(
            f"Subir {name} a {dest}", script, display=shown, input=trace["input"], action=trace["action"],
            source=source, after=done, timeout=1800))
        box["run"] = run
        self.uploads[path] = run.id
        self.bus.publish("hdfs", {"path": dest})
        return {"id": run.id, "state": "running", "trace": trace}

    async def _run_now(self, action: Action) -> Run:
        run = await self.runner.run(action)
        if run.state != "done":
            last = run.error or next((l["text"] for l in reversed(run.lines) if l["text"].strip()), "el comando falló")
            raise ApiError(last, "failed")
        return run

    async def mkdir(self, raw: object) -> dict:
        self.c.need_hdfs()
        path = clean(raw)
        st = await self.status_of(path)
        if st is not None and st.get("type") == "FILE":
            raise ApiError(f"Ya hay un archivo en {path}", "invalid")
        cmd = ["hdfs", "dfs", "-mkdir", "-p", path]
        trace = {"command": shlex.join(cmd), "input": path,
                 "action": "Crea la carpeta (y las de arriba que falten). Solo cambia los metadatos del NameNode: "
                           "no toca ningún DataNode",
                 "output": "Ya existía: no cambia nada" if st is not None else "Carpeta vacía", "engine": "hdfs"}
        run = await self._run_now(Action(f"Carpeta {path}", cmd, input=path, action=trace["action"],
                                         after=lambda: _const(trace["output"])))
        self.bus.publish("hdfs", {"path": path})
        return {"id": run.id, "state": "done", "trace": trace}

    async def delete(self, raw: object, recursive: bool) -> dict:
        self.c.need_hdfs()
        path = clean(raw)
        if path == "/":
            raise ApiError("No se puede borrar la raíz", "invalid")
        st = await self.status_of(path)
        if st is None:
            raise ApiError(f"No existe {path}", "not_found")
        is_dir = st.get("type") == "DIRECTORY"
        if is_dir and not recursive and int(st.get("childrenNum", 0)):
            raise ApiError(f"{path} no está vacía: hace falta borrar con -r", "invalid")
        if any(inside(u, path) for u in self.uploads):
            raise ApiError(f"Hay un archivo escribiéndose en {path}", "busy")
        summary = ((await self.webhdfs(path, "GETCONTENTSUMMARY")) or {}).get("ContentSummary") or {}
        n_files = int(summary.get("fileCount", 0 if is_dir else 1))
        size = int(summary.get("length", st.get("length", 0)))
        consumed = int(summary.get("spaceConsumed", size * int(st.get("replication", 1) or 1)))
        if is_dir:
            doc = await self.webhdfs(path, "LISTSTATUS") or {}
            rows = [[e["path"], fmt_mb(e.get("sizeMb", 0)) if e["type"] == "file" else "carpeta", e.get("blocks", "")]
                    for e in (entry_from_status(x, path, self.block_mb)
                              for x in (doc.get("FileStatuses") or {}).get("FileStatus", [])[:20])]
        else:
            e = entry_from_status(st, path, self.block_mb)
            rows = [[path, fmt_mb(e["sizeMb"]), e["blocks"]]]
        cmd = ["hdfs", "dfs", "-rm", *(["-r"] if is_dir else []), "-skipTrash", path]
        trace = {"command": shlex.join(cmd),
                 "input": f"{path} con {plural(n_files, 'archivo')}" if is_dir else f"{path} · {fmt_mb(mb(size))}",
                 "action": "El NameNode borra la entrada de sus metadatos y en el próximo latido les dice a los "
                           "DataNodes que borren los bloques",
                 "output": f"{fmt_mb(mb(consumed))} liberados en los DataNodes (contando las copias)",
                 "engine": "hdfs",
                 "before": {"columns": ["ruta", "tamaño", "bloques"], "rows": rows, "total": n_files},
                 "after": {"columns": [], "rows": [], "note": "Ya no está"}}
        run = await self._run_now(Action(f"Borrar {path}", cmd, input=trace["input"], action=trace["action"],
                                         after=lambda: _const(trace["output"])))
        self.bus.publish("hdfs", {"path": parent_of(path) or "/"})
        return {"id": run.id, "state": "done", "trace": trace}

    async def set_replication(self, raw: object, replication: object) -> str:
        self.c.need_hdfs()
        path = clean(raw)
        try:
            n = int(replication)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raise ApiError("La replicación es un número de 1 a 9", "invalid") from None
        if not 1 <= n <= 9:
            raise ApiError("La replicación va de 1 a 9", "invalid")
        st = await self.status_of(path)
        if st is None:
            raise ApiError(f"No existe {path}", "not_found")
        prev = int(st.get("replication", 0))
        live = self._live_count()
        # Con -w espera a que estén todas las copias: si no alcanzan los DataNodes no terminaría nunca
        wait = n <= live
        cmd = ["hdfs", "dfs", "-setrep", *(["-w"] if wait else []), str(n), path]
        what = ("El NameNode agrega copias en otros DataNodes" if n > prev else
                "El NameNode borra las copias que sobran" if n < prev else "Ya tenía esa replicación")
        if not wait:
            what += f"; con {plural(live, 'DataNode')} vivo{'s' if live != 1 else ''} queda sub-replicado"
        run = self.runner.start(Action(
            f"Replicación de {name_of(path)}: {prev} → {n}", cmd, input=f"{path} con {plural(prev, 'copia')}",
            action=what, before=self.c.hdfs_snapshot, after=self.c.hdfs_snapshot, timeout=300))
        return run.id

    async def add_datanode(self) -> dict:
        self.c.need_running()
        ids = {d["id"] for d in self.datanodes() if d["state"] != "off"}
        ids |= {int(p["id"][2:]) for p in self.c.processes if p["kind"] == "datanode" and p["state"] != "off"}
        n = max(ids, default=0) + 1
        if n > 9:
            raise ApiError("Hasta 9 DataNodes (puertos 9901-9909)", "invalid")
        cmd = [f"{self.c.s.bin_dir}/datanode", "start", str(n)]
        run = self.runner.start(Action(
            f"Prender DataNode {n}", cmd, input=f"DataNode {n} (http://localhost:{dn_http(n)})",
            action="arranca en caliente con su propia carpeta de datos (/hadoop/dfs/dn"
                   f"{n}) y se anota en el NameNode; los bloques nuevos ya pueden ir ahí",
            before=self.c.hdfs_snapshot, after=self.c.hdfs_snapshot, process_id=f"dn{n}"))
        return {"id": run.id, "dataNode": n}

    # ------------------------------------------------- leer, bajar y mover

    async def _file_status(self, path: str) -> dict:
        st = await self.status_of(path)
        if st is None:
            raise ApiError(f"No existe el archivo {path}", "not_found")
        if st.get("type") == "DIRECTORY":
            raise ApiError(f"{path} es una carpeta: abrila en el árbol", "invalid")
        return st

    def _open_url(self, path: str, offset: int = 0, length: int | None = None) -> str:
        q = {"op": "OPEN", "user.name": "root"}
        if offset:
            q["offset"] = str(offset)
        if length is not None:
            q["length"] = str(length)
        return f"{self._base()}{urllib.parse.quote(path)}?{urllib.parse.urlencode(q)}"

    async def cat(self, raw: object, offset_raw: object = None, length_raw: object = None) -> dict:
        """Un tramo del archivo (hdfs dfs -cat, por WebHDFS OPEN con offset y length)."""
        self.c.need_hdfs()
        path = clean(raw)
        offset = bounded_int(offset_raw, "offset", 0, 1 << 50, 0)
        length = bounded_int(length_raw, "length", 1, CAT_MAX, CAT_DEFAULT)
        st = await self._file_status(path)
        total = int(st.get("length", 0))
        if offset > total:
            raise ApiError(f"offset {offset} pasa el final del archivo ({total} bytes)", "invalid")
        data = b""
        if total and offset < total:
            status, data = await asyncio.to_thread(self.http, self._open_url(path, offset, length), 15.0, length)
            if status != 200:
                raise ApiError(f"No se pudo leer {path} (¿bloques perdidos?)", "failed")
            data = data[:length]
        out = cat_chunk(data, offset, total)
        return {"path": path, **out, "command": cat_command(path, offset, out["length"] or length)}

    async def download(self, raw: object) -> tuple[str, int, object]:
        """(nombre, bytes, generador del contenido) para bajar el archivo entero."""
        self.c.need_hdfs()
        path = clean(raw)
        st = await self._file_status(path)
        size = int(st.get("length", 0))
        # No es un -get: el archivo no pasa por el contenedor, va directo al navegador por WebHDFS
        url = f"http://localhost:9870/webhdfs/v1{urllib.parse.quote(path)}?op=OPEN&user.name=root"
        self.bus.log("Vos", "info", f"Bajar {name_of(path)}",
                     command=f"curl -L {shlex.quote(url)} -o {shlex.quote(name_of(path))}",
                     input=f"{path} · {fmt_mb(mb(size))}",
                     action="El NameNode dice en qué DataNodes está cada bloque y se leen en orden (WebHDFS OPEN). "
                            "No queda copia en el contenedor: eso sería hdfs dfs -get",
                     output="El archivo entero, a tu compu (a la carpeta de descargas del navegador)")
        return name_of(path), size, self.stream(self._open_url(path))

    async def move(self, src_raw: object, dst_raw: object) -> dict:
        """hdfs dfs -mv: renombra o mueve (si el destino es una carpeta, va adentro)."""
        self.c.need_hdfs()
        src, dst = clean(src_raw), clean(dst_raw)
        if src in NO_MOVE:
            raise ApiError(f"{src} es una carpeta del sistema: no se mueve", "invalid")
        if src == dst:
            raise ApiError("El origen y el destino son la misma ruta", "invalid")
        st = await self.status_of(src)
        if st is None:
            raise ApiError(f"No existe {src}", "not_found")
        if any(inside(u, src) for u in self.uploads):
            raise ApiError(f"Hay un archivo escribiéndose en {src}", "busy")
        dst_st = await self.status_of(dst)
        final = dst
        if dst_st is not None:
            if dst_st.get("type") != "DIRECTORY":
                raise ApiError(f"Ya existe {dst}: elegí otro nombre", "invalid")
            final = dst.rstrip("/") + "/" + name_of(src) if dst != "/" else "/" + name_of(src)
            if await self.status_of(final) is not None:
                raise ApiError(f"Ya existe {final}: elegí otro nombre", "invalid")
        else:
            up = parent_of(dst) or "/"
            up_st = await self.status_of(up)
            if up_st is None or up_st.get("type") != "DIRECTORY":
                raise ApiError(f"No existe la carpeta {up}: creala primero", "invalid")
        if final == src or inside(final, src):
            raise ApiError(f"No se puede mover {src} adentro de sí misma", "invalid")
        is_dir = st.get("type") == "DIRECTORY"
        cmd = ["hdfs", "dfs", "-mv", src, dst]
        same_dir = parent_of(final) == parent_of(src)
        trace = {"command": shlex.join(cmd), "input": f"{src}" + ("" if is_dir else f" · {fmt_mb(mb(int(st.get('length', 0))))}"),
                 "action": "Solo cambia los metadatos del NameNode: los bloques quedan en los mismos DataNodes, "
                           "no se copia nada",
                 "output": f"{'Renombrado' if same_dir else 'Movido'}: ahora es {final}", "engine": "hdfs"}
        run = await self._run_now(Action(f"{'Renombrar' if same_dir else 'Mover'} {src}", cmd, input=trace["input"],
                                         action=trace["action"], after=lambda: _const(trace["output"])))
        self.bus.publish("hdfs", {"path": parent_of(src) or "/"})
        self.bus.publish("hdfs", {"path": parent_of(final) or "/"})
        # id es el de la acción (GET /api/actions/:id); path, dónde quedó (con destino carpeta, adentro)
        return {"id": run.id, "state": "done", "trace": trace, "path": final}

    # ---------------------------------------------------------------- rutas

    def routes(self) -> list[Route]:
        async def datanodes(_: Request) -> JSONResponse:
            return JSONResponse(self.datanodes())

        async def add_dn(_: Request) -> JSONResponse:
            return JSONResponse(await self.add_datanode(), status_code=202)

        async def files_get(_: Request) -> JSONResponse:
            return JSONResponse(await self.files())

        async def files_patch(request: Request) -> Response:
            body = await _json(request)
            run_id = await self.set_replication(body.get("path"), body.get("replication"))
            # id: la acción (GET /api/actions/:id), para seguir el setrep hasta que estén las copias
            return JSONResponse({"id": run_id}, status_code=202)

        async def files_delete(request: Request) -> JSONResponse:
            q = request.query_params
            return JSONResponse(await self.delete(q.get("path"), q.get("recursive", "0") in ("1", "true")))

        async def put(request: Request) -> JSONResponse:
            body = await _json(request)
            ex = body.get("example")
            if ex not in ("ventas", "numeros", "sucias"):
                raise ApiError("El ejemplo es ventas, numeros o sucias", "invalid")
            return JSONResponse(await self.upload(EXAMPLES[ex]["put"], example=ex), status_code=202)

        async def ls(request: Request) -> JSONResponse:
            return JSONResponse(await self.listing(request.query_params.get("path", "/")))

        async def file(request: Request) -> JSONResponse:
            return JSONResponse(await self.detail(request.query_params.get("path")))

        async def upload(request: Request) -> JSONResponse:
            ctype = request.headers.get("content-type", "")
            if ctype.startswith("multipart/form-data"):
                return JSONResponse(await self._upload_form(request), status_code=202)
            body = await _json(request)
            return JSONResponse(await self.upload(body.get("dest"), example=body.get("example"),
                                                  replication=body.get("replication"),
                                                  block_size=body.get("blockSize")), status_code=202)

        async def mkdir(request: Request) -> JSONResponse:
            body = await _json(request)
            return JSONResponse(await self.mkdir(body.get("path")))

        async def fsck(request: Request) -> JSONResponse:
            return JSONResponse(await self.fsck(request.query_params.get("path", "/")))

        async def replication(_: Request) -> JSONResponse:
            return JSONResponse(await self.replication())

        async def cat(request: Request) -> JSONResponse:
            q = request.query_params
            return JSONResponse(await self.cat(q.get("path"), q.get("offset"), q.get("length")))

        async def download(request: Request) -> StreamingResponse:
            name, size, body = await self.download(request.query_params.get("path"))
            return StreamingResponse(body, media_type="application/octet-stream",
                                     headers={"Content-Disposition": attachment(name), "Content-Length": str(size)})

        async def move(request: Request) -> JSONResponse:
            body = await _json(request)
            return JSONResponse(await self.move(body.get("from"), body.get("to")))

        return [
            Route("/api/hdfs/datanodes", datanodes, methods=["GET"]),
            Route("/api/hdfs/datanodes", add_dn, methods=["POST"]),
            Route("/api/hdfs/files", files_get, methods=["GET"]),
            Route("/api/hdfs/files", files_patch, methods=["PATCH"]),
            Route("/api/hdfs/files", files_delete, methods=["DELETE"]),
            Route("/api/hdfs/put", put, methods=["POST"]),
            Route("/api/hdfs/ls", ls, methods=["GET"]),
            Route("/api/hdfs/file", file, methods=["GET"]),
            Route("/api/hdfs/upload", upload, methods=["POST"]),
            Route("/api/hdfs/mkdir", mkdir, methods=["POST"]),
            Route("/api/hdfs/fsck", fsck, methods=["GET"]),
            Route("/api/hdfs/replication", replication, methods=["GET"]),
            Route("/api/hdfs/cat", cat, methods=["GET"]),
            Route("/api/hdfs/download", download, methods=["GET"]),
            Route("/api/hdfs/move", move, methods=["POST"]),
        ]

    async def _upload_form(self, request: Request) -> dict:
        """Archivo de la compu (multipart/form-data). python-multipart lo va
        volcando a disco mientras llega; acá se copia con su nombre a una carpeta
        temporal propia, que se borra cuando termina el -put."""
        self.c.need_hdfs()
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_UPLOAD_MB * MB:
            raise ApiError(f"El archivo pasa el máximo de {MAX_UPLOAD_MB} MB", "invalid")
        try:
            form = await request.form(max_files=1, max_fields=10)
        except Exception as e:  # noqa: BLE001 (cuerpo multipart roto)
            raise ApiError(f"No se pudo leer el archivo subido: {e}", "invalid") from e
        try:
            up = form.get("file")
            if up is None or isinstance(up, str) or not getattr(up, "filename", None):
                raise ApiError("Falta el archivo: example o file", "invalid")
            name = re.sub(r"[^\w.\-]+", "_", posixpath.basename(up.filename.replace("\\", "/"))).strip("._") or "archivo"
            folder = self.tmp_root / f"s{next(self._seq)}-{os.getpid()}"
            folder.mkdir(parents=True, exist_ok=True)
            target = folder / name

            def copy() -> int:
                n = 0
                with target.open("wb") as out:
                    up.file.seek(0)
                    while chunk := up.file.read(1 << 20):
                        n += len(chunk)
                        if n > MAX_UPLOAD_MB * MB:
                            raise ApiError(f"El archivo pasa el máximo de {MAX_UPLOAD_MB} MB", "invalid")
                        out.write(chunk)
                return n

            try:
                await asyncio.to_thread(copy)
            except ApiError:
                shutil.rmtree(folder, ignore_errors=True)
                raise
            return await self.upload(form.get("dest"), local=target, name=name, replication=form.get("replication"),
                                     block_size=form.get("blockSize"), cleanup=folder)
        finally:
            await form.close()


async def _const(v: object) -> object:
    return v


async def _json(request: Request) -> dict:
    try:
        body = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ApiError("El cuerpo tiene que ser JSON", "invalid") from None
    if not isinstance(body, dict):
        raise ApiError("El cuerpo tiene que ser un objeto JSON", "invalid")
    return body
