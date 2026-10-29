"""La vista Aula de la versión empresa: el laboratorio visto desde el maestro.

Junta lo que ya sabe cada parte, sin procesos nuevos:
- la inscripción (RED=wireguard, empresa/aula/inscripcion.py): cada PC en
  /hadoop/aula/pcs/<nombre>, con su nombre en Windows, la RAM y los cores que
  tiene Docker, y el código de la clase;
- el NameNode (JMX NameNodeInfo, que el servidor ya lee en cada sondeo): cada
  DataNode con sus bloques, vivo, sin latidos o muerto;
- el ResourceManager (/ws/v1/cluster/nodes): cada NodeManager con la memoria
  y los cores que presta, lo que está usando y su estado;
- el túnel (wg show wg0 dump): el último saludo de cada PC y lo que pasó por ahí.

Cada PC es una lámpara: sumándose (ámbar), arriba (verde), sin respuesta
(ámbar, el NameNode todavía no la dio por muerta) o caída (rojo). Y "ya
pueden apagar" cuando el DataNode del maestro tiene una copia de cada bloque.
"""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import time
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from . import probes
from .errors import ApiError

MB = 1024 * 1024
# Un NodeManager que no está RUNNING (LOST: no contesta; UNHEALTHY: disco lleno...)
NM_CAIDO = {"LOST", "UNHEALTHY", "SHUTDOWN", "DECOMMISSIONED", "REBOOTED"}
TUNEL_VIEJO_S = 180   # con persistent-keepalive 25, WireGuard saluda cada 2 min
_NODO_RE = re.compile(r"^pc0*(\d+)$")


def modo(env: dict[str, str] | None = None) -> dict | None:
    """{"rol": "maestro", "red": "docker" | "wireguard"} si este contenedor es el
    maestro del aula; None en cualquier otro caso (ROL=solo: la full de siempre)."""
    env = os.environ if env is None else env
    if (env.get("ROL") or "solo").strip().lower() != "maestro":
        return None
    red = (env.get("RED") or "docker").strip().lower()
    return {"rol": "maestro", "red": "wireguard" if red == "wireguard" else "docker"}


def _kv(texto: str) -> dict[str, str]:
    d = {}
    for linea in texto.splitlines():
        k, sep, v = linea.partition("=")
        if sep:
            d[k.strip()] = v.strip()
    return d


def _entero(v: object) -> int | None:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def leer_pcs(aula_dir: Path) -> list[dict]:
    """Las PCs inscriptas (lo que escribió inscripcion.py), en orden de número."""
    out = []
    for f in sorted((aula_dir / "pcs").glob("*")):
        if f.suffix == ".tmp" or not f.is_file():
            continue
        try:
            out.append(_kv(f.read_text(encoding="utf-8", errors="replace")))
        except OSError:
            continue
    return sorted(out, key=lambda p: _entero(p.get("numero")) or 0)


def leer_hub(aula_dir: Path) -> dict:
    def leer(nombre: str) -> str | None:
        try:
            return (aula_dir / nombre).read_text().strip() or None
        except OSError:
            return None
    return {"codigo": leer("codigo"), "modo": leer("modo"), "pub": leer("pub")}


def leer_eventos(aula_dir: Path, cuantos: int = 40) -> list[str]:
    try:
        lineas = (aula_dir / "eventos.log").read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return [l for l in lineas if l.strip()][-cuantos:]


def wg_dump(texto: str) -> dict[str, dict]:
    """La salida de 'wg show wg0 dump' -> {clave pública: {saludo, rx, tx}}.
    Primera línea: la interfaz; después una por peer, separada por tabs:
    clave, preshared, endpoint, allowed-ips, último saludo (epoch s), rx, tx, keepalive."""
    out: dict[str, dict] = {}
    for linea in texto.splitlines()[1:]:
        c = linea.split("\t")
        if len(c) < 7:
            continue
        out[c[0]] = {"saludo": _entero(c[4]) or 0, "rx": _entero(c[5]) or 0, "tx": _entero(c[6]) or 0,
                     "endpoint": c[2] if c[2] != "(none)" else None}
    return out


