"""Seguimiento del arranque a partir de la salida del entrypoint."""
import os
import subprocess

from conftest import BASE, FALSO
from sandbox_server import config as cfg
from sandbox_server.boot import BootTracker, Volume, plan

C = "\033[1;36m[sandbox]\033[0m "


def salida_falsa(tmp_path, config, **extra):
    env = {**os.environ, **cfg.to_env(config), "FALSO_PAUSA": "0", "FALSO_VOLUMEN": str(tmp_path), **extra}
    # Sin la parte final que queda siguiendo los logs
    r = subprocess.run(["bash", "-c", f"bash {FALSO} 2>&1 | sed '/Cluster LISTO/q'"], env=env, capture_output=True,
                       text=True, timeout=20)
    return r.stdout.splitlines(keepends=True)


def estados(t):
    return {s.id: s.state for s in t.steps}


def test_primer_arranque_completo(tmp_path):
    t = BootTracker(plan(BASE, Volume.read(tmp_path)), "first")
    eventos = [e for e in (t.feed(l) for l in salida_falsa(tmp_path, BASE)) if e]
    assert eventos == ["fmt", "nn", "dn", "dirs", "yarn", "mysql", "libs", "hive", "jupyter", "ready"]
    assert t.ready and t.finishedAt
    assert set(estados(t).values()) == {"done"}
    # La línea de log de Hadoop queda en el paso en el que salió
    fmt = next(s for s in t.steps if s.id == "fmt")
    assert any("Allocated new BlockPoolId" in l["text"] for l in fmt.log)
    assert all("\033" not in l["text"] for s in t.steps for l in s.log)


def test_reinicio_saltea_lo_hecho(tmp_path):
    (tmp_path / "dfs/name/current").mkdir(parents=True)
    (tmp_path / "formateado").touch()
    (tmp_path / ".libs-hdfs").touch()
    vol = Volume.read(tmp_path)
    steps = plan(BASE, vol)
    assert next(s for s in steps if s.id == "fmt").skipReason == "el volumen ya tiene datos"
    t = BootTracker(steps, "restart")
    for l in salida_falsa(tmp_path, BASE):
        t.feed(l)
    e = estados(t)
    assert e["fmt"] == "skipped" and e["nn"] == "done"
    # El falso igual "sube librerías": un paso que se esperaba saltear y corre queda hecho
    assert e["libs"] == "done"
    # Spark no tiene mensaje propio: arranca junto con Hive
    assert e["spark"] == "done"


def test_solo_hdfs_y_alta_disponibilidad(tmp_path):
    c = {**BASE, "services": "hdfs", "namenodes": 3, "jupyter": False}
    t = BootTracker(plan(c, Volume.read(tmp_path)), "first")
    assert [s.id for s in t.steps] == ["zk", "fmt", "nn", "dn", "dirs", "ui"]
    for l in salida_falsa(tmp_path, c):
        t.feed(l)
    assert t.ready and set(estados(t).values()) == {"done"}


def test_error_de_parametros(tmp_path):
    t = BootTracker(plan(BASE, Volume.read(tmp_path)), "first")
    evs = [t.feed(l) for l in salida_falsa(tmp_path, BASE, FALSO_FALLA="parametros")]
    assert "failed" in evs
    assert t.failed == "DATANODES=2: tiene que ser un numero de 1 a 9"
    assert not t.ready


def test_aviso_y_lineas_previas_van_al_primer_paso(tmp_path):
    t = BootTracker(plan(BASE, Volume.read(tmp_path)), "first")
    t.feed(C + "AVISO: este volumen se creo con 1 NameNode(s) y ahora NAMENODES vale 3\n")
    t.feed("WARNING: HADOOP_PREFIX has been replaced by HADOOP_HOME\n")
    assert t.current is None
    assert t.feed(C + "Primer arranque: formateando NameNode...\n") == "fmt"
    log = next(s for s in t.steps if s.id == "fmt").log
    assert [l["level"] for l in log] == ["WARN", "WARN", "INFO"]


def test_fallo_a_mitad_marca_el_paso(tmp_path):
    t = BootTracker(plan(BASE, Volume.read(tmp_path)), "first")
    for l in salida_falsa(tmp_path, BASE, FALSO_FALLA="hdfs"):
        t.feed(l)
    assert not t.ready
    t.fail("el arranque terminó con código 1")
    e = estados(t)
    assert e["dn"] == "failed" and e["dirs"] == "pending"
    dn = next(s for s in t.steps if s.id == "dn")
    assert dn.log[-1]["level"] == "ERROR"


def test_to_json_tiene_la_forma_del_contrato(tmp_path):
    t = BootTracker(plan(BASE, Volume.read(tmp_path)), "first")
    d = t.to_json()
    assert set(d) == {"kind", "steps", "startedAt", "expectedSec"}
    s = d["steps"][0]
    assert {"id", "name", "state", "description", "commands", "processes", "expectedSec", "log"} <= set(s)


def test_paso_fuera_del_plan_no_rompe(tmp_path):
    # El entrypoint arranca JupyterLab aunque el plan no lo tenga (no está instalado)
    t = BootTracker(plan({**BASE, "jupyter": False}, Volume.read(tmp_path)), "first")
    assert "jupyter" not in {s.id for s in t.steps}
    eventos = [e for e in (t.feed(l) for l in salida_falsa(tmp_path, BASE)) if e]
    assert "jupyter" not in eventos and eventos[-1] == "ready"
    assert t.ready
