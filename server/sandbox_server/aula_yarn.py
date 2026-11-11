"""YARN en vivo en el aula (versión empresa, en el maestro).

Colas por grupo: el CapacityScheduler del maestro con una cola por grupo de alumnos (más `default`). Cada grupo
tiene su parte garantizada y puede usar lo que los demás dejan libre (maximum-capacity 100): con dos trabajos en
grupos distintos se ve cómo YARN reparte los contenedores. Los grupos se arman desde la vista Aula: se reescribe
capacity-scheduler.xml y `yarn rmadmin -refreshQueues` (sin reiniciar el ResourceManager). Una cola que se saca
queda STOPPED con capacidad 0: YARN no borra en caliente una cola que no estaba parada.

    GET  /api/aula/colas                  las colas con su parte y lo que usan (también vienen en GET /api/aula)
    PUT  /api/aula/colas                  {grupos: ["grupo1", ...]} → reescribe las colas y las recarga
    POST /api/aula/colas/{cola}/trabajo   {trabajo: "mr-pi" | "spark-pi"} → un trabajo de muestra en esa cola

Localidad: en qué PCs estaba el bloque de cada tarea y en cuál corrió (data-local, rack-local, off-rack).

    GET  /api/aula/localidad/{app}        las tareas de un trabajo de MapReduce o Spark con su localidad

Escala: el botón «medir» corre el mismo trabajo y anota cuánto tardó y con cuántas PCs (/hadoop/aula/escala.json).

    GET    /api/aula/escala               {corriendo, medidas, curva, ahora}
    POST   /api/aula/escala               {trabajo: "mr-pi" | "spark-pi" | "mr-wordcount", entrada?, cola?}
    DELETE /api/aula/escala[/{id}]        borra una medida (o todas)
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import time
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .errors import ApiError
from .hdfs import _json as leer_json_pedido

GRUPO_RE = re.compile(r"^[a-z0-9][a-z0-9_]{0,19}$")
GRUPOS_MAX = 8
_RESERVADAS = {"default", "root"}
_P = "yarn.scheduler.capacity.root."


def _num(v: object, d: float = 0.0) -> float:
    try:
        return round(float(v), 1)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return d


def colas(sched: dict | None) -> list[dict]:
    """Las colas hoja de /ws/v1/cluster/scheduler: su parte (% del aula), hasta dónde puede crecer y lo que usa."""
    info = (((sched or {}).get("scheduler") or {}).get("schedulerInfo")) or {}
    out: list[dict] = []

    def recorrer(qs: list[dict]) -> None:
        for q in qs:
            hijas = ((q.get("queues") or {}).get("queue")) or []
            if hijas:
                recorrer(hijas)
                continue
            usado = q.get("resourcesUsed") or {}
            out.append({"nombre": q.get("queueName", "default"), "estado": q.get("state", "RUNNING"),
                        "capacidad": _num(q.get("absoluteCapacity", q.get("capacity"))),
                        "maxima": _num(q.get("absoluteMaxCapacity", q.get("maxCapacity")), 100.0),
                        "usada": _num(q.get("absoluteUsedCapacity", q.get("usedCapacity"))),
                        "mb": int(usado.get("memory") or 0), "vcores": int(usado.get("vCores") or 0),
                        "apps": int(q.get("numActiveApplications") or 0),
                        "pendientes": int(q.get("numPendingApplications") or 0),
                        "contenedores": int(q.get("numContainers") or 0)})

    recorrer(((info.get("queues") or {}).get("queue")) or [])
    return out


def validar_grupos(b: object) -> list[str]:
    g = b.get("grupos") if isinstance(b, dict) else None
    if not isinstance(g, list):
        raise ApiError("Mandá {grupos: [\"grupo1\", ...]}", "invalid")
    if len(g) > GRUPOS_MAX:
        raise ApiError(f"Hasta {GRUPOS_MAX} grupos", "invalid")
    out: list[str] = []
    for x in g:
        n = x.strip().lower() if isinstance(x, str) else ""
        if not GRUPO_RE.fullmatch(n) or n in _RESERVADAS:
            raise ApiError(f"{x!r} no sirve de nombre de grupo: letras, números y _ (hasta 20), "
                           "sin default ni root", "invalid")
        if n in out:
            raise ApiError(f"El grupo {n} está dos veces", "invalid")
        out.append(n)
    return out


def escribir_colas(xml: Path, grupos: list[str]) -> dict:
    """Reescribe las colas de capacity-scheduler.xml: default + un grupo cada una, partes iguales (lo que sobra
    de la división, a default). Las que había y no están quedan STOPPED con 0. Lo demás del archivo no se toca."""
    try:
        arbol = ET.parse(xml)
    except (OSError, ET.ParseError) as e:
        raise ApiError(f"No se pudo leer {xml}: {e}", "failed") from e
    raiz = arbol.getroot()
    props = {p.findtext("name"): p for p in raiz.findall("property")}

    def poner(nombre: str, valor: str) -> None:
        p = props.get(nombre)
        if p is None:
            p = ET.SubElement(raiz, "property")
            ET.SubElement(p, "name").text = nombre
            ET.SubElement(p, "value")
            props[nombre] = p
        v = p.find("value")
        if v is None:
            v = ET.SubElement(p, "value")
        v.text = valor

    antes = props.get(_P + "queues")
    habia = [q.strip() for q in ((antes.findtext("value") if antes is not None else "") or "").split(",") if q.strip()]
    parte = 100 // (len(grupos) + 1)
    paradas = [q for q in habia if q not in grupos and q != "default"]
    todas = ["default"] + [q for q in habia if q != "default" and q not in grupos] + grupos
    todas = ["default"] + sorted(set(todas) - {"default"})
    poner(_P + "queues", ",".join(todas))
    for q in todas:
        activa = q == "default" or q in grupos
        cap = (100 - parte * len(grupos)) if q == "default" else (parte if activa else 0)
        poner(f"{_P}{q}.capacity", str(cap))
        poner(f"{_P}{q}.maximum-capacity", "100")
        poner(f"{_P}{q}.state", "RUNNING" if activa else "STOPPED")
        # Todos los trabajos del aula los manda root: con 1 (de fábrica) un usuario no pasa la parte de su cola
        poner(f"{_P}{q}.user-limit-factor", "100")
        # Dos trabajos por grupo a la vez (con 0.1 de fábrica, en una cola chica entra un ApplicationMaster)
        poner(f"{_P}{q}.maximum-am-resource-percent", "0.5")
    tmp = xml.with_suffix(".tmp")
    arbol.write(tmp, encoding="unicode", xml_declaration=True)
    tmp.replace(xml)
    return {"grupos": grupos, "paradas": sorted(paradas)}


def capacity_xml(env: dict[str, str]) -> Path:
    return Path(env.get("HADOOP_CONF_DIR") or "/opt/hadoop/etc/hadoop") / "capacity-scheduler.xml"


def correr(argv: list[str], timeout: float = 60) -> tuple[int, str]:
    """Corre un comando y devuelve (código, salida+errores). Se reemplaza en los tests."""
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=os.environ.copy())
    except (OSError, subprocess.SubprocessError) as e:
        return 127, str(e)
    return r.returncode, (r.stdout + r.stderr).strip()


# ------------------------------------------------------------------ localidad
#
# Al pasar el mouse por una tarea: en qué PCs estaba su bloque y en cuál corrió. MapReduce lo anota en el
# historial del trabajo (.jhist): TASK_STARTED trae splitLocations (las PCs con el bloque) y cada intento la PC
# donde corrió (y la localidad que le dio YARN). Spark solo publica la localidad que logró y el host
# (/api/v1/.../taskList): no dice dónde estaba el bloque.

LOCALIDAD_SPARK = {"PROCESS_LOCAL": "data-local", "NODE_LOCAL": "data-local", "RACK_LOCAL": "rack-local",
                   "ANY": "off-rack"}
ESTADO_INTENTO = {"SUCCEEDED": "ok", "FAILED": "fallo", "KILLED": "muerta"}
ESTADO_SPARK = {"SUCCESS": "ok", "RUNNING": "corriendo", "FAILED": "fallo", "KILLED": "muerta"}


def _avro(v: object) -> object:
    """Las uniones de Avro-JSON vienen como {"string": "NODE_LOCAL"}."""
    if isinstance(v, dict) and len(v) == 1:
        k = next(iter(v))
        if k in ("string", "int", "long", "boolean"):
            return v[k]
    return v


def parse_jhist(texto: str) -> dict[str, dict]:
    """tarea → {tipo, bloque, intentos: {intento: {host, estado, yarn}}} de un .jhist en Avro-JSON."""
    tareas: dict[str, dict] = {}
    for linea in texto.splitlines():
        if not linea.startswith('{"type"'):
            continue
        try:
            doc = json.loads(linea)
            ev = next(iter((doc.get("event") or {}).values()))
        except (ValueError, StopIteration, AttributeError):
            continue          # el staging de un trabajo que corre puede tener una línea a medio escribir
        if not isinstance(ev, dict) or not isinstance(ev.get("taskid"), str):
            continue
        tipo = doc.get("type", "")
        t = tareas.setdefault(ev["taskid"], {"tipo": str(_avro(ev.get("taskType")) or ""), "bloque": None,
                                             "intentos": {}})
        if tipo == "TASK_STARTED":
            splits = [nodo_de(h) for h in str(_avro(ev.get("splitLocations")) or "").split(",") if h.strip()]
            t["bloque"] = list(dict.fromkeys(splits)) or None
            continue
        aid = _avro(ev.get("attemptId"))
        if not isinstance(aid, str):
            continue
        i = t["intentos"].setdefault(aid, {"host": None, "estado": "corriendo", "yarn": None})
        if tipo.endswith("_ATTEMPT_STARTED"):
            i["host"] = i["host"] or nodo_de(_avro(ev.get("trackerName")))
            i["yarn"] = _avro(ev.get("locality"))
        elif tipo.endswith("_ATTEMPT_FINISHED"):
            i["host"] = nodo_de(_avro(ev.get("hostname"))) or i["host"]
            i["estado"] = "ok"
        elif tipo.endswith(("_ATTEMPT_FAILED", "_ATTEMPT_KILLED")):
            i["host"] = nodo_de(_avro(ev.get("hostname"))) or i["host"]
            i["estado"] = ESTADO_INTENTO.get(str(_avro(ev.get("status"))), "fallo")
    return {k: v for k, v in tareas.items() if v["tipo"] in ("MAP", "REDUCE")}


_IP_RE = re.compile(r"^\d+\.\d+\.\d+\.(\d+)$")


def nodo_de(h: str | None, tunel: str = "10.13.0") -> str | None:
    """El nombre en el aula (pcNN, maestro) de lo que anota Hadoop: pc03.aula (el DNS de Docker suma el dominio),
    la IP del túnel (10.13.0.13 = pc03, .1 = maestro) o /rack/pc03. Lo que no es del aula queda como vino."""
    if not h:
        return None
    h = h.strip().rsplit("/", 1)[-1]
    m = _IP_RE.match(h)
    if m:
        if not h.startswith(tunel + "."):
            return h
        n = int(m.group(1))
        return "maestro" if n == 1 else f"pc{n - 10:02d}" if 10 < n < 110 else h
    return h.split(".", 1)[0]


def clasificar(bloque: list[str] | None, host: str | None, rack) -> str | None:
    """data-local (corrió en una PC con el bloque), rack-local (en su fila) u off-rack (en otra fila)."""
    if not bloque or not host:
        return None
    if host in bloque:
        return "data-local"
    mio = rack(host)
    suyos = {rack(b) for b in bloque} - {None}
    if not mio or not suyos:
        return None
    return "rack-local" if mio in suyos else "off-rack"


def _corto(tid: str) -> str:
    partes = tid.split("_")
    return "_".join(partes[-2:]) if len(partes) >= 2 else tid


def localidad_mr(tareas: dict[str, dict], rack) -> list[dict]:
    out = []
    for tid, t in tareas.items():
        intentos = list(t["intentos"].values())
        bueno = next((i for i in intentos if i["estado"] == "ok"), None)
        ultimo = bueno or (intentos[-1] if intentos else None)
        host = ultimo["host"] if ultimo else None
        out.append({"id": _corto(tid), "tipo": "map" if t["tipo"] == "MAP" else "reduce",
                    "bloque": t["bloque"] if t["tipo"] == "MAP" else None, "corrio": host,
                    "rack": rack(host) if host else None,
                    "localidad": clasificar(t["bloque"], host, rack) if t["tipo"] == "MAP" else None,
                    "yarn": ultimo["yarn"] if ultimo else None,
                    "estado": ultimo["estado"] if ultimo else "esperando", "intentos": len(intentos),
                    "fallidos": [i["host"] for i in intentos if i["estado"] in ("fallo", "muerta") and i["host"]]})
    out.sort(key=lambda x: x["id"])
    return out


def localidad_spark(etapas: dict[int, list[dict]], rack) -> list[dict]:
    out = []
    for sid in sorted(etapas):
        for t in sorted(etapas[sid], key=lambda x: (x.get("index", 0), x.get("taskId", 0))):
            host = nodo_de(t.get("host"))
            out.append({"id": f"s{sid}.{t.get('index', t.get('taskId', 0))}", "tipo": "spark", "bloque": None,
                        "corrio": host, "rack": rack(host) if host else None,
                        "localidad": LOCALIDAD_SPARK.get(t.get("taskLocality", "")),
                        "yarn": t.get("taskLocality"), "estado": ESTADO_SPARK.get(t.get("status", ""), "corriendo"),
                        "intentos": int(t.get("attempt", 0) or 0) + 1, "fallidos": []})
    return out


def resumen(tareas: list[dict]) -> dict[str, int]:
    return {k: sum(1 for t in tareas if t["localidad"] == k) for k in ("data-local", "rack-local", "off-rack")}


# ------------------------------------------------------------------ escala
#
# El botón «medir»: corre el mismo trabajo y anota cuánto tardó (el elapsedTime del ResourceManager) y cuántas
# PCs prestaban en ese momento. Con 1, 5, 10 y 20 PCs sale la curva: tiempo y aceleración (lo que tardó con la
# menor cantidad de PCs medida, dividido lo que tardó ahora).

ESCALA_MAX = 100
PRESETS = {
    "mr-pi": {"maps": 16, "samples": 10000},
    "spark-pi": {"partitions": 16},
    "mr-wordcount": {"out": "/user/root/resultados/escala-wordcount", "overwrite": True},
}


def validar_medicion(b: object) -> tuple[str, dict, str | None]:
    from . import yarn as yarn_mod
    if not isinstance(b, dict) or b.get("trabajo") not in PRESETS:
        raise ApiError(f"El trabajo a medir es uno de: {', '.join(PRESETS)}", "invalid")
    tid = str(b["trabajo"])
    cola = b.get("cola") or None
    if cola is not None and (not isinstance(cola, str) or not (GRUPO_RE.fullmatch(cola) or cola == "default")):
        raise ApiError("La cola es default o el nombre de un grupo", "invalid")
    params = dict(PRESETS[tid])
    if tid == "mr-wordcount":
        entrada = b.get("entrada", yarn_mod.TEXTO)
        if not isinstance(entrada, str):
            raise ApiError("La entrada es una ruta de HDFS", "invalid")
        params["in"] = entrada
    return tid, yarn_mod.validate_params(yarn_mod.TEMPLATE[tid], params), cola


def prestan(rm_nodes: dict | None) -> dict:
    """Las PCs que prestan memoria y cores a YARN (NodeManagers RUNNING, sin el del maestro)."""
    ns = [n for n in (((rm_nodes or {}).get("nodes") or {}).get("node") or [])
          if n.get("state") == "RUNNING" and n.get("nodeHostName") != "maestro"]
    tot = lambda k: sum(int((n.get("totalResource") or {}).get(k) or 0) for n in ns)  # noqa: E731
    return {"pcs": len(ns), "nodos": sorted(n.get("nodeHostName", "") for n in ns), "mb": tot("memory"),
            "vcores": tot("vCores")}


def curva(medidas: list[dict]) -> list[dict]:
    grupos: dict[tuple, dict[int, list[float]]] = {}
    for m in medidas:
        if m.get("estado") != "ok" or not m.get("segundos") or not m.get("pcs"):
            continue
        clave = (m["trabajo"], m.get("entrada"))
        grupos.setdefault(clave, {}).setdefault(int(m["pcs"]), []).append(float(m["segundos"]))
    out = []
    for (trabajo, entrada), por_pcs in grupos.items():
        puntos = [{"pcs": n, "segundos": round(sum(s) / len(s), 1), "medidas": len(s)} for n, s in sorted(por_pcs.items())]
        base = puntos[0]["segundos"]
        for p in puntos:
            p["aceleracion"] = round(base / p["segundos"], 2)
        out.append({"trabajo": trabajo, "entrada": entrada, "puntos": puntos})
    return out


# ------------------------------------------------------------------ las rutas

class YarnEnAula:
    """Colas, localidad y escala de la vista Aula. Lee YARN con el mismo cliente REST que la vista YARN
    (yarn.Yarn.get, que los tests reemplazan) y manda los trabajos con sus plantillas."""

    PASO_S = 2.0

    def __init__(self, aula, yarn) -> None:
        self.a = aula
        self.y = yarn
        self.correr = correr
        self.corriendo: dict | None = None
        self._medidas: list[dict] | None = None
        self._tarea: asyncio.Task | None = None

    # ---------------------------------------------------------- colas

    async def colas(self) -> list[dict]:
        from .yarn import RM
        doc = await self.y.get(f"{RM}/ws/v1/cluster/scheduler")
        if doc is None:
            raise ApiError("El ResourceManager no responde", "service_down")
        return colas(doc)

    async def armar_grupos(self, b: object) -> dict:
        grupos = validar_grupos(b)
        xml = capacity_xml(self.a.env)
        try:
            antes = await asyncio.to_thread(xml.read_text, encoding="utf-8")
        except OSError as e:
            raise ApiError(f"No está {xml}: ¿es el maestro del aula?", "failed") from e
        r = await asyncio.to_thread(escribir_colas, xml, grupos)
        rc, out = await asyncio.to_thread(self.correr, ["yarn", "rmadmin", "-refreshQueues"])
        if rc != 0:
            await asyncio.to_thread(xml.write_text, antes, encoding="utf-8")
            ultima = next((l for l in reversed(out.splitlines()) if l.strip()), f"salió con {rc}")
            raise ApiError(f"YARN no aceptó las colas (quedaron como estaban): {ultima}", "failed")
        self.a.anotar("colas de YARN: default" + "".join(f", {g}" for g in grupos))
        try:
            r["colas"] = await self.colas()
        except ApiError:
            r["colas"] = []
        return r

    async def trabajo_en_cola(self, cola: str, b: object) -> dict:
        if not (GRUPO_RE.fullmatch(cola) or cola == "default"):
            raise ApiError(f"No hay una cola {cola}", "not_found")
        trabajo = b.get("trabajo") if isinstance(b, dict) else None
        params = {"mr-pi": {"maps": 8, "samples": 10000}, "spark-pi": {"partitions": 8}}.get(str(trabajo))
        if params is None:
            raise ApiError("El trabajo de muestra es mr-pi o spark-pi", "invalid")
        return {"id": await self.y.submit_template(trabajo, params, queue=cola), "cola": cola}

    # ---------------------------------------------------------- localidad

    def _webhdfs(self, ruta: str, op: str) -> str:
        puerto = getattr(self.a.c, "nn_active_port", None) or 9870
        return f"http://localhost:{puerto}/webhdfs/v1{urllib.parse.quote(ruta)}?op={op}&user.name=root"

    async def _ls(self, carpeta: str) -> list[str]:
        doc = await self.y.get(self._webhdfs(carpeta, "LISTSTATUS"))
        return [f.get("pathSuffix", "") for f in ((doc or {}).get("FileStatuses") or {}).get("FileStatus") or []]

    async def _jhist(self, jid: str, corriendo: bool, user: str) -> tuple[str | None, str]:
        """El .jhist del trabajo: en staging mientras corre, en el historial (/mr-history/done) cuando terminó."""
        from .yarn import JHS
        if corriendo:
            carpeta = f"/tmp/hadoop-yarn/staging/{user}/.staging/{jid}"
            nombres = sorted((n for n in await self._ls(carpeta) if re.fullmatch(rf"{jid}_\d+\.jhist", n)),
                             key=lambda n: int(n.rsplit("_", 1)[1].split(".")[0]))
            fuente = "en curso"
        else:
            conf = await self.y.get(f"{JHS}/ws/v1/history/mapreduce/jobs/{jid}/conf")
            ruta = urllib.parse.urlparse(((conf or {}).get("conf") or {}).get("path") or "").path
            carpeta = ruta.rsplit("/", 1)[0] if ruta else ""
            nombres = [n for n in (await self._ls(carpeta) if carpeta else []) if n.startswith(jid) and n.endswith(".jhist")]
            fuente = "historial"
        if not nombres:
            return None, fuente
        texto = await self.y.text(self._webhdfs(f"{carpeta}/{nombres[-1]}", "OPEN"), 10.0)
        return texto, fuente

    async def _spark(self, app: str, corriendo: bool) -> dict[int, list[dict]]:
        from .yarn import DRIVER, RM, SHS
        bases = [f"{DRIVER}/api/v1/applications/{app}", f"{RM}/proxy/{app}/api/v1/applications/{app}"] if corriendo \
            else [f"{SHS}/api/v1/applications/{app}"]
        for base in bases:
            etapas = await self.y.get(f"{base}/stages")
            if etapas is None:
                continue
            mejor: dict[int, int] = {}
            for s in etapas:
                if isinstance(s, dict) and s.get("status") != "SKIPPED":
                    sid = int(s.get("stageId", 0))
                    mejor[sid] = max(mejor.get(sid, -1), int(s.get("attemptId", 0)))
            out: dict[int, list[dict]] = {}
            for sid, intento in sorted(mejor.items())[:20]:
                ts = await self.y.get(f"{base}/stages/{sid}/{intento}/taskList?length=1000")
                out[sid] = [t for t in ts or [] if isinstance(t, dict)]
            return out
        return {}

    async def localidad(self, app_id: str) -> dict:
        from . import yarn as yarn_mod
        a = await self.y.rm_app(app_id)
        tipo = str(a.get("applicationType", "")).upper()
        estado = yarn_mod.app_state(a)
        corriendo = estado in ("RUNNING", "ACCEPTED")
        rack = self.a.rack_de()
        base = {"app": app_id, "tipo": tipo, "estado": estado, "nombre": a.get("name"), "cola": a.get("queue")}
        if tipo == "MAPREDUCE":
            texto, fuente = await self._jhist(yarn_mod.job_id(app_id), corriendo, a.get("user") or "root")
            if texto is None:
                motivo = ("el ApplicationMaster todavía no escribió su historial" if corriendo
                          else "no se encontró su historial (¿está prendido el JobHistory?)")
                return {**base, "soportado": True, "fuente": fuente, "tareas": [], "resumen": resumen([]),
                        "motivo": motivo}
            if texto.startswith("Avro-Binary"):  # lo de fábrica en Hadoop 3; el aula pide json (conf_aula)
                return {**base, "soportado": True, "fuente": fuente, "tareas": [], "resumen": resumen([]),
                        "motivo": "su historial está en binario: falta mapreduce.jobhistory.jhist.format=json"}
            tareas = localidad_mr(parse_jhist(texto), rack)
        elif tipo == "SPARK":
            fuente = "en curso" if corriendo else "historial"
            tareas = localidad_spark(await self._spark(app_id, corriendo), rack)
        else:
            return {**base, "soportado": False, "fuente": None, "tareas": [], "resumen": resumen([]),
                    "motivo": f"la localidad por tarea se lee de MapReduce y de Spark; {tipo or 'este trabajo'} no"}
        r = {**base, "soportado": True, "fuente": fuente, "tareas": tareas, "resumen": resumen(tareas)}
        if tipo == "SPARK":
            r["motivo"] = "Spark dice en qué PC corrió cada tarea y qué localidad logró, no dónde estaba el bloque"
        return r

    # ---------------------------------------------------------- escala

    def _archivo(self) -> Path:
        return self.a.dir / "escala.json"

    def medidas(self) -> list[dict]:
        if self._medidas is None:
            try:
                doc = json.loads(self._archivo().read_text(encoding="utf-8"))
                self._medidas = [m for m in doc if isinstance(m, dict)] if isinstance(doc, list) else []
            except (OSError, ValueError):
                self._medidas = []
        return self._medidas

    def _guardar(self) -> None:
        ms = self.medidas()[-ESCALA_MAX:]
        self._medidas = ms
        self.a.dir.mkdir(parents=True, exist_ok=True)
        tmp = self._archivo().with_suffix(".tmp")
        tmp.write_text(json.dumps(ms, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self._archivo())

    async def _prestan(self) -> dict:
        from .yarn import RM
        return prestan(await self.y.get(f"{RM}/ws/v1/cluster/nodes"))

    async def escala(self) -> dict:
        ms = await asyncio.to_thread(self.medidas)
        return {"corriendo": self.corriendo, "medidas": list(reversed(ms)), "curva": curva(ms),
                "ahora": await self._prestan()}

    async def medir(self, b: object) -> dict:
        tid, params, cola = validar_medicion(b)
        if self.corriendo is not None:
            raise ApiError(f"Ya se está midiendo {self.corriendo['trabajo']}: esperá a que termine", "busy")
        foto = await self._prestan()
        if not foto["pcs"]:
            raise ApiError("Ninguna PC le presta a YARN: no hay dónde correr el trabajo", "service_down")
        m = {"id": f"m{int(time.time() * 1000)}", "trabajo": tid, "entrada": params.get("in"), "cola": cola,
             "params": params, "estado": "corriendo", "inicio": int(time.time() * 1000), "app": None, **foto}
        self.corriendo = m
        try:
            m["app"] = await self.y.submit_template(tid, params, queue=cola)
        except BaseException:
            self.corriendo = None
            raise
        self.a.anotar(f"midiendo {tid} con {foto['pcs']} PCs ({m['app']})")
        self._tarea = asyncio.create_task(self._seguir(m))
        return m

    async def _seguir(self, m: dict) -> None:
        from . import yarn as yarn_mod
        tope = time.monotonic() + 7200
        try:
            while time.monotonic() < tope:
                await asyncio.sleep(self.PASO_S)
                try:
                    a = await self.y.rm_app(m["app"])
                except ApiError:
                    continue
                st = yarn_mod.app_state(a)
                if st in ("FINISHED", "FAILED", "KILLED"):
                    fin = await self._prestan()
                    m.update({"estado": "ok" if st == "FINISHED" else "fallo", "resultado": st,
                              "segundos": round(int(a.get("elapsedTime") or 0) / 1000, 1),
                              "pcsAlFinal": fin["pcs"], "cambiaron": fin["nodos"] != m["nodos"]})
                    break
            else:
                m.update({"estado": "fallo", "resultado": "sin terminar a las 2 h", "segundos": None})
        except asyncio.CancelledError:
            m.update({"estado": "fallo", "resultado": "se cortó la medición", "segundos": None})
            raise
        finally:
            self.corriendo = None
            if m["estado"] == "corriendo":
                m.update({"estado": "fallo", "resultado": "se cortó la medición", "segundos": None})
            self.medidas().append(m)
            await asyncio.to_thread(self._guardar)
            self.a.anotar(f"medido {m['trabajo']} con {m['pcs']} PCs: "
                          + (f"{m['segundos']} s" if m["estado"] == "ok" else m.get("resultado", "falló")))

    async def borrar(self, mid: str | None) -> dict:
        ms = self.medidas()
        if mid is None:
            ms.clear()
        else:
            quedan = [m for m in ms if m.get("id") != mid]
            if len(quedan) == len(ms):
                raise ApiError(f"No hay una medida {mid}", "not_found")
            ms[:] = quedan
        await asyncio.to_thread(self._guardar)
        return await self.escala()

    def routes(self) -> list[Route]:
        async def colas_get(_: Request) -> JSONResponse:
            self.a._maestro()
            return JSONResponse(await self.colas())

        async def colas_put(request: Request) -> JSONResponse:
            self.a._maestro()
            return JSONResponse(await self.armar_grupos(await leer_json_pedido(request)))

        async def cola_trabajo(request: Request) -> JSONResponse:
            self.a._maestro()
            return JSONResponse(await self.trabajo_en_cola(request.path_params["cola"], await leer_json_pedido(request)),
                                status_code=202)

        async def localidad_get(request: Request) -> JSONResponse:
            self.a._maestro()
            return JSONResponse(await self.localidad(request.path_params["app"]))

        async def escala_get(_: Request) -> JSONResponse:
            self.a._maestro()
            return JSONResponse(await self.escala())

        async def escala_post(request: Request) -> JSONResponse:
            self.a._maestro()
            return JSONResponse(await self.medir(await leer_json_pedido(request)), status_code=202)

        async def escala_borrar_todo(_: Request) -> JSONResponse:
            self.a._maestro()
            return JSONResponse(await self.borrar(None))

        async def escala_borrar(request: Request) -> JSONResponse:
            self.a._maestro()
            return JSONResponse(await self.borrar(request.path_params["id"]))

        return [Route("/api/aula/colas", colas_get, methods=["GET"]),
                Route("/api/aula/colas", colas_put, methods=["PUT"]),
                Route("/api/aula/colas/{cola}/trabajo", cola_trabajo, methods=["POST"]),
                Route("/api/aula/localidad/{app}", localidad_get),
                Route("/api/aula/escala", escala_get, methods=["GET"]),
                Route("/api/aula/escala", escala_post, methods=["POST"]),
                Route("/api/aula/escala", escala_borrar_todo, methods=["DELETE"]),
                Route("/api/aula/escala/{id}", escala_borrar, methods=["DELETE"])]