def datanodes(jmx: dict | None) -> dict[str, dict]:
    """{host: {estado, bloques, usadoMb, ultimoS}} según NameNodeInfo (LiveNodes y
    DeadNodes). Las claves son "host:puerto": pc03:9866, maestro:9866."""
    info = probes.jmx_beans(jmx or {}).get("Hadoop:service=NameNode,name=NameNodeInfo", {})
    out: dict[str, dict] = {}
    for tipo in ("LiveNodes", "DeadNodes"):
        for nombre, n in probes._json_field(info.get(tipo)).items():  # noqa: SLF001 (mismo paquete)
            host = nombre.rsplit(":", 1)[0].split(".")[0]
            ultimo = float(n.get("lastContact", 0) or 0)
            if tipo == "DeadNodes":
                estado = "muerto"
            elif ultimo > 9:          # 3 latidos (dfs.heartbeat.interval 3)
                estado = "sin-latidos"
            else:
                estado = "vivo"
            out[host] = {"estado": estado, "bloques": int(n.get("numBlocks", 0) or 0),
                         "usadoMb": round(float(n.get("usedSpace", 0) or 0) / MB, 1),
                         "ultimoS": round(ultimo), "ip": (n.get("xferaddr") or "").rsplit(":", 1)[0] or None}
    return out


def nodemanagers(doc: dict | None) -> dict[str, dict]:
    """{host: {estado, mb, mbUsados, vcores, vcoresUsados, contenedores}} de
    /ws/v1/cluster/nodes (el ResourceManager)."""
    out: dict[str, dict] = {}
    for n in ((doc or {}).get("nodes") or {}).get("node") or []:
        host = (n.get("nodeHostName") or n.get("id", "").rsplit(":", 1)[0]).split(".")[0]
        usado_mb = int(n.get("usedMemoryMB", 0) or 0)
        usado_vc = int(n.get("usedVirtualCores", 0) or 0)
        total = n.get("totalResource") or {}
        mb = int(total.get("memory") or usado_mb + int(n.get("availMemoryMB", 0) or 0))
        vc = int(total.get("vCores") or usado_vc + int(n.get("availableVirtualCores", 0) or 0))
        out[host] = {"estado": n.get("state", "?"), "mb": mb, "mbUsados": usado_mb, "vcores": vc,
                     "vcoresUsados": usado_vc, "contenedores": int(n.get("numContainers", 0) or 0)}
    return out


def _fila(numero: int | None, por_fila: int) -> str | None:
    if not numero:
        return None
    return f"/fila{(numero - 1) // max(1, por_fila) + 1}"


