"""YARN: los trabajos (MapReduce, Tez de Hive, Spark), la memoria del
NodeManager, el detalle con su DAG y los logs (rutas /api/yarn/... de ui/API.md).

De dónde sale cada cosa (todo REST, sin JVM, salvo los logs ya agregados):

- Lista y estado: ResourceManager :8088/ws/v1/cluster/apps.
- Contenedores vivos: NodeManager :8042/ws/v1/node/containers.
- Memoria, vcores y colas: :8088/ws/v1/cluster/{metrics,nodes,scheduler} y
  :8088/conf (mínimo y máximo por contenedor).
- Etapas y contadores de MapReduce: el ApplicationMaster mientras corre
  (:8088/proxy/<app>/ws/v1/mapreduce/jobs/...) y JobHistory cuando terminó
  (:19888/ws/v1/history/mapreduce/jobs/...).
- Etapas de Spark: la interfaz del driver mientras corre (:4040/api/v1/...) y
  Spark History cuando terminó (:18080/api/v1/applications/<app>/stages).
- Tez (Hive): no hay Timeline Server en la imagen, así que el DAG sale de las
  líneas de avance que imprime beeline ("Map 1: 2/2 Reducer 2: 0(+1)/1"). Si
  el trabajo no lo mandó esta interfaz, queda una sola etapa con el avance
  que informa el RM.
- Logs: mientras corre, los archivos del contenedor por el NodeManager
  (:8042/ws/v1/node/containerlogs/<c>/<archivo>); cuando terminó,
  yarn logs -applicationId <app> -containerId <c> (los agregados en HDFS).
- Mandar y cancelar: el comando real por ActionRunner (hadoop jar, beeline,
  spark-submit, yarn application -kill).
"""
from __future__ import annotations

import asyncio
import html
import json
import re
import shlex
import time
import urllib.parse
from datetime import datetime

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import hdfs as hdfs_mod
from .actions import Action, ActionRunner, Run
from .boot import now_ms
from .errors import ApiError
from .events import EventBus

RM = "http://localhost:8088"
NM = "http://localhost:8042"
JHS = "http://localhost:19888"
SHS = "http://localhost:18080"
DRIVER = "http://localhost:4040"
ENGINE = {"MAPREDUCE": "mr", "TEZ": "tez", "SPARK": "spark"}
APP_ID = re.compile(r"application_\d+_\d+")
CONTAINER = re.compile(r"container_(?:e\d+_)?(\d+)_(\d+)_(\d+)_(\d+)")
STREAMING = "$HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-3.3.6.jar"

# Los trabajos de ejemplo (los de datos/ejemplos): qué corre, qué lee, dónde
# deja el resultado y qué hace cada etapa (para el DAG)
JOBS: dict[str, dict] = {
    "mr-ventas": {
        "type": "MAPREDUCE", "proc": ("jh", "JobHistory"),
        "run": f"hadoop jar {STREAMING} -files ejemplos/mapper.py,ejemplos/reducer.py "
               '-mapper "python3 mapper.py" -reducer "python3 reducer.py" '
               "-input /user/root/ventas -output /user/root/resultados/mr_por_producto",
        "shown": "hadoop jar hadoop-streaming-3.3.6.jar -mapper mapper.py -reducer reducer.py "
                 "-input /user/root/ventas -output /user/root/resultados/mr_por_producto",
        "out": "/user/root/resultados/mr_por_producto",
        "action": "YARN la pone en la cola; primero arranca su ApplicationMaster (512 MB) y después un mapper "
                  "por bloque y un reducer",
        "ops": {"map": ["TextInputFormat", "mapper.py", "sort + spill"],
                "reduce": ["merge", "reducer.py", "TextOutputFormat"]},
    },
    "hive-ventas": {
        "type": "TEZ", "proc": ("hiveserver2", "HiveServer2"),
        "run": "beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql",
        "shown": "beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql",
        "out": "/user/root/resultados/hive_por_producto",
        "action": "HiveServer2 compila el SQL a un DAG de Tez; YARN arranca el ApplicationMaster de Tez "
                  "(1024 MB) y cada vértice corre en contenedores",
        "ops": {"Map 1": ["TableScan", "Select Operator", "Group By Operator (parcial)", "Reduce Output Operator"],
                "Reducer 2": ["Group By Operator (final)", "Reduce Output Operator"],
                "Reducer 3": ["Select Operator", "File Output Operator"]},
    },
    "spark-ventas": {
        "type": "SPARK", "proc": ("sparkhistory", "Spark History"),
        "run": "spark-submit ejemplos/ventas.py",
        "shown": "spark-submit ejemplos/ventas.py",
        "out": "/user/root/resultados/spark_por_producto",
        "action": "El driver corre acá (client mode); YARN le da un ApplicationMaster y 2 executors de 512 MB "
                  "(+384 de overhead)",
        "ops": {},
    },
}
VENTAS = "/user/root/ventas"

# beeline imprime el avance de Tez así: "Map 1: 1/2	Reducer 2: 0(+1)/1"
_TEZ_VERTEX = re.compile(r"((?:Map|Reducer) \d+): (-|\d+)(?:\(\+(\d+)\))?(?:\(-(\d+)\))?(?:\(-\d+\))?/(-|\d+)")
# Hive 4.0 (visto en el humo): beeline dibuja una tabla, una fila por vértice y con
# códigos ANSI aunque la salida no sea una terminal:
#   Map 1 .......... container     SUCCEEDED      1          1        0        0       0       0
# (TOTAL COMPLETED RUNNING PENDING FAILED KILLED)
_TEZ_ROW = re.compile(r"^\s*((?:Map|Reducer|Union) \d+)[ .]+?\s(?:container|llap|uber)\s+[A-Z_]+"
                      r"\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s*$")
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def short_container(cid: str) -> str:
    return cid.replace("container_", "")


