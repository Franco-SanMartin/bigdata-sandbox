"""YARN: ResourceManager, NodeManager, JobHistory y Spark History simulados con
las fixtures (salidas reales de Hadoop 3.3.6 y Spark 3.5 tomadas por el humo);
'yarn' y 'spark-submit' falsos en el PATH."""
import asyncio
import json
import os
import time
import urllib.parse

import pytest
from starlette.testclient import TestClient

from conftest import BASE, FIX, fixture_text
from sandbox_server import yarn as Y
from sandbox_server.actions import ActionRunner
from sandbox_server.app import build_app
from sandbox_server.cluster import Cluster
from sandbox_server.errors import ApiError
from sandbox_server.events import EventBus

# Las tres que mandó el humo (terminadas)
MR = "application_1792695340081_0001"
SPARK = "application_1792695340081_0002"
TEZ = "application_1792695340081_0003"
# Derivadas de la de Spark real: una corriendo, una cancelada y una esperando
CORRIENDO = "application_1792695340081_0004"
KILLED = "application_1792695340081_0005"
ACEPTADA = "application_1792695340081_0006"
NUEVA = "application_1792695340081_0009"
NODO = "localhost:39943"


def derivada(app_id: str, **cambios) -> dict:
    a = json.loads(fixture_text("rm_app_spark.json"))["app"]
    return {**a, "id": app_id, "trackingUrl": f"http://3e3807a224b1:8088/proxy/{app_id}/",
            "amContainerLogs": f"http://localhost:8042/node/containerlogs/container_{app_id[12:]}_01_000001/root",
            **cambios}


def contenedores(app_id: str, n: int) -> list[dict]:
    """Como los lista el NodeManager mientras la app corre."""
    out = []
    for i in range(1, n + 1):
        cid = f"container_{app_id[12:]}_01_{i:06d}"
        out.append({"id": cid, "state": "RUNNING", "exitCode": -1000, "diagnostics": "", "user": "root",
                    "totalMemoryNeededMB": 1024, "totalVCoresNeeded": 1, "nodeId": NODO,
                    "containerLogsLink": f"http://localhost:8042/node/containerlogs/{cid}/root",
                    "containerLogFiles": ["stdout", "prelaunch.err", "stderr", "prelaunch.out"]})
    return out


def etapas_corriendo() -> bytes:
    """Las etapas reales de Spark History con la última todavía en marcha."""
    st = json.loads(fixture_text("shs_stages.json"))
    for s in st:
        if s["stageId"] == 12:
            s.update(status="ACTIVE", numCompleteTasks=0, numActiveTasks=1)
    return json.dumps(st).encode()


class Rest:
    """Responde como los servicios de YARN: URL -> fixture."""

    def __init__(self):
        self.calls: list[str] = []
        self.down: set[str] = set()      # 'host:puerto' que no contestan
        self.nm: list[dict] = []         # real: sin apps corriendo el NodeManager no lista nada
        apps = json.loads(fixture_text("rm_apps.json"))["apps"]["app"]
        apps += [derivada(CORRIENDO, state="RUNNING", finalStatus="UNDEFINED", progress=10.0,
                          startedTime=1792695500000, launchTime=1792695500500, finishedTime=0,
                          allocatedMB=3072, runningContainers=3),
                 derivada(KILLED, state="KILLED", finalStatus="KILLED", diagnostics="Application killed by user.",
                          startedTime=1792695510000, launchTime=1792695510400, finishedTime=1792695515000),
                 derivada(ACEPTADA, state="ACCEPTED", finalStatus="UNDEFINED", progress=0.0,
                          startedTime=1792695520000, launchTime=0, finishedTime=0, allocatedMB=-1)]
        self.apps = {a["id"]: a for a in apps}

    def __call__(self, url, timeout=5.0, limit=None):
        self.calls.append(url)
        u = urllib.parse.urlparse(url)
        if u.netloc in self.down:
            return 0, b""
        p = u.path
        files = {
            "localhost:8088/ws/v1/cluster/metrics": "rm_metrics.json",
            "localhost:8088/ws/v1/cluster/nodes": "rm_nodes.json",
            "localhost:8088/ws/v1/cluster/scheduler": "rm_scheduler.json",
            "localhost:8088/conf": "rm_conf.xml",
            "localhost:19888/ws/v1/history/mapreduce/jobs/job_1792695340081_0001/tasks": "jhs_tasks.json",
            "localhost:19888/ws/v1/history/mapreduce/jobs/job_1792695340081_0001/counters": "jhs_counters.json",
            f"localhost:18080/api/v1/applications/{SPARK}/stages": "shs_stages.json",
            f"localhost:18080/api/v1/applications/{SPARK}/jobs": "shs_jobs.json",
            f"localhost:8088/proxy/{CORRIENDO}/api/v1/applications/{CORRIENDO}/jobs": "shs_jobs.json",
        }
        if u.netloc + p == "localhost:8088/ws/v1/cluster/apps":
            return 200, json.dumps({"apps": {"app": list(self.apps.values())}}).encode()
        if u.netloc + p == "localhost:8042/ws/v1/node/containers":
            return 200, json.dumps({"containers": {"container": self.nm} if self.nm else {}}).encode()
        if u.netloc + p == f"localhost:8088/proxy/{CORRIENDO}/api/v1/applications/{CORRIENDO}/stages":
            return 200, etapas_corriendo()
        name = files.get(u.netloc + p)
        if name:
            return 200, (FIX / name).read_bytes()
        if u.netloc == "localhost:8088" and p.startswith("/ws/v1/cluster/apps/"):
            a = self.apps.get(p.rsplit("/", 1)[1])
            if a is None:
                return 404, b'{"RemoteException":{"exception":"NotFoundException"}}'
            return 200, json.dumps({"app": a}).encode()
        if u.netloc == "localhost:8042" and p.startswith("/ws/v1/node/containerlogs/"):
            f = p.rsplit("/", 1)[1]
            return 200, f"línea de {f} 1\nlínea de {f} 2\n".encode()
        return 404, b""