def armar(m: dict, hub: dict, pcs: list[dict], jmx: dict | None, rm: dict | None, wg: dict[str, dict],
          ahora_s: float, eventos: list[str], env: dict[str, str], con_yarn: bool = True) -> dict:
    """El estado del aula (AulaStatus de ui/src/api/types.ts). Función pura:
    todo lo que mira llega por parámetro."""
    dns, nms = datanodes(jmx), nodemanagers(rm)
    # Las de fábrica de sandbox/lib.sh si no vinieron en el docker run
    por_fila = _entero(env.get("PCS_POR_FILA")) or 5
    tunel = m["red"] == "wireguard"
    replicacion = _entero(env.get("REPLICATION")) or (2 if tunel else 3)
    inscriptas = {p.get("nodo"): p for p in pcs if p.get("nodo")}
    nombres = set(inscriptas) | {h for h in dns if h != "maestro"} | {h for h in nms if h != "maestro"}

    def numero(nodo: str) -> int | None:
        m_ = _NODO_RE.match(nodo)
        return int(m_.group(1)) if m_ else None

    out_pcs = []
    for nodo in sorted(nombres, key=lambda n: (numero(n) is None, numero(n) or 0, n)):
        p, dn, nm = inscriptas.get(nodo, {}), dns.get(nodo), nms.get(nodo)
        t = wg.get(p.get("pub", "")) if p else None
        saludo_hace = round(ahora_s - t["saludo"]) if t and t["saludo"] else None
        # El estado de la lámpara, de lo más grave a lo más sano
        motivo = None
        if dn and dn["estado"] == "muerto":
            estado, motivo = "caida", "el NameNode la dio por muerta"
        elif nm and nm["estado"] in NM_CAIDO:
            estado, motivo = "caida", f"YARN la ve {nm['estado']}"
        elif dn and dn["estado"] == "sin-latidos":
            estado = "sin-respuesta"
            motivo = f"sin latidos hace {dn['ultimoS']} s: a los 40 s el NameNode la da por muerta"
        elif dn and dn["estado"] == "vivo" and (not con_yarn or (nm and nm["estado"] == "RUNNING")):
            estado = "arriba"
        else:
            estado = "sumandose"
            if not dn:
                motivo = "esperando su DataNode"
            elif con_yarn and not nm:
                motivo = "esperando su NodeManager"
        if tunel and p and estado in ("sumandose", "arriba"):
            if not p.get("pub"):
                motivo = "reservó su número: falta que arranque su contenedor"
            elif saludo_hace is None and estado == "sumandose":
                motivo = "inscripta, el túnel todavía no saludó"
            elif saludo_hace is not None and saludo_hace > TUNEL_VIEJO_S:
                estado, motivo = "sin-respuesta", f"el túnel no saluda hace {saludo_hace // 60} min"
        n = numero(nodo)
        pc = {"nodo": nodo, "numero": n, "estado": estado, "fila": _fila(n, por_fila)}
        if motivo:
            pc["motivo"] = motivo
        if p:
            pc.update({"nombre": p.get("nombre"), "ipTunel": p.get("ip"), "cpu": p.get("cpu") or None,
                       "dockerRamMb": _entero(p.get("ram_mb")), "cores": _entero(p.get("cores")),
                       "ramPcGb": _entero(p.get("ram_pc_gb")), "inscriptaEn": (_entero(p.get("inscripta")) or 0) * 1000})
        elif dn and dn.get("ip"):
            pc["ipTunel"] = dn["ip"]
        if dn:
            pc["datanode"] = {"estado": dn["estado"], "bloques": dn["bloques"], "usadoMb": dn["usadoMb"],
                              "ultimoS": dn["ultimoS"]}
        if nm:
            pc["nodemanager"] = {k: nm[k] for k in ("estado", "mb", "mbUsados", "vcores", "vcoresUsados", "contenedores")}
        elif p:
            pc["prestaMb"] = _entero(p.get("yarn_mb"))
            pc["prestaVcores"] = _entero(p.get("vcores"))
        if t:
            pc["tunel"] = {"saludoHaceS": saludo_hace, "rxMb": round(t["rx"] / MB, 1), "txMb": round(t["tx"] / MB, 1)}
        out_pcs.append(pc)

    beans = probes.jmx_beans(jmx or {})
    fsn = beans.get("Hadoop:service=NameNode,name=FSNamesystem", {})
    total = _entero(fsn.get("BlocksTotal")) or 0
    perdidos = _entero(fsn.get("MissingBlocks")) or 0
    sub = _entero(fsn.get("UnderReplicatedBlocks")) or 0
    maestro_dn = dns.get("maestro")
    en_maestro = maestro_dn["bloques"] if maestro_dn and maestro_dn["estado"] != "muerto" else 0
    corriendo = [x for x in nms.values() if x["estado"] == "RUNNING"]
    listo = jmx is not None and perdidos == 0 and en_maestro >= total
    if jmx is None:
        porque = "HDFS no responde"
    elif perdidos:
        porque = f"faltan {perdidos} bloques: hay que esperar a que vuelvan las PCs que los tienen"
    elif not listo:
        porque = f"el maestro tiene {en_maestro} de {total} bloques: HDFS está copiando lo que falta"
    else:
        porque = "el maestro tiene una copia de cada bloque: se puede apagar el aula sin perder nada"
    # La línea para Veyon > Ejecutar programa: Veyon deja los archivos en la
    # misma carpeta de donde se mandan (empresa-profe.cmd pasa cuál es)
    linea = env.get("LINEA_VEYON") or None
    if not linea and env.get("CARPETA_VEYON") and env.get("IP_AULA") and hub.get("codigo"):
        carpeta = env["CARPETA_VEYON"].rstrip("\\")
        linea = f'cmd /c ""{carpeta}\\empresa-alumno.cmd" {env["IP_AULA"]} {hub["codigo"]}"'
    return {
        "red": m["red"],
        "codigo": hub.get("codigo"),
        "ipAula": env.get("IP_AULA") or None,
        "lineaVeyon": linea,
        "tunel": hub.get("modo"),
        "mtu": (_entero(env.get("WG_MTU")) or 1380) if tunel else None,
        "replicacion": replicacion,
        "maestro": {"estado": maestro_dn["estado"] if maestro_dn else "no", "bloques": en_maestro,
                    "usadoMb": maestro_dn["usadoMb"] if maestro_dn else 0},
        "hdfs": {"disponible": jmx is not None, "bloques": total, "subReplicados": sub, "perdidos": perdidos},
        "yarn": {"mb": sum(x["mb"] for x in corriendo), "mbUsados": sum(x["mbUsados"] for x in corriendo),
                 "vcores": sum(x["vcores"] for x in corriendo),
                 "vcoresUsados": sum(x["vcoresUsados"] for x in corriendo),
                 "contenedores": sum(x["contenedores"] for x in corriendo)},
        "pcs": out_pcs,
        "resumen": {e: sum(1 for x in out_pcs if x["estado"] == e) for e in ("sumandose", "arriba", "sin-respuesta", "caida")},
        "apagar": {"listo": listo, "bloquesEnMaestro": en_maestro, "bloques": total, "porque": porque},
        "eventos": eventos,
        "ahora": int(ahora_s * 1000),
    }


