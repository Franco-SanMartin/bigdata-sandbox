"""YARN: ResourceManager, NodeManager, JobHistory y Spark History simulados con
las fixtures; 'yarn' y 'spark-submit' falsos en el PATH."""
import asyncio
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

MR = "application_1792041277726_0001"
TEZ = "application_1792041277726_0002"
SPARK = "application_1792041277726_0003"
KILLED = "application_1792041277726_0004"


class Rest:
    """Responde como los servicios de YARN: URL -> fixture."""

    def __init__(self):
        self.calls: list[str] = []
        self.down: set[str] = set()      # 'host:puerto' que no contestan
        apps = Y.json.loads(fixture_text("rm_apps.json"))["apps"]["app"]
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
            "localhost:8088/conf": "rm_conf.json",
            "localhost:8042/ws/v1/node/containers": "nm_containers.json",
            f"localhost:19888/ws/v1/history/mapreduce/jobs/job_1792041277726_0001/tasks": "jhs_tasks.json",
            f"localhost:19888/ws/v1/history/mapreduce/jobs/job_1792041277726_0001/counters": "jhs_counters.json",
            f"localhost:8088/proxy/{SPARK}/api/v1/applications/{SPARK}/stages": "shs_stages.json",
            f"localhost:8088/proxy/{SPARK}/api/v1/applications/{SPARK}/jobs": "shs_jobs.json",
        }
        if u.netloc + p == "localhost:8088/ws/v1/cluster/apps":
            return 200, Y.json.dumps({"apps": {"app": list(self.apps.values())}}).encode()
        name = files.get(u.netloc + p)
        if name:
            return 200, (FIX / name).read_bytes()
        if u.netloc == "localhost:8088" and p.startswith("/ws/v1/cluster/apps/"):
            a = self.apps.get(p.rsplit("/", 1)[1])
            if a is None:
                return 404, b'{"RemoteException":{"exception":"NotFoundException"}}'
            return 200, Y.json.dumps({"app": a}).encode()
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
echo "INFO Client: Submitted application application_1792041277726_0009"
sleep 0.2
echo "INFO Client: Application report for application_1792041277726_0009 (state: FINISHED)" """,
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
    assert Y.app_of_container("container_e05_1792041277726_0003_01_000002") == SPARK
    assert Y.container_label("container_1792041277726_0003_01_000001", "SPARK") == "AM (driver)"
    assert Y.container_label("container_1792041277726_0003_01_000003", "SPARK") == "exec 2"
    assert Y.container_label("container_1792041277726_0001_01_000004", "MAPREDUCE") == "contenedor 3"
    assert Y.level_of("2026 WARN algo") == "WARN" and Y.level_of("java.io.IOException: ERROR") == "ERROR"
    assert Y.level_of("Map 1: 6/6 0 FAILED") == "INFO"


def test_avance_de_tez_de_beeline():
    v = Y.parse_tez_progress(fixture_text("beeline_tez.txt").splitlines())
    assert [x["name"] for x in v] == ["Map 1", "Reducer 2", "Reducer 3"]
    assert v[0] == {"name": "Map 1", "total": 6, "done": 6, "running": 0}
    assert Y.parse_tez_progress(["INFO  : Map 1: 0(+3)/6\tReducer 2: 0/2"])[0]["running"] == 3
    assert Y.parse_tez_progress(["nada que ver"]) == []


def test_logs_agregados():
    files = Y.parse_yarn_logs(fixture_text("yarn_logs.txt"))
    assert files["stdout"] == [""] or files["stdout"] == []
    assert files["syslog"][0].startswith("2026-10-22 14:03:21,612 INFO")
    assert "Job finished cleanly" in files["syslog"][-1]
    ids = Y.parse_log_containers(fixture_text("yarn_logs_info.txt"))
    assert ids == ["container_1792041277726_0001_01_000001", "container_1792041277726_0001_01_000002",
                   "container_1792041277726_0001_01_000008"]


# ------------------------------------------------------------------ consultas


def test_lista_de_trabajos(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        apps = await y.apps()
        assert [a["id"][-4:] for a in apps] == ["0005", "0004", "0003", "0002", "0001"]
        by = {a["id"]: a for a in apps}
        s = by[SPARK]
        assert s["state"] == "RUNNING" and s["progress"] == 0.1 and s["type"] == "SPARK"
        assert [c["label"] for c in s["containers"]] == ["AM (driver)", "exec 1", "exec 2"]
        assert s["amMemoryMb"] == 1024 and s["startedAt"] == 1792041601000
        assert by[KILLED]["state"] == "KILLED" and by[KILLED]["log"][-1]["level"] == "ERROR"
        assert "killed by user" in by[KILLED]["log"][-1]["text"]
        assert by[MR]["progress"] == 1.0 and by[MR]["containers"] == [] and by[MR]["finishedAt"] == 1792041431000
        assert by["application_1792041277726_0005"]["state"] == "ACCEPTED"
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
        assert c["totalMb"] == 4096 and c["minAllocationMb"] == 512 and c["maxAllocationMb"] == 4096
        n = c["nodes"][0]
        assert n["id"] == "localhost:45454" and n["memTotalMb"] == 4096 and n["memUsedMb"] == 3072
        assert {x["appId"] for x in n["containers"]} == {SPARK}
        assert [x["kind"] for x in n["containers"]] == ["am", "executor", "executor"]
        assert c["queues"] == [{"name": "default", "capacity": 100.0, "usedMb": 3072, "running": 1, "pending": 1}]
    asyncio.run(main())


def test_detalle_mapreduce_de_jobhistory(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        d = await y.detail(MR)
        assert d["engine"] == "mr" and d["state"] == "FINISHED"
        assert [s["id"] for s in d["stages"]] == ["map", "reduce"]
        assert len(d["stages"][0]["tasks"]) == 6 and len(d["stages"][1]["tasks"]) == 1
        assert d["stages"][1]["dependsOn"] == ["map"]
        m = d["dag"]["vertices"][0]
        assert m["recordsIn"] == 200001 and m["tasksDone"] == 6 and m["bytesReadMb"] == 5.931868
        assert d["dag"]["edges"] == [{"from": "map", "to": "reduce", "kind": "shuffle + sort"}]
        assert {"group": "YARN", "name": "TASKS_DONE", "value": 7} in d["counters"]
        assert d["trackingUrl"] == "http://localhost:19888/jobhistory/job/job_1792041277726_0001"
        assert d["trace"]["output"] == "Terminó en 31 s · 8 filas"
        assert any("19888/ws/v1/history/mapreduce/jobs/job_1792041277726_0001/tasks" in u for u in y.http.calls)
    asyncio.run(main())


def test_detalle_spark_corriendo(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        y.http.down.add("localhost:4040")     # el driver no contesta: va por el proxy del RM
        d = await y.detail(SPARK)
        assert d["engine"] == "spark" and d["state"] == "RUNNING"
        ids = [s["id"] for s in d["stages"]]
        assert ids == ["s1", "s2", "s3"]
        s3 = d["stages"][2]
        assert s3["dependsOn"] == ["s2"] and s3["state"] == "running"
        assert [t["state"] for t in s3["tasks"]].count("done") == 2
        assert [t["state"] for t in s3["tasks"]].count("running") == 2
        v2 = d["dag"]["vertices"][1]
        assert v2["recordsIn"] == 200001 and v2["startedAt"] > 0
        assert d["trackingUrl"] == f"http://localhost:8088/proxy/{SPARK}/"
        assert d["trace"]["output"] == "Todavía corriendo"
    asyncio.run(main())


def test_detalle_tez(settings, tmp_path):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        # Sin Timeline Server y sin la salida de beeline: una sola etapa
        d = await y.detail(TEZ)
        assert d["engine"] == "tez" and [s["name"] for s in d["stages"]] == ["DAG de Tez"]
        assert d["stages"][0]["state"] == "done"
        # Si lo mandó esta interfaz, el DAG sale de las líneas de avance de beeline
        lines = [{"t": 0, "stream": "stderr", "text": l} for l in fixture_text("beeline_tez.txt").splitlines()]
        run = type("R", (), {"lines": lines})()
        y.submitted[TEZ] = {"example": "hive-ventas", "run": run, "shown": "beeline -f ventas.hql",
                            "out": Y.JOBS["hive-ventas"]["out"]}
        d = await y.detail(TEZ)
        assert [s["id"] for s in d["stages"]] == ["map1", "reducer2", "reducer3"]
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
    asyncio.run(main())


def test_logs(settings, tmp_path, fake_bin):
    async def main():
        cl, y, _ = make(settings, tmp_path)
        # Corriendo: los archivos del contenedor por el NodeManager
        r = await y.logs(SPARK, None)
        assert r["container"] == "container_1792041277726_0003_01_000001"
        assert [c["label"] for c in r["containers"]] == ["AM (driver)", "exec 1", "exec 2"]
        assert r["files"][0] == {"name": "stdout", "lines": ["línea de stdout 1", "línea de stdout 2"]}
        # Terminado: yarn logs (los agregados en HDFS), una sola vez por contenedor
        r = await y.logs(MR, "container_1792041277726_0001_01_000001")
        assert len(r["containers"]) == 3 and r["containers"][0]["kind"] == "am"
        syslog = next(f for f in r["files"] if f["name"] == "syslog")
        assert "Job finished cleanly" in syslog["lines"][-1]
        await y.logs(MR, "container_1792041277726_0001_01_000001")
        cmds = fake_bin.read_text().splitlines()
        assert sum("-containerId" in c for c in cmds) == 1
        assert f"yarn logs -applicationId {MR} -containerId container_1792041277726_0001_01_000001 " \
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
        assert app == "application_1792041277726_0009"
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
        await y.kill(SPARK)
        assert f"yarn application -kill {SPARK}" in fake_bin.read_text().splitlines()
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
        assert sorted(d["appId"] for t, d in first if t == "yarn") == [SPARK, "application_1792041277726_0005"]
        await y.watch()
        assert q.empty()
        y.http.apps[SPARK]["progress"] = 55.0
        await y.watch()
        assert q.get_nowait() == ("yarn", {"appId": SPARK}) and q.empty()
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
        r = c.get("/api/yarn/apps")
        assert r.status_code == 200 and len(r.json()) == 5
        assert c.get("/api/yarn/cluster").json()["nodes"][0]["id"] == "localhost:45454"
        assert c.get(f"/api/yarn/apps/{MR}").json()["engine"] == "mr"
        r = c.get("/api/yarn/apps/application_1_1")
        assert r.status_code == 404 and r.json()["code"] == "not_found"
        r = c.get(f"/api/yarn/apps/{SPARK}/logs", params={"container": "container_1792041277726_0003_01_000002"})
        assert r.json()["container"] == "container_1792041277726_0003_01_000002"
        r = c.post("/api/yarn/apps", json={"example": "spark-ventas"})
        assert r.status_code == 202 and r.json() == {"id": "application_1792041277726_0009"}
        r = c.post("/api/yarn/apps", json={"example": "nada"})
        assert r.status_code == 400 and r.json()["code"] == "invalid"
        assert c.post(f"/api/yarn/apps/{SPARK}/kill").status_code == 204


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