@pytest.fixture
def fake_bin(tmp_path, monkeypatch):
    """'yarn' y 'spark-submit' (y un 'hdfs' que no hace nada) que anotan lo que les piden."""
    bin_dir = tmp_path / "fakebin"
    bin_dir.mkdir()
    log = tmp_path / "cmds.log"
    scripts = {
        "yarn": f"""echo "yarn $*" >> {log}
case "$*" in
  *-show_application_log_info*) cat {FIX / 'yarn_logs_info.txt'} ;;
  *-containerId*) cat {FIX / 'yarn_logs.txt'} ;;
  *-kill*) echo "Killing application $3"; echo "Killed application $3" ;;
esac""",
        "spark-submit": f"""echo "spark-submit $*" >> {log}
echo "INFO Client: Submitted application {NUEVA}"
sleep 0.2
echo "INFO Client: Application report for {NUEVA} (state: FINISHED)" """,
        "hdfs": f'echo "hdfs $*" >> {log}',
    }
    for name, body in scripts.items():
        f = bin_dir / name
        f.write_text("#!/bin/bash\n" + body + "\n")
        f.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    return log


def up(*ids):
    return [{"id": i, "kind": "yarn", "name": i, "layer": "yarn", "state": "up", "ports": [], "controllable": True}
            for i in ids]


def make(settings, tmp_path):
    datos = tmp_path / "datos"
    datos.mkdir(exist_ok=True)
    settings.datos_dir = datos
    bus = EventBus()
    runner = ActionRunner(bus)
    cl = Cluster(bus, runner, settings)
    cl.phase = "running"
    cl.config = {**cl.config, **BASE}
    cl.hdfs = {**cl.hdfs, "available": True}
    cl.nn_active_port = 9870
    cl.processes = up("rm", "nm", "jh", "sparkhistory")
    y = Y.Yarn(cl, runner, bus)
    y.http = Rest()
    return cl, y, bus


# ------------------------------------------------------------------ formatos


def test_formatos():
    assert Y.app_state({"state": "FINISHED", "finalStatus": "KILLED"}) == "KILLED"
    assert Y.app_state({"state": "FINISHED", "finalStatus": "FAILED"}) == "FAILED"
    assert Y.app_state({"state": "NEW_SAVING"}) == "ACCEPTED"
    assert Y.app_of_container("container_e05_1792695340081_0002_01_000002") == SPARK
    assert Y.container_label("container_1792695340081_0002_01_000001", "SPARK") == "AM (driver)"
    assert Y.container_label("container_1792695340081_0002_01_000003", "SPARK") == "exec 2"
    assert Y.container_label("container_1792695340081_0001_01_000004", "MAPREDUCE") == "contenedor 3"
    assert Y.level_of("2026 WARN algo") == "WARN" and Y.level_of("java.io.IOException: ERROR") == "ERROR"
    assert Y.level_of("Map 1: 6/6 0 FAILED") == "INFO"


def test_conf_del_rm_viene_en_xml():
    """Real: :8088/conf?format=json contesta XML en Hadoop 3.3.6."""
    props = Y.parse_conf(fixture_text("rm_conf.xml"))
    assert props["yarn.scheduler.minimum-allocation-mb"] == "512"
    assert props["yarn.scheduler.maximum-allocation-mb"] == "4096"
    assert Y.parse_conf('{"properties":[{"key":"a","value":"1"}]}') == {"a": "1"}
    assert Y.parse_conf("") == {}