class Aula:
    """GET /api/aula: el estado del aula, solo en el maestro (ROL=maestro)."""

    def __init__(self, cluster, env: dict[str, str] | None = None) -> None:
        self.c = cluster
        self.env = dict(os.environ if env is None else env)
        self.modo = modo(self.env)
        self.dir = Path(self.env.get("AULA_DIR", str(cluster.s.hadoop_dir / "aula")))
        self._rm: tuple[float, dict | None] = (0.0, None)

    def _rm_nodes(self) -> dict | None:
        t, doc = self._rm
        if time.monotonic() - t > 1.5:
            doc = probes.get_json("http://localhost:8088/ws/v1/cluster/nodes") if self.c.s.probe else None
            self._rm = (time.monotonic(), doc)
        return doc

    def _wg(self) -> dict[str, dict]:
        if self.modo is None or self.modo["red"] != "wireguard" or not self.c.s.probe:
            return {}
        try:
            r = subprocess.run(["wg", "show", "wg0", "dump"], capture_output=True, text=True, timeout=3)
        except (OSError, subprocess.SubprocessError):
            return {}
        return wg_dump(r.stdout) if r.returncode == 0 else {}

    async def estado(self) -> dict:
        if self.modo is None:
            raise ApiError("La vista Aula es del maestro (ROL=maestro de la versión empresa)", "unsupported")
        pcs = await asyncio.to_thread(leer_pcs, self.dir)
        rm = await asyncio.to_thread(self._rm_nodes)
        wg = await asyncio.to_thread(self._wg)
        eventos = await asyncio.to_thread(leer_eventos, self.dir)
        con_yarn = self.c.config.get("services", "todo") != "hdfs"
        jmx = self.c.nn_jmx if self.c.phase in ("starting", "running") else None
        return armar(self.modo, leer_hub(self.dir), pcs, jmx, rm, wg, time.time(), eventos, self.env, con_yarn)

    def routes(self) -> list[Route]:
        async def get(_: Request) -> JSONResponse:
            return JSONResponse(await self.estado())
        return [Route("/api/aula", get)]
