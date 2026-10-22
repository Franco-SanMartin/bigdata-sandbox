import json
import sys
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER))

FIX = Path(__file__).resolve().parent / "fixtures"
FALSO = FIX / "entrypoint_falso.sh"

BASE = {"datanodes": 2, "replication": 2, "blockSize": "1m", "namenodes": 1, "services": "todo",
        "mongodb": False, "jupyter": True, "pigHeapsize": 512}


def fixture_text(name: str) -> str:
    return (FIX / name).read_text()


def fsck_con_bloque_perdido() -> str:
    """No hay salida real de un bloque perdido: se arma desde fsck.txt (real) con
    el formato de Hadoop 3.3 (el archivo con MISSING, el bloque con MISSING! y el
    resumen CORRUPT)."""
    texto = fixture_text("fsck.txt").replace(
        "/user/root/humo/humo.csv 1068911 bytes, replicated: replication=2, 2 block(s):  OK",
        "/user/root/humo/humo.csv 1068911 bytes, replicated: replication=2, 2 block(s):  MISSING 1 blocks of total size 20335 B")
    lineas = []
    for l in texto.splitlines():
        if "blk_1073741826_1002 len=" in l:
            l = l.split(" Live_repl")[0] + " MISSING!"
        elif l.startswith(" Missing blocks:"):
            l = " Missing blocks:\t\t1"
        elif l == "Status: HEALTHY":
            l = "Status: CORRUPT"
        elif l.startswith("The filesystem under path"):
            l = "The filesystem under path '/' is CORRUPT"
        lineas.append(l)
    return "\n".join(lineas) + "\n"


def fixture_json(name: str) -> dict:
    return json.loads(fixture_text(name))


@pytest.fixture
def settings(tmp_path, monkeypatch):
    """Settings de un cluster que corre el entrypoint falso y no sondea nada real."""
    from sandbox_server.cluster import Settings
    vol = tmp_path / "hadoop"
    vol.mkdir()
    monkeypatch.setenv("FALSO_VOLUMEN", str(vol))
    monkeypatch.setenv("FALSO_TRAZA", str(tmp_path / "traza.txt"))
    monkeypatch.setenv("FALSO_PAUSA", "0.02")
    return Settings(entrypoint=["bash", str(FALSO)], hadoop_dir=vol, bin_dir=tmp_path / "bin",
                    proc_dir=tmp_path / "proc", probe=False, stop_timeout=5)


@pytest.fixture
def mundo(settings, tmp_path, monkeypatch):
    """Cluster 'en marcha' con las CLIs falsas de falsos.py: HDFS es una carpeta,
    Hive, MySQL y MongoDB son archivos, y los jobs de pandas son de mentira.
    Devuelve un objeto con cl, bus, runner, hdfs, datos, ml, pipeline y fs (la carpeta de HDFS)."""
    import types

    import falsos
    from sandbox_server import datos as datos_mod, ml as ml_mod, pipeline as pipeline_mod
    from sandbox_server.actions import ActionRunner
    from sandbox_server.cluster import Cluster
    from sandbox_server.events import EventBus
    from sandbox_server.hdfs import Hdfs

    datos = tmp_path / "datos"
    datos.mkdir(exist_ok=True)
    settings.datos_dir = datos
    http = falsos.instalar(tmp_path, monkeypatch)
    falsos.ejemplos_falsos(datos)
    jobs = falsos.jobs_falsos(tmp_path / "jobs")
    monkeypatch.setattr(pipeline_mod, "JOBS", jobs)
    monkeypatch.setattr(ml_mod, "JOBS", jobs)
    monkeypatch.setattr(pipeline_mod.Pipeline, "every", 0.02)
    monkeypatch.setattr(ml_mod.Ml, "every", 0.02)
    monkeypatch.setenv("SANDBOX_SQOOP_PASS", "clave-de-prueba")
    monkeypatch.setenv("FALSO_SQOOP_PASS", "clave-de-prueba")
    # clientes_senal.csv chico: así train no lo genera
    (datos / "clientes_senal.csv").write_text(
        "antiguedad_meses,visitas_mes,ticket_promedio,reclamos,edad,segmento_real,gasto_mes_siguiente,vuelve\n"
        + "".join(f"{1 + i % 60},{1 + i % 8},{1000 + 37 * i},{i % 4},{20 + i % 50},frecuente,{20000 + i},{i % 2}\n"
                  for i in range(100)))
    bus = EventBus()
    runner = ActionRunner(bus)
    cl = Cluster(bus, runner, settings)
    cl.phase = "running"
    cl.config = {**cl.config, **BASE, "mongodb": True}
    cl.hdfs = {**cl.hdfs, "available": True}
    cl.nn_active_port = 9870
    cl.processes = [{"id": i, "kind": "x", "name": i, "layer": "x", "state": "up", "ports": [], "controllable": True}
                    for i in ("nn", "dn1", "rm", "nm", "hiveserver2", "metastore", "mysql", "mongodb")]
    h = Hdfs(cl, runner, bus)
    h.http = http
    d = datos_mod.Datos(cl, runner, bus, h)
    m = ml_mod.Ml(cl, runner, bus, h)
    p = pipeline_mod.Pipeline(cl, runner, bus, h, d, m)
    return types.SimpleNamespace(cl=cl, bus=bus, runner=runner, hdfs=h, datos=d, ml=m, pipeline=p,
                                 fs=tmp_path / "falso" / "hdfs", base=tmp_path / "falso", dir=datos)