def test_avance_de_tez_de_beeline():
    """Real (Hive 4.0): una tabla con una fila por vértice y códigos ANSI; vale el último cuadro."""
    lineas = fixture_text("beeline_tez.txt").splitlines()
    v = Y.parse_tez_progress(lineas)
    assert v == [{"name": "Map 1", "total": 1, "done": 1, "running": 0},
                 {"name": "Reducer 2", "total": 1, "done": 1, "running": 0}]
    corriendo = next(i for i, l in enumerate(lineas) if "RUNNING" in l and l.lstrip("\x1b[2K").startswith("Map 1"))
    assert Y.parse_tez_progress(lineas[:corriendo + 2])[0] == {"name": "Map 1", "total": 1, "done": 0, "running": 1}
    # El formato de una línea de Hive 3
    assert Y.parse_tez_progress(["INFO  : Map 1: 0(+3)/6\tReducer 2: 0/2"])[0]["running"] == 3
    assert Y.parse_tez_progress(["nada que ver"]) == []


def test_logs_agregados():
    files = Y.parse_yarn_logs(fixture_text("yarn_logs.txt"))
    assert files["stdout"] == []
    assert files["syslog"][0].startswith("2026-10-22 18:56:26,318 INFO [main]")
    assert any("Job finished cleanly" in l for l in files["syslog"])
    assert files["stderr"][-1].startswith("log4j:WARN See http://logging.apache.org")
    ids = Y.parse_log_containers(fixture_text("yarn_logs_info.txt"))
    assert ids == [f"container_1792695340081_0001_01_00000{i}" for i in (1, 2, 3, 4)]


# ------------------------------------------------------------------ consultas