def app_of_container(cid: str) -> str | None:
    m = CONTAINER.search(cid)
    return f"application_{m.group(1)}_{m.group(2)}" if m else None


def container_kind(cid: str, app_type: str) -> str:
    m = CONTAINER.search(cid)
    if m and int(m.group(4)) == 1:
        return "am"
    return "executor" if app_type == "SPARK" else "task"


def container_label(cid: str, app_type: str) -> str:
    """AM, exec 1, tarea 3 (el número de contenedor menos el del AM)."""
    kind = container_kind(cid, app_type)
    if kind == "am":
        return "AM (driver)" if app_type == "SPARK" else "AM"
    m = CONTAINER.search(cid)
    n = int(m.group(4)) - 1 if m else 0
    return f"exec {n}" if kind == "executor" else f"contenedor {n}"


def job_id(app_id: str) -> str:
    return app_id.replace("application_", "job_", 1)


def app_state(a: dict) -> str:
    """El estado del RM en los cinco que usa la interfaz."""
    st = a.get("state", "")
    if st in ("NEW", "NEW_SAVING", "SUBMITTED", "ACCEPTED"):
        return "ACCEPTED"
    if st == "FINISHED":
        fs = a.get("finalStatus")
        return "FAILED" if fs == "FAILED" else "KILLED" if fs == "KILLED" else "FINISHED"
    return st if st in ("RUNNING", "FAILED", "KILLED") else "ACCEPTED"


def level_of(text: str) -> str:
    t = text.upper()
    if re.search(r"\b(ERROR|FATAL|EXCEPTION)\b", t) or "FAILED" in t and "0 FAILED" not in t:
        return "ERROR"
    return "WARN" if re.search(r"\bWARN(ING)?\b", t) else "INFO"


def parse_tez_progress(lines: list[str]) -> list[dict]:
    """Vértices de Tez del último avance que imprimió beeline: la tabla de Hive 4
    (una fila por vértice) o la línea 'Map 1: 0(+3)/6  Reducer 2: 0/2' de antes."""
    rows: list[dict] = []
    for line in reversed(lines):
        line = _ANSI.sub("", line)
        m = _TEZ_ROW.match(line)
        if m:
            rows.insert(0, {"name": m.group(1), "total": int(m.group(2)), "done": int(m.group(3)),
                            "running": int(m.group(4))})
            continue
        if rows:
            return rows
        found = _TEZ_VERTEX.findall(line)
        if found:
            out = []
            for name, done, running, failed, total in found:
                t = int(total) if total != "-" else 0
                d = int(done) if done != "-" else 0
                out.append({"name": name, "total": t, "done": d, "running": int(running or 0)})
            return out
    return rows


def parse_yarn_logs(text: str) -> dict[str, list[str]]:
    """Salida de yarn logs -containerId ...: un bloque por archivo (LogType:)."""
    files: dict[str, list[str]] = {}
    cur: str | None = None
    body = False
    for line in text.splitlines():
        if line.startswith("LogType:"):
            cur, body = line.split(":", 1)[1].strip(), False
            files.setdefault(cur, [])
            continue
        if cur is None:
            continue
        if line.startswith("LogContents:"):
            body = True
            continue
        if line.startswith("End of LogType:"):
            # yarn logs deja una línea en blanco antes del cierre: no es del archivo
            while files[cur] and not files[cur][-1].strip():
                files[cur].pop()
            cur, body = None, False
            continue
        if body:
            files[cur].append(line)
    return files


def parse_log_containers(text: str) -> list[str]:
    """Contenedores que nombra yarn logs -show_application_log_info."""
    seen: list[str] = []
    for m in re.finditer(r"Container: (container_\S+)", text):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    return seen


def parse_conf(text: str) -> dict[str, str]:
    """Las propiedades de :8088/conf. Pide format=json, pero el RM de Hadoop
    3.3.6 contesta XML igual (visto en el humo): se aceptan los dos."""
    try:
        doc = json.loads(text)
        return {p.get("key"): p.get("value") for p in doc.get("properties", []) if isinstance(p, dict)}
    except (ValueError, AttributeError):
        pass
    return {m.group(1): html.unescape(m.group(2))
            for m in re.finditer(r"<name>([^<]*)</name>\s*<value>([^<]*)</value>", text)}


def iso(t: int) -> str:
    return datetime.fromtimestamp(t / 1000).strftime("%Y-%m-%d %H:%M:%S,%f")[:-3]


