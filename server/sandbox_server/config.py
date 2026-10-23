"""Configuración del cluster: las mismas variables del `docker run` (DATANODES,
REPLICATION, ...) vistas como el objeto ClusterConfig de la interfaz.

Las reglas (validación, RAM estimada, docker-compose.yml) son las mismas que
ui/src/lib/cluster.ts: la interfaz las usa en modo demo y el servidor en vivo.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .specs import jn_http, nn_http

SERVICES = ("hdfs", "mapreduce", "todo")
PIG_HEAPS = (256, 512, 1024, 2048)
DOCKER_LIMIT_MB = 7884  # lo que Docker Desktop le da por defecto en una PC de 16 GB

# Los valores de fábrica de la imagen (sandbox/lib.sh): lo que no se pasa con -e
IMAGE_DEFAULTS = {
    "datanodes": 1, "replication": 1, "blockSize": "128m", "namenodes": 1,
    "services": "todo", "mongodb": False, "jupyter": True, "pigHeapsize": 512,
}

_BLOCK_RE = re.compile(r"^([1-9][0-9]*)([mMgG])$")


def block_size_mb(value: str) -> int | None:
    m = _BLOCK_RE.match(str(value).strip())
    if not m:
        return None
    return int(m.group(1)) * (1024 if m.group(2).lower() == "g" else 1)


def _si(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower().replace("í", "i") == "si"


def from_env(env: dict[str, str] | None = None) -> dict:
    """La configuración que dicen las variables de entorno del contenedor."""
    env = os.environ if env is None else env
    c = dict(IMAGE_DEFAULTS)

    def entero(nombre: str, campo: str) -> None:
        v = env.get(nombre)
        if v and v.strip().isdigit():
            c[campo] = int(v)

    entero("DATANODES", "datanodes")
    entero("REPLICATION", "replication")
    entero("NAMENODES", "namenodes")
    entero("PIG_HEAPSIZE", "pigHeapsize")
    if env.get("BLOCK_SIZE"):
        c["blockSize"] = env["BLOCK_SIZE"].strip()
    if env.get("SERVICIOS"):
        c["services"] = env["SERVICIOS"].strip()
    c["mongodb"] = _si(env.get("MONGODB"), c["mongodb"])
    c["jupyter"] = _si(env.get("JUPYTER"), c["jupyter"])
    return c


def to_env(c: dict) -> dict[str, str]:
    """Las variables que lee /opt/entrypoint.sh (y sandbox/lib.sh)."""
    yn = lambda b: "si" if b else "no"  # noqa: E731
    return {
        "DATANODES": str(c["datanodes"]),
        "REPLICATION": str(c["replication"]),
        "BLOCK_SIZE": str(c["blockSize"]),
        "NAMENODES": str(c["namenodes"]),
        "SERVICIOS": str(c["services"]),
        "MONGODB": yn(c["mongodb"]),
        "JUPYTER": yn(c["jupyter"]),
        "PIG_HEAPSIZE": str(c["pigHeapsize"]),
    }


def normalize(raw: object) -> dict:
    """Toma lo que mandó la interfaz y devuelve un ClusterConfig con todos los
    campos (lo que falta, de fábrica). No valida rangos: eso es validate()."""
    if not isinstance(raw, dict):
        raise ValueError("config tiene que ser un objeto")
    c = dict(IMAGE_DEFAULTS)
    for k in IMAGE_DEFAULTS:
        if k in raw:
            c[k] = raw[k]
    return c


def _es_entero(v: object) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def validate(c: dict, volume_namenodes: int | None) -> list[dict]:
    out: list[dict] = []

    def issue(field: str, level: str, message: str) -> None:
        out.append({"field": field, "level": level, "message": message})

    dn, rep = c.get("datanodes"), c.get("replication")
    if not _es_entero(dn) or not 1 <= dn <= 9:
        issue("datanodes", "error", "Tiene que ser un número de 1 a 9.")
    if not _es_entero(rep) or not 1 <= rep <= 9:
        issue("replication", "error", "Tiene que ser un número de 1 a 9.")
    elif _es_entero(dn) and rep > dn:
        s = "s" if dn > 1 else ""
        issue("replication", "warning",
              f"Hay {dn} DataNode{s}: cada bloque va a quedar con {dn} copia{s} y HDFS lo marca sub-replicado.")
    elif rep == 1:
        issue("replication", "warning",
              "Con una sola copia, si se cae un DataNode sus bloques quedan perdidos hasta que vuelva.")
    if block_size_mb(str(c.get("blockSize", ""))) is None:
        issue("blockSize", "error", "Número seguido de m o g: 1m, 32m, 128m, 1g. Mínimo 1m.")
    nn = c.get("namenodes")
    if not _es_entero(nn) or nn not in (1, 2, 3):
        issue("namenodes", "error", "Tiene que ser 1, 2 o 3.")
    elif volume_namenodes is not None and volume_namenodes != nn:
        s = "s" if volume_namenodes > 1 else ""
        issue("namenodes", "error",
              f"El volumen se creó con {volume_namenodes} NameNode{s}. Para cambiarlo hay que borrar el volumen.")
    if c.get("services") not in SERVICES:
        issue("services", "error", "Tiene que ser hdfs, mapreduce o todo.")
    if not isinstance(c.get("mongodb"), bool):
        issue("mongodb", "error", "Tiene que ser sí o no.")
    if not isinstance(c.get("jupyter"), bool):
        issue("jupyter", "error", "Tiene que ser sí o no.")
    elif c.get("services") == "hdfs" and c.get("mongodb") is False and c["jupyter"]:
        issue("jupyter", "warning", "Sin YARN, los notebooks solo pueden usar pandas y PySpark local.")
    if not _es_entero(c.get("pigHeapsize")) or c["pigHeapsize"] not in PIG_HEAPS:
        issue("pigHeapsize", "error", "Elegí 256, 512, 1024 o 2048 MB.")
    return out


def has_errors(issues: list[dict]) -> bool:
    return any(i["level"] == "error" for i in issues)


def estimate_ram(c: dict, limit_mb: int = DOCKER_LIMIT_MB) -> dict:
    parts = [{"label": "HDFS y sistema", "mb": 4096}]
    dn = c["datanodes"]
    if dn > 1:
        parts.append({"label": f"{dn - 1} DataNode{'s' if dn > 2 else ''} más", "mb": 256 * (dn - 1)})
    if c["services"] != "hdfs":
        parts.append({"label": "YARN, MapReduce y MySQL", "mb": 1024})
    if c["services"] == "todo":
        parts.append({"label": "Hive y Spark", "mb": 1024})
    if c["namenodes"] > 1:
        parts.append({"label": f"Alta disponibilidad ({c['namenodes']} NameNodes)",
                      "mb": 2048 if c["namenodes"] == 2 else 2560})
    if c["mongodb"]:
        parts.append({"label": "MongoDB", "mb": 512})
    if c["jupyter"]:
        parts.append({"label": "JupyterLab", "mb": 384})
    parts.append({"label": "Esta interfaz", "mb": 128})
    return {"totalMb": sum(p["mb"] for p in parts), "parts": parts, "limitMb": limit_mb}


def compose_yaml(c: dict) -> str:
    """El docker-compose.yml equivalente (mismo texto que genera la interfaz)."""
    yn = lambda b: "si" if b else "no"  # noqa: E731
    nn, dn, rep = c["namenodes"], c["datanodes"], c["replication"]
    tag = os.environ.get("SANDBOX_VERSION", "full")  # la empresa sin ROL se usa igual que la full
    L = [
        f"# BigData Sandbox :{tag}, generado desde la interfaz (localhost:8080)",
        "#   docker compose up -d        crear y prender",
        '#   docker compose logs -f      seguir el arranque hasta "Cluster LISTO"',
        "#   docker compose stop         apagar en orden (los datos quedan)",
        "# Las mismas variables sirven con :base y :ml (sin interfaz): esas arrancan siempre solas.",
        "",
        "name: bigdata",
        "",
        "services:",
        "  bigdata:",
        f"    image: franki678/bigdata-sandbox:{tag}",
        "    container_name: bigdata",
        "    environment:",
        '      AUTOSTART: "1"                 # arranca solo con estas variables; sin ella espera «Iniciar» en la interfaz',
        f'      DATANODES: "{dn}"',
        f'      REPLICATION: "{rep}"' + ("   # mayor que DATANODES: sub-replicado" if rep > dn else ""),
        f'      BLOCK_SIZE: "{c["blockSize"]}"',
        f'      NAMENODES: "{nn}"' + ("   # alta disponibilidad: queda fijo en el volumen" if nn > 1 else ""),
        f'      SERVICIOS: "{c["services"]}"',
        f'      MONGODB: "{yn(c["mongodb"])}"',
        f'      JUPYTER: "{yn(c["jupyter"])}"',
        f'      PIG_HEAPSIZE: "{c["pigHeapsize"]}"' if c["pigHeapsize"] != 512 else '      # PIG_HEAPSIZE: "512"',
        "    ports:",
        '      - "127.0.0.1:8080:8080"             # esta interfaz',
        '      - "127.0.0.1:9870:9870"             # NameNode 1',
    ]
    if nn > 1:
        L.append(f'      - "127.0.0.1:{nn_http(2)}-{nn_http(nn)}:{nn_http(2)}-{nn_http(nn)}"   # NameNodes 2{" y 3" if nn > 2 else ""}')
        L.append(f'      - "127.0.0.1:{jn_http(1)}-{jn_http(3)}:{jn_http(1)}-{jn_http(3)}"   # JournalNodes')
    else:
        L.append('      - "127.0.0.1:9868:9868"             # Secondary NameNode')
    L.append('      - "127.0.0.1:9901-9909:9901-9909"   # DataNode N en 990N')
    if c["services"] != "hdfs":
        L += ['      - "127.0.0.1:8088:8088"             # YARN ResourceManager',
              '      - "127.0.0.1:8042:8042"             # NodeManager',
              '      - "127.0.0.1:19888:19888"           # JobHistory']
    if c["services"] == "todo":
        L += ['      - "127.0.0.1:10000:10000"           # HiveServer2 (JDBC)',
              '      - "127.0.0.1:10002:10002"           # HiveServer2 (web)',
              '      - "127.0.0.1:18080:18080"           # Spark History',
              '      - "127.0.0.1:4040:4040"             # trabajo de Spark activo']
    if c["mongodb"]:
        L.append('      - "127.0.0.1:27017:27017"           # MongoDB')
    if c["jupyter"]:
        L.append('      - "127.0.0.1:8888:8888"             # JupyterLab')
    L += ["    volumes:",
          "      - bigdata_hadoop:/hadoop              # HDFS, metastore, MySQL y MongoDB",
          "      - ./datos:/datos                      # tu carpeta datos/ adentro",
          "    stop_grace_period: 20s", "", "volumes:", "  bigdata_hadoop:", "    name: bigdata_hadoop", ""]
    return "\n".join(L)


class ConfigStore:
    """La última configuración guardada, en el volumen (sobrevive a reinicios
    del contenedor). Si no hay nada guardado, la de las variables de entorno."""

    def __init__(self, path: Path, env: dict[str, str] | None = None):
        self.path = path
        self.env = env

    def load(self) -> dict:
        try:
            return normalize(json.loads(self.path.read_text()))
        except (OSError, ValueError):
            return from_env(self.env)

    def save(self, c: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(c, indent=2))
        tmp.replace(self.path)