def test_lista_de_trabajos(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        y.http.nm = contenedores(CORRIENDO, 3)
        apps = await y.apps()
        assert [a["id"][-4:] for a in apps] == ["0006", "0005", "0004", "0003", "0002", "0001"]
        by = {a["id"]: a for a in apps}
        m = by[MR]
        assert m["type"] == "MAPREDUCE" and m["name"] == "streamjob9041584852475164204.jar"
        assert m["state"] == "FINISHED" and m["progress"] == 1.0 and m["containers"] == []
        assert m["submittedAt"] == 1792695383301 and m["startedAt"] == 1792695384292
        assert m["finishedAt"] == 1792695401946 and m["amMemoryMb"] == 512
        assert by[TEZ]["type"] == "TEZ" and by[SPARK]["name"] == "ventas por producto"
        s = by[CORRIENDO]
        assert s["state"] == "RUNNING" and s["progress"] == 0.1 and s["type"] == "SPARK"
        assert [c["label"] for c in s["containers"]] == ["AM (driver)", "exec 1", "exec 2"]
        assert s["amMemoryMb"] == 1024
        assert by[KILLED]["state"] == "KILLED" and by[KILLED]["log"][-1]["level"] == "ERROR"
        assert "killed by user" in by[KILLED]["log"][-1]["text"]
        assert by[ACEPTADA]["state"] == "ACCEPTED"
        cl.processes = up("nm")
        with pytest.raises(ApiError) as e:
            await y.apps()
        assert e.value.code in ("service_down", "unsupported")
        cl.processes = up("rm", "nm")
        y.http.down.add("localhost:8088")
        with pytest.raises(ApiError) as e:
            await y.apps()
        assert e.value.code == "service_down"
    asyncio.run(main())


def test_memoria_del_cluster(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        c = await y.cluster()
        # El mínimo y el máximo salen del XML de /conf (antes caían a los de por defecto)
        assert c["totalMb"] == 4096 and c["minAllocationMb"] == 512 and c["maxAllocationMb"] == 4096
        assert c["totalVcores"] == 8 and c["usedMb"] == 0
        n = c["nodes"][0]
        assert n["id"] == NODO and n["memTotalMb"] == 4096 and n["memUsedMb"] == 0 and n["containers"] == []
        assert n["vcoresTotal"] == 8 and n["lastHealthUpdate"] == 1792695337020
        assert c["queues"] == [{"name": "default", "capacity": 100.0, "usedMb": 0, "running": 0, "pending": 0}]
        y.http.nm = contenedores(CORRIENDO, 3)
        n = (await y.cluster())["nodes"][0]
        assert {x["appId"] for x in n["containers"]} == {CORRIENDO}
        assert [x["kind"] for x in n["containers"]] == ["am", "executor", "executor"]
    asyncio.run(main())


def test_detalle_mapreduce_de_jobhistory(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        d = await y.detail(MR)
        assert d["engine"] == "mr" and d["state"] == "FINISHED"
        assert [s["id"] for s in d["stages"]] == ["map", "reduce"]
        # Real: 2 maps (uno por bloque de ventas) y 1 reduce
        assert len(d["stages"][0]["tasks"]) == 2 and len(d["stages"][1]["tasks"]) == 1
        assert d["stages"][1]["dependsOn"] == ["map"]
        m, r = d["dag"]["vertices"]
        assert m["recordsIn"] == 200001 and m["recordsOut"] == 200000 and m["tasksDone"] == 2
        assert m["bytesReadMb"] == 5.929475 and m["startedAt"] == 1792695392269
        assert r["recordsOut"] == 8 and r["finishedAt"] == 1792695401680
        assert d["dag"]["edges"] == [{"from": "map", "to": "reduce", "kind": "shuffle + sort"}]
        assert {"group": "YARN", "name": "TASKS_DONE", "value": 3} in d["counters"]
        assert d["trackingUrl"] == "http://localhost:19888/jobhistory/job/job_1792695340081_0001"
        assert d["trace"]["output"] == "Terminó en 19 s · 8 filas"
        assert any("19888/ws/v1/history/mapreduce/jobs/job_1792695340081_0001/tasks" in u for u in y.http.calls)
    asyncio.run(main())


def test_detalle_spark_de_history(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        d = await y.detail(SPARK)
        assert d["engine"] == "spark" and d["state"] == "FINISHED"
        # Real: las etapas SKIPPED (shuffles reusados) no aparecen
        assert [s["id"] for s in d["stages"]] == ["s0", "s1", "s2", "s4", "s5", "s7", "s9", "s12"]
        assert all(s["state"] == "done" for s in d["stages"])
        v1 = next(v for v in d["dag"]["vertices"] if v["id"] == "s1")
        assert v1["recordsIn"] == 200001 and v1["startedAt"] > 0 and v1["finishedAt"] >= v1["startedAt"]
        assert d["trackingUrl"] == f"http://localhost:18080/history/{SPARK}/"
        assert d["trace"]["output"] == "Terminó en 28 s · 8 filas"
    asyncio.run(main())


def test_detalle_spark_corriendo(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        y.http.nm = contenedores(CORRIENDO, 3)
        y.http.down.add("localhost:4040")     # el driver no contesta: va por el proxy del RM
        d = await y.detail(CORRIENDO)
        assert d["engine"] == "spark" and d["state"] == "RUNNING"
        s12 = d["stages"][-1]
        assert s12["id"] == "s12" and s12["state"] == "running"
        assert [t["state"] for t in s12["tasks"]] == ["running"]
        assert d["trackingUrl"] == f"http://localhost:8088/proxy/{CORRIENDO}/"
        assert d["trace"]["output"] == "Todavía corriendo"
        assert any(f"8088/proxy/{CORRIENDO}/api/v1" in u for u in y.http.calls)
    asyncio.run(main())


def test_detalle_tez(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        # Sin Timeline Server y sin la salida de beeline: una sola etapa
        d = await y.detail(TEZ)
        assert d["engine"] == "tez" and [s["name"] for s in d["stages"]] == ["DAG de Tez"]
        assert d["stages"][0]["state"] == "done" and d["trace"]["output"] == "Terminó en 18 s"
        assert d["trackingUrl"] == f"http://localhost:8088/cluster/app/{TEZ}"
        # Si lo mandó esta interfaz, el DAG sale de las líneas de avance de beeline
        lines = [{"t": 0, "stream": "stderr", "text": l} for l in fixture_text("beeline_tez.txt").splitlines()]
        run = type("R", (), {"lines": lines})()
        y.submitted[TEZ] = {"example": "hive-ventas", "run": run, "shown": "beeline -f ventas.hql",
                            "out": Y.JOBS["hive-ventas"]["out"]}
        d = await y.detail(TEZ)
        assert [s["id"] for s in d["stages"]] == ["map1", "reducer2"]
        assert [s["state"] for s in d["stages"]] == ["done", "done"]
        assert d["dag"]["vertices"][0]["operators"][0] == "TableScan"
        assert d["dag"]["edges"][0] == {"from": "map1", "to": "reducer2", "kind": "SCATTER_GATHER"}
        assert d["outputPath"] == "/user/root/resultados/hive_por_producto"
        assert d["command"] == "beeline -f ventas.hql"
    asyncio.run(main())


def test_detalle_errores(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        for bad in ("pepe", "application_1_9999"):
            with pytest.raises(ApiError) as e:
                await y.detail(bad)
            assert e.value.code == "not_found"
        d = await y.detail(KILLED)
        assert d["diagnostics"] == "Application killed by user."
        assert d["trace"]["output"] == "Cancelado: no dejó resultado"
        # La de Tez real trae diagnostics aunque terminó bien: no se muestran
        assert "diagnostics" not in await y.detail(TEZ)
    asyncio.run(main())


def test_logs(settings, tmp_path, fake_bin):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        y.http.nm = contenedores(CORRIENDO, 3)
        # Corriendo: los archivos del contenedor por el NodeManager
        r = await y.logs(CORRIENDO, None)
        assert r["container"] == f"container_{CORRIENDO[12:]}_01_000001"
        assert [c["label"] for c in r["containers"]] == ["AM (driver)", "exec 1", "exec 2"]
        assert r["files"][0] == {"name": "stdout", "lines": ["línea de stdout 1", "línea de stdout 2"]}
        # Terminado: yarn logs (los agregados en HDFS), una sola vez por contenedor
        r = await y.logs(MR, "container_1792695340081_0001_01_000001")
        assert len(r["containers"]) == 4 and r["containers"][0]["kind"] == "am"
        syslog = next(f for f in r["files"] if f["name"] == "syslog")
        assert any("Job finished cleanly" in l for l in syslog["lines"])
        await y.logs(MR, "container_1792695340081_0001_01_000001")
        cmds = fake_bin.read_text().splitlines()
        assert sum("-containerId" in c for c in cmds) == 1
        assert f"yarn logs -applicationId {MR} -containerId container_1792695340081_0001_01_000001 " \
               "-log_files stdout,stderr,syslog -size -65536" in cmds
    asyncio.run(main())


# ------------------------------------------------------------------ acciones


def test_mandar_y_cancelar(settings, tmp_path, fake_bin):
    async def main():
        cl, y, bus = make(settings, tmp_path)
        q = bus.subscribe()
        with pytest.raises(ApiError) as e:
            await y.submit("otro")
        assert e.value.code == "invalid"
        with pytest.raises(ApiError) as e:
            await y.submit("hive-ventas")      # HiveServer2 no está arriba
        assert e.value.code in ("service_down", "unsupported")
        app = await y.submit("spark-ventas")
        assert app == NUEVA
        assert y.submitted[app]["example"] == "spark-ventas"
        await y.runner.wait_all()
        cmds = fake_bin.read_text().splitlines()
        assert "spark-submit ejemplos/ventas.py" in cmds
        assert "hdfs dfs -test -e /user/root/ventas" in cmds
        assert "hdfs dfs -rm -r -f -skipTrash /user/root/resultados/spark_por_producto" in cmds
        events = []
        while not q.empty():
            events.append(q.get_nowait())
        assert ("yarn", {"appId": app}) in events
        # Cancelar uno que ya terminó no hace nada; uno corriendo, el comando real
        await y.kill(MR)
        await y.kill(CORRIENDO)
        assert f"yarn application -kill {CORRIENDO}" in fake_bin.read_text().splitlines()
        assert not any(MR in c and "-kill" in c for c in fake_bin.read_text().splitlines())
        bus.unsubscribe(q)
    asyncio.run(main())


def test_eventos_yarn_cuando_cambia_algo(settings, tmp_path):
    async def main():
        cl, y, bus = make(settings, tmp_path)
        q = bus.subscribe()
        await y.watch()
        first = []
        while not q.empty():
            first.append(q.get_nowait())
        # La primera vez solo avisa de los que están en marcha
        assert sorted(d["appId"] for t, d in first if t == "yarn") == [CORRIENDO, ACEPTADA]
        await y.watch()
        assert q.empty()
        y.http.apps[CORRIENDO]["progress"] = 55.0
        await y.watch()
        assert q.get_nowait() == ("yarn", {"appId": CORRIENDO}) and q.empty()
        bus.unsubscribe(q)
    asyncio.run(main())


# ------------------------------------------------------------------ rutas


def test_rutas_yarn(settings, tmp_path, fake_bin):
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html>")
    settings.datos_dir = tmp_path
    with TestClient(build_app(settings, ui_dir=ui)) as c:
        cl, y = c.app.state.cluster, c.app.state.yarn
        cl.phase, cl.processes = "running", up("rm", "nm")
        cl.hdfs = {**cl.hdfs, "available": True}
        y.http = Rest()
        y.http.nm = contenedores(CORRIENDO, 3)
        r = c.get("/api/yarn/apps")
        assert r.status_code == 200 and len(r.json()) == 6
        assert c.get("/api/yarn/cluster").json()["nodes"][0]["id"] == NODO
        assert c.get(f"/api/yarn/apps/{MR}").json()["engine"] == "mr"
        r = c.get("/api/yarn/apps/application_1_1")
        assert r.status_code == 404 and r.json()["code"] == "not_found"
        cont = f"container_{CORRIENDO[12:]}_01_000002"
        r = c.get(f"/api/yarn/apps/{CORRIENDO}/logs", params={"container": cont})
        assert r.json()["container"] == cont
        r = c.post("/api/yarn/apps", json={"example": "spark-ventas"})
        assert r.status_code == 202 and r.json() == {"id": NUEVA}
        r = c.post("/api/yarn/apps", json={"example": "nada"})
        assert r.status_code == 400 and r.json()["code"] == "invalid"
        assert c.post(f"/api/yarn/apps/{CORRIENDO}/kill").status_code == 204


def test_autostart(settings, tmp_path, monkeypatch):
    """AUTOSTART=1: el cluster arranca solo al levantar el servidor."""
    ui = tmp_path / "ui"
    ui.mkdir()
    settings.autostart = True
    with TestClient(build_app(settings, ui_dir=ui)) as c:
        fin = time.time() + 10
        while c.get("/api/status").json()["phase"] not in ("running", "error") and time.time() < fin:
            time.sleep(0.05)
        assert c.get("/api/status").json()["phase"] == "running"
    settings.autostart = False
    with TestClient(build_app(settings, ui_dir=ui)) as c:
        assert c.get("/api/status").json()["phase"] == "stopped"


def test_yarn_con_solo_hdfs_es_service_down(settings, tmp_path):
    """Con SERVICIOS=hdfs la interfaz muestra "falta YARN": espera service_down."""
    async def main():
        cl, y, _ = make(settings, tmp_path)
        cl.config = {**cl.config, "services": "hdfs"}
        cl.processes = []
        for llamada in (y.cluster, y.apps):
            with pytest.raises(ApiError) as e:
                await llamada()
            assert e.value.code == "service_down"
        with pytest.raises(ApiError) as e:
            await y.submit("mr-ventas")
        assert e.value.code == "service_down"
    asyncio.run(main())


def test_kill_espera_a_que_el_rm_conozca_la_app(settings, tmp_path, monkeypatch):
    """spark-submit imprime el id antes de que el RM lo acepte (visto en el humo
    real): el kill de una app que mandamos nosotros reintenta en vez de dar 404."""
    async def main():
        cl, y, _ = make(settings, tmp_path)
        nueva = "application_1792695340081_0042"
        y.submitted[nueva] = {"example": "spark-ventas"}
        llamadas = []

        async def rm_app(app_id):
            llamadas.append(app_id)
            if len(llamadas) < 3:
                raise ApiError(f"No existe el trabajo {app_id}", "not_found")
            return {"id": app_id, "state": "FINISHED"}
        monkeypatch.setattr(y, "rm_app", rm_app)
        await y.kill(nueva)
        assert len(llamadas) == 3
        # Una que no mandamos nosotros da 404 enseguida
        llamadas.clear()
        with pytest.raises(ApiError) as e:
            await y.kill("application_1792695340081_0099")
        assert e.value.code == "not_found" and len(llamadas) == 1
    asyncio.run(main())


# ------------------------------------------------------------- plantillas


class FakeHdfs:
    """Lo único que usa submit_template de Hdfs: si una ruta existe."""

    def __init__(self, *existen):
        self.existen = set(existen)

    async def status_of(self, path):
        return {"type": "FILE"} if path in self.existen else None


@pytest.fixture
def fake_hadoop(fake_bin, tmp_path):
    f = tmp_path / "fakebin" / "hadoop"
    f.write_text(f"""#!/bin/bash
printf 'hadoop' >> {fake_bin}; for a in "$@"; do printf ' [%s]' "$a" >> {fake_bin}; done; echo >> {fake_bin}
echo "INFO impl.YarnClientImpl: Submitted application {NUEVA}" >&2
echo "Map input records=4"
""")
    f.chmod(0o755)
    return fake_bin


def hadoop_args(log):
    return [l for l in log.read_text().splitlines() if l.startswith("hadoop ")] if log.exists() else []


def test_lista_de_plantillas():
    ids = [t["id"] for t in Y.TEMPLATES]
    assert ids == ["mr-wordcount", "mr-pi", "mr-grep", "mr-ventas", "hive-ventas", "spark-pi", "spark-ventas"]
    for t in Y.TEMPLATES:
        assert t["engine"] in ("mr", "tez", "spark") and t["needs"] and t["description"]
        for p in t["params"]:
            assert "{" + p["name"] + "}" in t["command"] or p["type"] == "bool"
    pi = Y.TEMPLATE["mr-pi"]["params"]
    assert [(p["min"], p["max"]) for p in pi] == [(1, 16), (10, 100000)]
    assert Y.TEMPLATE["mr-grep"]["params"][2]["pattern"] == r"^[\w\s.\-\[\]\\]{1,64}$"


def test_validar_parametros():
    v = Y.validate_params(Y.TEMPLATE["mr-pi"], {"maps": "8", "samples": 500})
    assert v == {"maps": 8, "samples": 500}
    assert Y.validate_params(Y.TEMPLATE["mr-pi"], {}) == {"maps": 4, "samples": 1000}
    v = Y.validate_params(Y.TEMPLATE["mr-wordcount"], {"in": "user//root/texto.txt", "out": "/tmp/wc/", "overwrite": "false"})
    assert v == {"in": "/user/root/texto.txt", "out": "/tmp/wc", "overwrite": False}


@pytest.mark.parametrize("tid,params", [
    ("mr-pi", {"maps": 0}), ("mr-pi", {"maps": 17}), ("mr-pi", {"samples": 9}), ("mr-pi", {"samples": 100001}),
    ("mr-pi", {"maps": "4; rm -rf /"}), ("mr-pi", {"maps": True}), ("mr-pi", {"maps": 2.5}),
    ("mr-pi", {"otro": 1}), ("mr-pi", ["maps", 4]),
    ("spark-pi", {"partitions": 0}), ("spark-pi", {"partitions": 99}),
    ("mr-grep", {"regex": "a; touch /tmp/x"}), ("mr-grep", {"regex": "$(id)"}), ("mr-grep", {"regex": "`id`"}),
    ("mr-grep", {"regex": "a|b"}), ("mr-grep", {"regex": "x" * 65}), ("mr-grep", {"regex": "-Dfs.defaultFS"}),
    ("mr-grep", {"regex": "a\nb"}), ("mr-grep", {"regex": 5}),
    ("mr-wordcount", {"out": "/"}), ("mr-wordcount", {"out": "/user/root"}), ("mr-wordcount", {"out": "/etc/x"}),
    ("mr-wordcount", {"out": "/user/root/../../etc"}), ("mr-wordcount", {"in": "/user/root/d", "out": "/user/root/d"}),
    ("mr-wordcount", {"in": "/user/root/d", "out": "/user/root/d/salida"}),
    ("mr-wordcount", {"in": "/user/root/d/x", "out": "/user/root/d"}),
    ("mr-wordcount", {"in": "/x\0"}), ("mr-wordcount", {"in": ["/x"]}), ("mr-wordcount", {"overwrite": "quizás"}),
])
def test_inyeccion_y_rangos(tid, params):
    with pytest.raises(ApiError) as e:
        Y.validate_params(Y.TEMPLATE[tid], params)
    assert e.value.code == "invalid"


def test_defaults_validos():
    for t in Y.TEMPLATES:
        Y.validate_params(t, {})


def test_grep_regex_permitida():
    for ok in ("datos", "[a-z]+".replace("+", ""), r"\w\w\s", "a.b-c", "[A-Z][a-z]"):
        assert Y.validate_params(Y.TEMPLATE["mr-grep"], {"regex": ok})["regex"] == ok


def test_argv_sin_shell():
    argv, shown = Y.template_argv("mr-wordcount", {"in": "/user/root/a b.txt", "out": "/tmp/o", "overwrite": True})
    assert argv[:2] == ["hadoop", "jar"] and argv[2].endswith(".jar") and argv[3:] == ["wordcount", "/user/root/a b.txt", "/tmp/o"]
    assert shown == "hadoop jar hadoop-mapreduce-examples-3.3.6.jar wordcount '/user/root/a b.txt' /tmp/o"
    argv, shown = Y.template_argv("spark-pi", {"partitions": 3})
    assert argv[0] == "spark-submit" and argv[-1] == "3" and "SparkPi" in shown


def test_mandar_wordcount(settings, tmp_path, fake_hadoop):
    async def main():
        cl, y, bus = make(settings, tmp_path)
        (cl.s.datos_dir / "ejemplos").mkdir()
        (cl.s.datos_dir / "ejemplos" / "texto.txt").write_text("hola mundo\n")
        y.hdfs = FakeHdfs("/user/root/resultados/wordcount")
        app = await y.submit_template("mr-wordcount", {})
        assert app == NUEVA
        await y.runner.wait_all()
        cmds = fake_hadoop.read_text().splitlines()
        # Sube el texto de ejemplo (no estaba) y borra la salida anterior (overwrite por defecto)
        assert f"hdfs dfs -put -f {cl.s.datos_dir}/ejemplos/texto.txt /user/root/texto.txt" in cmds
        assert "hdfs dfs -rm -r -f -skipTrash /user/root/resultados/wordcount" in cmds
        args = hadoop_args(fake_hadoop)[-1]
        assert args.endswith("[wordcount] [/user/root/texto.txt] [/user/root/resultados/wordcount]")
        sub = y.submitted[app]
        assert sub["template"] == "mr-wordcount" and sub["out"] == "/user/root/resultados/wordcount"
        assert sub["shown"].startswith("hadoop jar hadoop-mapreduce-examples-3.3.6.jar wordcount")
        assert any("Map input records" in l["text"] for l in sub["run"].lines)
        # La salida del comando (con los contadores) se ve como un "contenedor" más de los logs
        y.http.apps[app] = {"id": app, "state": "FINISHED", "finalStatus": "SUCCEEDED", "applicationType": "MAPREDUCE"}
        r = await y.logs(app, "cliente")
        assert r["container"] == "cliente" and r["containers"][0]["id"] == "cliente"
        assert any("Map input records" in l for l in r["files"][0]["lines"])
    asyncio.run(main())


def test_mandar_grep_con_caracteres_raros(settings, tmp_path, fake_hadoop):
    async def main():
        cl, y, bus = make(settings, tmp_path)
        y.hdfs = FakeHdfs("/user/root/d")
        await y.submit_template("mr-grep", {"in": "/user/root/d", "out": "/user/root/g", "regex": r"[a-z] \w"})
        await y.runner.wait_all()
        # La regex llega como un solo argumento, tal cual
        assert hadoop_args(fake_hadoop)[-1].endswith(r"[grep] [/user/root/d] [/user/root/g] [[a-z] \w]")
        assert "hdfs dfs -mkdir -p /user/root" in fake_hadoop.read_text().splitlines()
    asyncio.run(main())


def test_salida_que_no_se_puede_borrar(settings, tmp_path, fake_hadoop):
    async def main():
        cl, y, bus = make(settings, tmp_path)
        y.hdfs = FakeHdfs("/user/root/d")
        for out in ("/user/root", "/user", "/", "/tmp", "/user/root/../..", "/user/root/d", "/user"):
            with pytest.raises(ApiError) as e:
                await y.submit_template("mr-wordcount", {"in": "/user/root/d/x.txt", "out": out})
            assert e.value.code == "invalid", out
        await y.runner.wait_all()
        assert not fake_hadoop.exists() or "-rm" not in fake_hadoop.read_text()
    asyncio.run(main())


def test_plantilla_errores(settings, tmp_path, fake_hadoop):
    async def main():
        cl, y, bus = make(settings, tmp_path)
        y.hdfs = FakeHdfs("/user/root/d", "/user/root/sal")
        with pytest.raises(ApiError) as e:
            await y.submit_template("rm -rf", {})
        assert e.value.code == "invalid"
        with pytest.raises(ApiError) as e:
            await y.submit_template("mr-wordcount", {"in": "/user/root/nada", "out": "/user/root/o"})
        assert e.value.code == "not_found"
        with pytest.raises(ApiError) as e:
            await y.submit_template("mr-wordcount", {"in": "/user/root/d", "out": "/user/root/sal", "overwrite": False})
        assert e.value.code == "invalid"
        cl.processes = up("rm")
        with pytest.raises(ApiError) as e:
            await y.submit_template("mr-pi", {})
        assert e.value.code == "service_down"
        assert hadoop_args(fake_hadoop) == []
    asyncio.run(main())


def test_ruta_plantillas(settings, tmp_path, fake_hadoop):
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html>")
    with TestClient(build_app(settings, ui_dir=ui)) as c:
        app = c.app
        cl, y = app.state.cluster, app.state.yarn
        assert y.hdfs is app.state.hdfs
        r = c.get("/api/yarn/templates")
        assert r.status_code == 200 and r.json()[1]["id"] == "mr-pi"
        cl.phase, cl.config = "running", {**cl.config, **BASE}
        cl.hdfs = {**cl.hdfs, "available": True}
        cl.processes = up("rm", "nm", "jh")
        y.http = Rest()
        r = c.post("/api/yarn/apps", json={"template": "mr-pi", "params": {"maps": 2, "samples": 100}})
        assert r.status_code == 202 and r.json() == {"id": NUEVA}
        r = c.post("/api/yarn/apps", json={"template": "mr-pi", "params": {"maps": 200}})
        assert r.status_code == 400 and r.json()["code"] == "invalid"