class Yarn:
    def __init__(self, cluster, runner: ActionRunner, bus: EventBus):
        self.c = cluster
        self.runner = runner
        self.bus = bus
        self.http = hdfs_mod.http_get     # se reemplaza en los tests
        # Lo que mandó esta interfaz: appId -> {example, run, ...}
        self.submitted: dict[str, dict] = {}
        self._sig: dict[str, str] = {}
        self._logs_cache: dict[tuple[str, str], dict[str, list[str]]] = {}
        self._conf: dict[str, int] | None = None
        cluster.watchers.append(self.watch)

    # ------------------------------------------------------------ REST

    async def get(self, url: str, timeout: float = 4.0) -> dict | None:
        status, body = await asyncio.to_thread(self.http, url, timeout)
        if status != 200:
            return None
        try:
            doc = json.loads(body)
        except ValueError:
            return None
        return doc

    async def text(self, url: str, timeout: float = 4.0) -> str | None:
        status, body = await asyncio.to_thread(self.http, url, timeout)
        return body.decode("utf-8", "replace") if status == 200 else None

    async def rm_apps(self) -> list[dict]:
        doc = await self.get(f"{RM}/ws/v1/cluster/apps")
        if doc is None:
            raise ApiError("El ResourceManager no responde", "service_down")
        return ((doc.get("apps") or {}).get("app")) or []

    async def rm_app(self, app_id: str) -> dict:
        if not APP_ID.fullmatch(app_id):
            raise ApiError(f"No existe el trabajo {app_id}", "not_found")
        status, body = await asyncio.to_thread(self.http, f"{RM}/ws/v1/cluster/apps/{app_id}", 4.0)
        if status == 0:
            raise ApiError("El ResourceManager no responde", "service_down")
        if status != 200:
            raise ApiError(f"No existe el trabajo {app_id}", "not_found")
        try:
            return json.loads(body).get("app") or {}
        except ValueError:
            raise ApiError("El ResourceManager respondió algo que no es JSON", "failed") from None

    async def nm_containers(self) -> list[dict]:
        doc = await self.get(f"{NM}/ws/v1/node/containers", 3.0)
        cs = ((doc or {}).get("containers") or {}).get("container") or []
        return [c for c in cs if c.get("state") in ("NEW", "LOCALIZING", "LOCALIZED", "RUNNING")]

    async def conf(self) -> dict[str, int]:
        """Mínimo y máximo de memoria por contenedor (de :8088/conf)."""
        if self._conf is None:
            props = parse_conf(await self.text(f"{RM}/conf?format=json") or "")
            if props:
                def num(k: str, d: int) -> int:
                    try:
                        return int(props.get(k, d))
                    except (TypeError, ValueError):
                        return d
                self._conf = {"min": num("yarn.scheduler.minimum-allocation-mb", 1024),
                              "max": num("yarn.scheduler.maximum-allocation-mb", 8192),
                              "nmMb": num("yarn.nodemanager.resource.memory-mb", 8192),
                              "nmVcores": num("yarn.nodemanager.resource.cpu-vcores", 8)}
        return self._conf or {"min": 512, "max": 4096, "nmMb": 4096, "nmVcores": 4}

    # ------------------------------------------------------------ armado

    def _containers(self, app_id: str, app_type: str, nm: list[dict]) -> list[dict]:
        out = []
        for c in nm:
            cid = c.get("id", "")
            if app_of_container(cid) != app_id:
                continue
            out.append({"id": cid, "memoryMb": int(c.get("totalMemoryNeededMB", 0)),
                        "kind": container_kind(cid, app_type), "label": container_label(cid, app_type)})
        out.sort(key=lambda x: x["id"])
        return out

    def _log(self, a: dict) -> list[dict]:
        sub = self.submitted.get(a.get("id", ""))
        if sub and sub.get("run"):
            run: Run = sub["run"]
            return [{"t": l["t"], "level": level_of(l["text"]), "text": l["text"]} for l in run.lines[-100:]]
        out = [{"t": int(a.get("startedTime", 0)), "level": "INFO",
                "text": f"Aplicación enviada a la cola {a.get('queue', 'default')}"}]
        if a.get("launchTime"):
            out.append({"t": int(a["launchTime"]), "level": "INFO",
                        "text": f"ApplicationMaster en {a.get('amHostHttpAddress', 'el NodeManager')}"})
        if a.get("finishedTime"):
            st = app_state(a)
            out.append({"t": int(a["finishedTime"]), "level": "INFO" if st == "FINISHED" else "ERROR",
                        "text": f"Terminó: {a.get('finalStatus', st)}" + (
                            f" · {a['diagnostics'].strip()}" if a.get("diagnostics") and st != "FINISHED" else "")})
        return out

    def app_json(self, a: dict, nm: list[dict], stages: list[dict] | None = None) -> dict:
        typ = a.get("applicationType", "MAPREDUCE").upper()
        if typ not in ENGINE:
            typ = "MAPREDUCE" if typ not in ("TEZ", "SPARK") else typ
        state = app_state(a)
        containers = self._containers(a.get("id", ""), typ, nm) if state in ("RUNNING", "ACCEPTED") else []
        am = next((c["memoryMb"] for c in containers if c["kind"] == "am"), None)
        if am is None:
            am = {"MAPREDUCE": 512, "TEZ": 1024, "SPARK": 1024}[typ]
        out = {"id": a.get("id"), "name": a.get("name", ""), "type": typ, "user": a.get("user", ""),
               "queue": a.get("queue", "default"), "state": state,
               "progress": round(float(a.get("progress", 0)) / 100, 4) if state != "FINISHED" else 1.0,
               "submittedAt": int(a.get("startedTime", 0)), "amMemoryMb": am, "containers": containers,
               "stages": stages if stages is not None else self._quick_stages(a, state),
               "log": self._log(a)}
        if a.get("launchTime"):
            out["startedAt"] = int(a["launchTime"])
        if a.get("finishedTime"):
            out["finishedAt"] = int(a["finishedTime"])
        return out

    def _quick_stages(self, a: dict, state: str) -> list[dict]:
        """Las etapas sin pedirle nada a nadie: para Hive, de lo que imprimió
        beeline; para el resto, vacías (el detalle las trae completas)."""
        sub = self.submitted.get(a.get("id", ""))
        if a.get("applicationType", "").upper() == "TEZ" and sub and sub.get("run"):
            return self._tez_stages([l["text"] for l in sub["run"].lines], state, sub.get("example"))
        return []

    @staticmethod
    def _tasks(prefix: str, total: int, done: int, running: int, failed: int = 0) -> list[dict]:
        tasks = []
        for i in range(total):
            st = "done" if i < done else "running" if i < done + running else \
                "failed" if i < done + running + failed else "pending"
            tasks.append({"id": f"{prefix}_{i:06d}", "index": i, "state": st})
        return tasks

    def _tez_stages(self, lines: list[str], state: str, example: str | None) -> list[dict]:
        verts = parse_tez_progress(lines)
        out, prev = [], None
        for v in verts:
            st = "done" if v["total"] and v["done"] >= v["total"] else "running" if v["running"] or v["done"] \
                else "done" if state == "FINISHED" else "pending"
            sid = v["name"].lower().replace(" ", "")
            out.append({"id": sid, "name": v["name"],
                        "description": " → ".join(JOBS["hive-ventas"]["ops"].get(v["name"], []))
                        if example == "hive-ventas" else f"Vértice de Tez ({v['name']})",
                        "dependsOn": [prev] if prev else [], **({"edge": "SCATTER_GATHER"} if prev else {}),
                        "state": st, "tasks": self._tasks(sid, v["total"], v["done"], v["running"])})
            prev = sid
        return out

    async def _mr_detail(self, a: dict, state: str) -> tuple[list[dict], list[dict]]:
        """Etapas Map y Reduce y contadores, del AM (corriendo) o de JobHistory."""
        jid = job_id(a["id"])
        base = (f"{RM}/proxy/{a['id']}/ws/v1/mapreduce/jobs/{jid}" if state == "RUNNING"
                else f"{JHS}/ws/v1/history/mapreduce/jobs/{jid}")
        tasks_doc, counters_doc = await asyncio.gather(self.get(f"{base}/tasks"), self.get(f"{base}/counters"))
        tasks = ((tasks_doc or {}).get("tasks") or {}).get("task") or []
        stages = []
        for kind, sid, name, desc in (("MAP", "map", "Map", "Cada mapper lee un bloque (un split) y emite clave y valor"),
                                      ("REDUCE", "reduce", "Reduce", "Recibe los pares ordenados por clave y los junta")):
            ts = sorted((t for t in tasks if t.get("type") == kind), key=lambda t: t.get("id", ""))
            yt = []
            for i, t in enumerate(ts):
                st = {"SUCCEEDED": "done", "RUNNING": "running", "FAILED": "failed", "KILLED": "failed"}.get(
                    t.get("state"), "pending")
                x = {"id": t.get("id", f"{sid}_{i:06d}"), "index": i, "state": st}
                if t.get("startTime", -1) and t.get("startTime", -1) > 0:
                    x["startedAt"] = int(t["startTime"])
                if t.get("finishTime", -1) and t.get("finishTime", -1) > 0:
                    x["finishedAt"] = int(t["finishTime"])
                yt.append(x)
            if not yt and kind == "REDUCE" and not tasks:
                continue
            sst = "done" if yt and all(t["state"] == "done" for t in yt) else \
                "running" if any(t["state"] in ("running", "done") for t in yt) else "pending"
            stages.append({"id": sid, "name": name, "description": desc, "dependsOn": ["map"] if sid == "reduce" else [],
                           **({"edge": "shuffle + sort"} if sid == "reduce" else {}), "state": sst, "tasks": yt})
        counters = []
        for g in ((counters_doc or {}).get("jobCounters") or {}).get("counterGroup") or []:
            for c in g.get("counter") or []:
                counters.append({"group": g.get("counterGroupName", ""), "name": c.get("name", ""),
                                 "value": int(c.get("totalCounterValue", 0))})
        return stages, counters

    async def _spark_detail(self, a: dict, state: str) -> tuple[list[dict], list[dict], dict[str, dict]]:
        """Etapas de Spark: la interfaz del driver mientras corre, Spark History cuando terminó."""
        app = a["id"]
        base = f"{DRIVER}/api/v1/applications/{app}" if state in ("RUNNING", "ACCEPTED") else \
            f"{SHS}/api/v1/applications/{app}"
        stages_doc, jobs_doc = await asyncio.gather(self.get(f"{base}/stages"), self.get(f"{base}/jobs"))
        if stages_doc is None and state in ("RUNNING", "ACCEPTED"):
            base = f"{RM}/proxy/{app}/api/v1/applications/{app}"
            stages_doc, jobs_doc = await asyncio.gather(self.get(f"{base}/stages"), self.get(f"{base}/jobs"))
        raw = [s for s in (stages_doc or []) if isinstance(s, dict) and s.get("status") != "SKIPPED"]
        raw.sort(key=lambda s: (s.get("stageId", 0), -s.get("attemptId", 0)))
        best: dict[int, dict] = {}
        for s in raw:
            best.setdefault(int(s.get("stageId", 0)), s)
        # Dentro de un job, cada etapa depende de la anterior (Spark no publica el árbol por REST)
        prev_of: dict[int, int] = {}
        for j in jobs_doc or []:
            ids = sorted(i for i in j.get("stageIds", []) if i in best)
            for x, y in zip(ids, ids[1:]):
                prev_of[y] = x
        stages, extra = [], {}
        for sid, s in sorted(best.items()):
            st = {"COMPLETE": "done", "ACTIVE": "running"}.get(s.get("status"), "pending")
            total = int(s.get("numTasks", 0))
            done = int(s.get("numCompleteTasks", 0))
            stages.append({"id": f"s{sid}", "name": f"Stage {sid}", "description": s.get("name", ""),
                           "dependsOn": [f"s{prev_of[sid]}"] if sid in prev_of else [],
                           **({"edge": "shuffle"} if s.get("shuffleReadBytes") else {}), "state": st,
                           "tasks": self._tasks(f"s{sid}", total, done, int(s.get("numActiveTasks", 0)),
                                                int(s.get("numFailedTasks", 0)))})
            extra[f"s{sid}"] = s
        tot = lambda k: sum(int(s.get(k, 0) or 0) for s in best.values())  # noqa: E731
        counters = []
        if best:
            counters = [{"group": "FileSystemCounters", "name": "HDFS_BYTES_READ", "value": tot("inputBytes")},
                        {"group": "spark", "name": "recordsRead", "value": tot("inputRecords")},
                        {"group": "spark", "name": "recordsWritten", "value": tot("outputRecords")},
                        {"group": "spark", "name": "bytesWritten", "value": tot("outputBytes")},
                        {"group": "spark", "name": "shuffleReadBytes", "value": tot("shuffleReadBytes")}]
        return stages, counters, extra

    # ------------------------------------------------------------ consultas

    def _need_rm(self) -> None:
        """El ResourceManager arriba. Con SERVICIOS=hdfs YARN no está en la
        configuración, pero para la interfaz es lo mismo que caído ("falta YARN"):
        service_down, no unsupported."""
        self.c.need_running()
        if self.c.config.get("services") == "hdfs":
            raise ApiError("YARN no está prendido: esta configuración es solo HDFS (SERVICIOS=hdfs)",
                           "service_down")
        self.c.need_proc("rm", "El ResourceManager")

    async def apps(self) -> list[dict]:
        self._need_rm()
        rm, nm = await asyncio.gather(self.rm_apps(), self.nm_containers())
        rm.sort(key=lambda a: int(a.get("startedTime", 0)), reverse=True)
        return [self.app_json(a, nm) for a in rm]

    async def cluster(self) -> dict:
        self._need_rm()
        metrics, nodes, sched, nm, conf = await asyncio.gather(
            self.get(f"{RM}/ws/v1/cluster/metrics"), self.get(f"{RM}/ws/v1/cluster/nodes"),
            self.get(f"{RM}/ws/v1/cluster/scheduler"), self.nm_containers(), self.conf())
        if metrics is None:
            raise ApiError("El ResourceManager no responde", "service_down")
        m = metrics.get("clusterMetrics") or {}
        types: dict[str, str] = {}
        try:
            types = {a["id"]: a.get("applicationType", "MAPREDUCE").upper() for a in await self.rm_apps()
                     if a.get("state") in ("ACCEPTED", "RUNNING")}
        except ApiError:
            pass
        out_nodes = []
        for n in ((nodes or {}).get("nodes") or {}).get("node") or []:
            mine = []
            for c in nm:
                app = app_of_container(c.get("id", ""))
                if not app or c.get("nodeId", n.get("id")) != n.get("id"):
                    continue
                kind = container_kind(c["id"], types.get(app, "MAPREDUCE"))
                mine.append({"id": c["id"], "memoryMb": int(c.get("totalMemoryNeededMB", 0)), "kind": kind,
                             "label": container_label(c["id"], types.get(app, "MAPREDUCE")),
                             "appId": app, "vcores": int(c.get("totalVCoresNeeded", 1))})
            used = int(n.get("usedMemoryMB", 0))
            vused = int(n.get("usedVirtualCores", 0))
            out_nodes.append({"id": n.get("id", ""), "state": n.get("state", "RUNNING") if n.get("state") in
                              ("RUNNING", "UNHEALTHY", "LOST", "DECOMMISSIONED") else "LOST",
                              "memTotalMb": used + int(n.get("availMemoryMB", 0)), "memUsedMb": used,
                              "vcoresTotal": vused + int(n.get("availableVirtualCores", 0)), "vcoresUsed": vused,
                              "containers": mine, "lastHealthUpdate": int(n.get("lastHealthUpdate", 0))})
        queues = []
        info = ((sched or {}).get("scheduler") or {}).get("schedulerInfo") or {}

        def walk(qs: list[dict]) -> None:
            for q in qs:
                children = ((q.get("queues") or {}).get("queue")) or []
                if children:
                    walk(children)
                    continue
                queues.append({"name": q.get("queueName", "default"), "capacity": round(float(q.get("capacity", 100)), 1),
                               "usedMb": int((q.get("resourcesUsed") or {}).get("memory", 0)),
                               "running": int(q.get("numActiveApplications", 0)),
                               "pending": int(q.get("numPendingApplications", 0))})
        walk(((info.get("queues") or {}).get("queue")) or [])
        if not queues:
            queues = [{"name": "default", "capacity": 100, "usedMb": int(m.get("allocatedMB", 0)),
                       "running": int(m.get("appsRunning", 0)), "pending": int(m.get("appsPending", 0))}]
        return {"totalMb": int(m.get("totalMB", 0)), "usedMb": int(m.get("allocatedMB", 0)),
                "totalVcores": int(m.get("totalVirtualCores", 0)), "usedVcores": int(m.get("allocatedVirtualCores", 0)),
                "minAllocationMb": conf["min"], "maxAllocationMb": conf["max"], "nodes": out_nodes, "queues": queues}

    async def detail(self, app_id: str) -> dict:
        self._need_rm()
        a, nm = await asyncio.gather(self.rm_app(app_id), self.nm_containers())
        typ = a.get("applicationType", "").upper()
        state = app_state(a)
        sub = self.submitted.get(app_id) or {}
        example = sub.get("example")
        engine = ENGINE.get(typ, "mr")
        counters: list[dict] = []
        extra: dict[str, dict] = {}
        if typ == "MAPREDUCE":
            stages, counters = await self._mr_detail(a, state)
        elif typ == "SPARK":
            stages, counters, extra = await self._spark_detail(a, state)
        else:
            stages = self._quick_stages(a, state)
            if not stages:
                # Sin Timeline Server no hay DAG de Tez por REST: una etapa con el avance del RM
                p = float(a.get("progress", 0)) / 100
                stages = [{"id": "dag", "name": "DAG de Tez", "description": "Avance informado por el ResourceManager",
                           "dependsOn": [], "state": "done" if state == "FINISHED" else "running" if state == "RUNNING"
                           else "pending", "tasks": self._tasks("dag", 1, 1 if p >= 1 or state == "FINISHED" else 0,
                                                                1 if state == "RUNNING" and p < 1 else 0)}]
        app = self.app_json(a, nm, stages)
        cmap = {c["name"]: c["value"] for c in counters}
        ops = JOBS.get(example or "", {}).get("ops", {})
        vertices = []
        for i, s in enumerate(stages):
            done = sum(1 for t in s["tasks"] if t["state"] == "done")
            v = {"id": s["id"], "name": s["name"], "state": s["state"], "tasks": len(s["tasks"]), "tasksDone": done,
                 "operators": ops.get(s["id"]) or ops.get(s["name"]) or [s["description"]]}
            starts = [t["startedAt"] for t in s["tasks"] if t.get("startedAt")]
            ends = [t["finishedAt"] for t in s["tasks"] if t.get("finishedAt")]
            if starts:
                v["startedAt"] = min(starts)
            if ends and s["state"] == "done":
                v["finishedAt"] = max(ends)
            if typ == "MAPREDUCE":
                if s["id"] == "map":
                    v.update({k: cmap[c] for k, c in (("recordsIn", "MAP_INPUT_RECORDS"), ("recordsOut", "MAP_OUTPUT_RECORDS"))
                              if c in cmap})
                    if "HDFS_BYTES_READ" in cmap:
                        v["bytesReadMb"] = hdfs_mod.mb(cmap["HDFS_BYTES_READ"])
                else:
                    v.update({k: cmap[c] for k, c in (("recordsIn", "REDUCE_INPUT_RECORDS"),
                                                      ("recordsOut", "REDUCE_OUTPUT_RECORDS")) if c in cmap})
                    if "HDFS_BYTES_WRITTEN" in cmap:
                        v["bytesWrittenMb"] = hdfs_mod.mb(cmap["HDFS_BYTES_WRITTEN"])
            elif typ == "SPARK" and s["id"] in extra:
                x = extra[s["id"]]
                for k, src in (("recordsIn", "inputRecords"), ("recordsOut", "outputRecords")):
                    if x.get(src):
                        v[k] = int(x[src])
                if x.get("inputBytes"):
                    v["bytesReadMb"] = hdfs_mod.mb(int(x["inputBytes"]))
                if x.get("outputBytes"):
                    v["bytesWrittenMb"] = hdfs_mod.mb(int(x["outputBytes"]))
                for k, src in (("startedAt", "submissionTime"), ("finishedAt", "completionTime")):
                    if x.get(src):
                        try:
                            v[k] = int(datetime.strptime(x[src].replace("GMT", "+0000"),
                                                         "%Y-%m-%dT%H:%M:%S.%f%z").timestamp() * 1000)
                        except ValueError:
                            pass
            vertices.append(v)
        edges = [{"from": d, "to": s["id"], "kind": s.get("edge") or "datos"} for s in stages for d in s["dependsOn"]]
        counters.append({"group": "YARN", "name": "TASKS_DONE", "value": sum(v["tasksDone"] for v in vertices)})
        if state == "RUNNING":
            tracking = f"http://localhost:8088/proxy/{app_id}/"
        elif engine == "mr":
            tracking = f"http://localhost:19888/jobhistory/job/{job_id(app_id)}"
        elif engine == "spark":
            tracking = f"http://localhost:18080/history/{app_id}/"
        else:
            tracking = f"http://localhost:8088/cluster/app/{app_id}"
        secs = round((int(a.get("finishedTime", 0)) - int(a.get("startedTime", 0))) / 1000) if a.get("finishedTime") else None
        rows = cmap.get("REDUCE_OUTPUT_RECORDS") or cmap.get("recordsWritten")
        out_path = sub.get("out") or JOBS.get(example or "", {}).get("out")
        output = (f"Terminó en {secs} s" + (f" · {rows:,} filas".replace(",", ".") if rows else "") +
                  (f" en {out_path}" if out_path else "")) if state == "FINISHED" else \
            "Cancelado: no dejó resultado" if state == "KILLED" else \
            f"Falló: {(a.get('diagnostics') or '').strip().splitlines()[0] if a.get('diagnostics') else 'ver logs'}" \
            if state == "FAILED" else "Todavía corriendo"
        command = sub.get("shown") or f"yarn application -status {app_id}"
        detail = {**app, "engine": engine, "command": command, "trackingUrl": tracking,
                  "dag": {"vertices": vertices, "edges": edges}, "counters": counters,
                  "trace": {"command": command, "input": sub.get("input") or a.get("name", "—"),
                            "action": f"{len(stages)} etapa{'s' if len(stages) != 1 else ''}: "
                                      + " → ".join(s["name"] for s in stages) if stages else "Sin etapas todavía",
                            "output": output, "engine": engine, "appIds": [app_id]}}
        if a.get("diagnostics") and state != "FINISHED":
            detail["diagnostics"] = a["diagnostics"].strip()
        if out_path:
            detail["outputPath"] = out_path
        return detail

    async def logs(self, app_id: str, container: str | None) -> dict:
        self._need_rm()
        a, nm = await asyncio.gather(self.rm_app(app_id), self.nm_containers())
        typ = a.get("applicationType", "MAPREDUCE").upper()
        state = app_state(a)
        live = [c["id"] for c in nm if app_of_container(c.get("id", "")) == app_id]
        if live:
            ids = live
        elif state in ("FINISHED", "FAILED", "KILLED"):
            rc, out, err = await self._exec(["yarn", "logs", "-applicationId", app_id, "-show_application_log_info"])
            ids = parse_log_containers(out + err)
        else:
            ids = []
        ids = sorted(set(ids))
        am = next((c for c in ids if container_kind(c, typ) == "am"), ids[0] if ids else None)
        cur = container if container in ids else am
        containers = [{"id": c, "kind": container_kind(c, typ), "label": container_label(c, typ)} for c in ids]
        files: dict[str, list[str]] = {}
        if cur and cur in live:
            texts = await asyncio.gather(*(self.text(f"{NM}/ws/v1/node/containerlogs/{cur}/{f}") for f in
                                           ("stdout", "stderr", "syslog")))
            files = {f: (t or "").splitlines()[-500:] for f, t in zip(("stdout", "stderr", "syslog"), texts)}
        elif cur:
            key = (app_id, cur)
            if key not in self._logs_cache:
                rc, out, err = await self._exec(["yarn", "logs", "-applicationId", app_id, "-containerId", cur,
                                                 "-log_files", "stdout,stderr,syslog", "-size", "-65536"])
                self._logs_cache[key] = parse_yarn_logs(out)
                while len(self._logs_cache) > 20:
                    self._logs_cache.pop(next(iter(self._logs_cache)))
            files = self._logs_cache[key]
        return {"appId": app_id, "containers": containers, "container": cur or "",
                "files": [{"name": f, "lines": files.get(f, [])[-500:]} for f in ("stdout", "stderr", "syslog")]}

    async def _exec(self, argv: list[str]) -> tuple[int, str, str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, stdin=asyncio.subprocess.DEVNULL)
        except OSError as e:
            raise ApiError(f"No se pudo correr {argv[0]}: {e}", "failed") from e
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=90)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise ApiError(f"{shlex.join(argv)} tardó demasiado", "failed") from None
        return proc.returncode or 0, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")

    # ------------------------------------------------------------- acciones

    async def submit(self, example: object) -> str:
        if example not in JOBS:
            raise ApiError("El trabajo es mr-ventas, hive-ventas o spark-ventas", "invalid")
        job = JOBS[str(example)]
        self.c.need_hdfs()
        self._need_rm()
        self.c.need_proc("nm", "El NodeManager")
        if job["type"] == "TEZ":
            self.c.need_proc(*job["proc"])
        datos = self.c.s.datos_dir
        ventas = hdfs_mod.EXAMPLES["ventas"]
        # Si /user/root/ventas no está, se sube primero (como hace el ejemplo a mano)
        prep = (f"hdfs dfs -test -e {VENTAS} || {{ [ -s {ventas['local']} ] || {ventas['gen']}; "
                f"hdfs dfs -mkdir -p {VENTAS} && hdfs dfs -put -f {ventas['local']} {VENTAS}/; }}")
        clean_out = f"hdfs dfs -rm -r -f -skipTrash {job['out']} > /dev/null 2>&1 || true"
        script = f"set -e\ncd {shlex.quote(str(datos))}\n{prep}\n{clean_out}\n{job['run']}"
        try:
            st = await asyncio.to_thread(self.http, f"{RM}/ws/v1/cluster/apps?states=NEW,NEW_SAVING,SUBMITTED,ACCEPTED,RUNNING", 3.0)
            before = {a["id"] for a in ((json.loads(st[1]).get("apps") or {}).get("app") or [])} if st[0] == 200 else set()
        except ValueError:
            before = set()
        t0 = now_ms()
        info = {"example": example, "shown": job["shown"], "out": job["out"],
                "input": f"{VENTAS} · {hdfs_mod.EXAMPLES['ventas']['rows']}"}
        box: dict[str, str] = {}

        async def after() -> object:
            app = box.get("app")
            if app:
                self.bus.publish("yarn", {"appId": app})
                self.bus.publish("hdfs", {"path": job["out"].rsplit("/", 1)[0]})
            return app

        run = self.runner.start(Action(f"{job['type']}: {example}", script, display=job["shown"], input=info["input"],
                                       action=job["action"], after=after, timeout=3600))
        info["run"] = run
        # El id de la aplicación: lo imprime el cliente al mandarla (o aparece en el RM)
        deadline = time.monotonic() + 120
        app_id = None
        while time.monotonic() < deadline:
            for l in run.lines:
                m = APP_ID.search(l["text"])
                if m:
                    app_id = m.group(0)
                    break
            if app_id is None and run.state == "running":
                app_id = await self._new_app(before, t0, job["type"])
            if app_id or run.state != "running":
                break
            await asyncio.sleep(0.5)
        if app_id is None:
            if run.state == "failed":
                last = run.error or next((l["text"] for l in reversed(run.lines) if l["text"].strip()), "falló")
                raise ApiError(last, "failed")
            raise ApiError("El trabajo no llegó a YARN: mirá la actividad para ver qué pasó", "failed")
        box["app"] = app_id
        run.action.app_id = app_id
        self.submitted[app_id] = info
        while len(self.submitted) > 50:
            self.submitted.pop(next(iter(self.submitted)))
        self.bus.publish("yarn", {"appId": app_id})
        return app_id

    async def _new_app(self, before: set[str], t0: int, typ: str) -> str | None:
        status, body = await asyncio.to_thread(self.http, f"{RM}/ws/v1/cluster/apps?startedTimeBegin={t0 - 2000}", 3.0)
        if status != 200:
            return None
        try:
            apps = (json.loads(body).get("apps") or {}).get("app") or []
        except ValueError:
            return None
        new = [a for a in apps if a.get("id") not in before and a.get("applicationType", "").upper() == typ
               and a.get("id") not in self.submitted]
        new.sort(key=lambda a: int(a.get("startedTime", 0)))
        return new[0]["id"] if new else None

    async def kill(self, app_id: str) -> None:
        self._need_rm()
        # spark-submit imprime "Submitting application <id>" antes de que el RM
        # la acepte: si la mandamos nosotros, se espera un poco a que el RM la conozca.
        deadline = time.monotonic() + (30 if app_id in self.submitted else 0)
        while True:
            try:
                a = await self.rm_app(app_id)
                break
            except ApiError as e:
                if e.code != "not_found" or time.monotonic() >= deadline:
                    raise
                await asyncio.sleep(0.5)
        if app_state(a) in ("FINISHED", "FAILED", "KILLED"):
            return
        cmd = ["yarn", "application", "-kill", app_id]
        run = await self.runner.run(Action(f"Cancelar {a.get('name') or app_id}", cmd, input=app_id,
                                           action="El ResourceManager le avisa al ApplicationMaster y libera "
                                                  "la memoria de sus contenedores",
                                           after=lambda: hdfs_mod._const("YARN liberó su memoria"), app_id=app_id,
                                           timeout=120))
        if run.state != "done":
            raise ApiError(run.error or next((l["text"] for l in reversed(run.lines) if l["text"].strip()),
                                             "yarn application -kill falló"), "failed")
        self.bus.publish("yarn", {"appId": app_id})

    # ------------------------------------------------------------- watcher

    async def watch(self) -> None:
        """Después de cada sondeo: un evento 'yarn' por cada aplicación que
        cambió de estado, de avance o de contenedores."""
        if self.c.phase != "running" or not any(p["id"] == "rm" and p["state"] == "up" for p in self.c.processes):
            self._sig.clear()
            return
        doc = await self.get(f"{RM}/ws/v1/cluster/apps?states=NEW,NEW_SAVING,SUBMITTED,ACCEPTED,RUNNING,FINISHED,FAILED,KILLED"
                             f"&startedTimeBegin={now_ms() - 6 * 3600_000}", 2.0)
        if doc is None:
            return
        seen = set()
        for a in ((doc.get("apps") or {}).get("app")) or []:
            sig = json.dumps([a.get("state"), a.get("finalStatus"), round(float(a.get("progress", 0))),
                              a.get("runningContainers"), a.get("allocatedMB")])
            seen.add(a["id"])
            if self._sig.get(a["id"]) != sig:
                if a["id"] in self._sig or app_state(a) in ("ACCEPTED", "RUNNING"):
                    self.bus.publish("yarn", {"appId": a["id"]})
                self._sig[a["id"]] = sig
        for k in [k for k in self._sig if k not in seen]:
            del self._sig[k]

    # ---------------------------------------------------------------- rutas

    def routes(self) -> list[Route]:
        async def apps(_: Request) -> JSONResponse:
            return JSONResponse(await self.apps())

        async def submit(request: Request) -> JSONResponse:
            body = await hdfs_mod._json(request)
            return JSONResponse({"id": await self.submit(body.get("example"))}, status_code=202)

        async def kill(request: Request) -> Response:
            await self.kill(request.path_params["id"])
            return Response(status_code=204)

        async def cluster(_: Request) -> JSONResponse:
            return JSONResponse(await self.cluster())

        async def app(request: Request) -> JSONResponse:
            return JSONResponse(await self.detail(request.path_params["id"]))

        async def logs(request: Request) -> JSONResponse:
            return JSONResponse(await self.logs(request.path_params["id"], request.query_params.get("container")))

        return [
            Route("/api/yarn/apps", apps, methods=["GET"]),
            Route("/api/yarn/apps", submit, methods=["POST"]),
            Route("/api/yarn/cluster", cluster, methods=["GET"]),
            Route("/api/yarn/apps/{id}", app, methods=["GET"]),
            Route("/api/yarn/apps/{id}/kill", kill, methods=["POST"]),
            Route("/api/yarn/apps/{id}/logs", logs, methods=["GET"]),
        ]
