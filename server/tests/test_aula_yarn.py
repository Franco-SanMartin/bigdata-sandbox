"""YARN en vivo en el aula (versión empresa, en el maestro): las colas por grupo de alumnos (con la forma real de
/ws/v1/cluster/scheduler de Hadoop 3.3.6, fixtures/rm_scheduler.json), el capacity-scheduler.xml que se escribe
al armar los grupos, la localidad de cada tarea y el botón «medir» de la escala."""
import copy
import json
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from conftest import fixture_json
from sandbox_server import aula_yarn as ay
from sandbox_server.errors import ApiError


# ------------------------------------------------------------------ colas

def hoja(nombre, cap, usada, mb=0, vcores=0, apps=0, pend=0, conts=0, maxima=100.0, estado="RUNNING"):
    """Una cola hoja con la forma real (la de fixtures/rm_scheduler.json) y otros números."""
    q = copy.deepcopy(fixture_json("rm_scheduler.json")["scheduler"]["schedulerInfo"]["queues"]["queue"][0])
    q.update({"queueName": nombre, "capacity": cap, "absoluteCapacity": cap, "absoluteMaxCapacity": maxima,
              "maxCapacity": maxima, "absoluteUsedCapacity": usada, "numActiveApplications": apps,
              "numPendingApplications": pend, "numApplications": apps + pend, "numContainers": conts,
              "state": estado})
    q["resourcesUsed"].update({"memory": mb, "vCores": vcores})
    return q


def scheduler(*colas):
    doc = fixture_json("rm_scheduler.json")
    doc["scheduler"]["schedulerInfo"]["queues"]["queue"] = list(colas)
    return doc


def test_colas_del_fixture_real():
    assert ay.colas(fixture_json("rm_scheduler.json")) == [
        {"nombre": "default", "estado": "RUNNING", "capacidad": 100.0, "maxima": 100.0, "usada": 0.0,
         "mb": 0, "vcores": 0, "apps": 0, "pendientes": 0, "contenedores": 0}]


def test_colas_por_grupo_y_anidadas():
    padre = {"queueName": "alumnos", "capacity": 66.0, "queues": {"queue": [hoja("grupo1", 33.0, 50.0, 2048, 2, 1, 1, 2)]}}
    doc = scheduler(hoja("default", 34.0, 0.0), padre, hoja("viejo", 0.0, 0.0, estado="STOPPED"))
    c = ay.colas(doc)
    assert [x["nombre"] for x in c] == ["default", "grupo1", "viejo"]
    g = c[1]
    assert (g["capacidad"], g["usada"], g["mb"], g["vcores"], g["apps"], g["pendientes"], g["contenedores"]) == \
        (33.0, 50.0, 2048, 2, 1, 1, 2)
    assert c[2]["estado"] == "STOPPED"


@pytest.mark.parametrize("malo", [None, {}, {"scheduler": None}, {"scheduler": {"schedulerInfo": {"queues": None}}}])
def test_colas_sin_scheduler(malo):
    assert ay.colas(malo) == []


# Lo que trae Hadoop 3.3.6 en etc/hadoop/capacity-scheduler.xml (recortado) + lo que pone lib.sh en el maestro
CAPACITY = """<?xml version="1.0"?>
<configuration>
  <property><name>yarn.scheduler.capacity.maximum-applications</name><value>10000</value></property>
  <property><name>yarn.scheduler.capacity.maximum-am-resource-percent</name><value>0.1</value></property>
  <property><name>yarn.scheduler.capacity.resource-calculator</name>
    <value>org.apache.hadoop.yarn.util.resource.DominantResourceCalculator</value></property>
  <property><name>yarn.scheduler.capacity.root.queues</name><value>default</value></property>
  <property><name>yarn.scheduler.capacity.root.default.capacity</name><value>100</value></property>
  <property><name>yarn.scheduler.capacity.root.default.user-limit-factor</name><value>1</value></property>
  <property><name>yarn.scheduler.capacity.root.default.maximum-capacity</name><value>100</value></property>
  <property><name>yarn.scheduler.capacity.root.default.state</name><value>RUNNING</value></property>
</configuration>
"""
P = "yarn.scheduler.capacity.root."


def props(f):
    return {p.findtext("name"): p.findtext("value") for p in ET.parse(f).getroot().findall("property")}


def test_validar_grupos():
    assert ay.validar_grupos({"grupos": ["grupo1", " Grupo2 "]}) == ["grupo1", "grupo2"]
    assert ay.validar_grupos({"grupos": []}) == []
    for malo in (None, [], {}, {"grupos": "g1"}, {"grupos": ["default"]}, {"grupos": ["root"]}, {"grupos": ["g1", "g1"]},
                 {"grupos": ["g 1"]}, {"grupos": ["g.1"]}, {"grupos": ["-x"]}, {"grupos": [""]}, {"grupos": [1]},
                 {"grupos": ["x" * 21]}, {"grupos": [f"g{i}" for i in range(9)]}):
        with pytest.raises(ApiError) as e:
            ay.validar_grupos(malo)
        assert e.value.code == "invalid", malo


def test_escribir_colas_reparte_y_para_las_que_se_sacan(tmp_path):
    f = tmp_path / "capacity-scheduler.xml"
    f.write_text(CAPACITY)
    r = ay.escribir_colas(f, ["grupo1", "grupo2"])
    assert r == {"grupos": ["grupo1", "grupo2"], "paradas": []}
    p = props(f)
    assert p[P + "queues"] == "default,grupo1,grupo2"
    assert [p[P + q + ".capacity"] for q in ("default", "grupo1", "grupo2")] == ["34", "33", "33"]
    for q in ("default", "grupo1", "grupo2"):
        # Cada grupo puede usar lo que el resto no usa (y un solo usuario —root— llena la cola)
        assert p[P + q + ".maximum-capacity"] == "100" and p[P + q + ".state"] == "RUNNING"
        assert p[P + q + ".user-limit-factor"] == "100"
        assert p[P + q + ".maximum-am-resource-percent"] == "0.5"
    # Lo demás queda como estaba
    assert p["yarn.scheduler.capacity.resource-calculator"].endswith("DominantResourceCalculator")
    assert p["yarn.scheduler.capacity.maximum-applications"] == "10000"
    # Sacar grupo1: YARN no borra una cola en caliente si no está parada; queda STOPPED y con 0
    r = ay.escribir_colas(f, ["grupo2", "grupo3"])
    assert r == {"grupos": ["grupo2", "grupo3"], "paradas": ["grupo1"]}
    p = props(f)
    assert p[P + "queues"] == "default,grupo1,grupo2,grupo3"
    assert (p[P + "grupo1.capacity"], p[P + "grupo1.state"]) == ("0", "STOPPED")
    assert [p[P + q + ".capacity"] for q in ("default", "grupo2", "grupo3")] == ["34", "33", "33"]
    # Volver a sumarlo lo arranca; sin grupos, todo a default
    assert ay.escribir_colas(f, ["grupo1"])["paradas"] == ["grupo2", "grupo3"]
    assert props(f)[P + "grupo1.state"] == "RUNNING"
    ay.escribir_colas(f, [])
    p = props(f)
    assert p[P + "default.capacity"] == "100" and all(p[P + q + ".capacity"] == "0" for q in ("grupo1", "grupo2", "grupo3"))
    assert sum(float(p[P + q + ".capacity"]) for q in p[P + "queues"].split(",")) == 100


def test_escribir_colas_siete_grupos_suma_100(tmp_path):
    f = tmp_path / "capacity-scheduler.xml"
    f.write_text(CAPACITY)
    grupos = [f"g{i}" for i in range(1, 8)]
    ay.escribir_colas(f, grupos)
    p = props(f)
    assert p[P + "default.capacity"] == "16" and all(p[P + g + ".capacity"] == "12" for g in grupos)


def test_escribir_colas_sin_archivo(tmp_path):
    with pytest.raises(ApiError) as e:
        ay.escribir_colas(tmp_path / "no.xml", ["g1"])
    assert e.value.code == "failed"
    (tmp_path / "roto.xml").write_text("<configuration><property>")
    with pytest.raises(ApiError) as e:
        ay.escribir_colas(tmp_path / "roto.xml", ["g1"])
    assert e.value.code == "failed"


# ------------------------------------------------------------------ localidad

APP = "application_1800000000000_0007"
JOB = "job_1800000000000_0007"
EV = "org.apache.hadoop.mapreduce.jobhistory."


def ev(tipo, clase, **campos):
    return json.dumps({"type": tipo, "event": {EV + clase: campos}})


def jhist(*eventos):
    """Un .jhist como lo escribe el ApplicationMaster de Hadoop 3.3 (mapreduce.jobhistory.jhist.format=json):
    la marca, el esquema y un evento Avro-JSON por línea (las uniones van como {"string": ...})."""
    return "\n".join(["Avro-Json", json.dumps({"type": "record", "name": "Event"}),
                      ev("JOB_SUBMITTED", "JobSubmitted", jobid=JOB, jobName="QuasiMonteCarlo"), *eventos]) + "\n"


def tarea(n, tipo="m"):
    return f"task_1800000000000_0007_{tipo}_{n:06d}"


def intento(n, i=0, tipo="m"):
    return f"attempt_1800000000000_0007_{tipo}_{n:06d}_{i}"


def empezo(n, splits, tipo="MAP"):
    return ev("TASK_STARTED", "TaskStarted", taskid=tarea(n, tipo[0].lower()), taskType=tipo, startTime=1,
              splitLocations=splits)


def corrio(n, host, i=0, loc="NODE_LOCAL", tipo="MAP"):
    t = tipo[0].lower()
    return ev(f"{tipo}_ATTEMPT_STARTED", "TaskAttemptStarted", taskid=tarea(n, t), taskType=tipo,
              attemptId=intento(n, i, t), startTime=2, trackerName=host, httpPort=8042, shufflePort=13562,
              containerId=f"container_1800000000000_0007_01_{n + 2:06d}", locality={"string": loc},
              avataar={"string": "VIRGIN"})


def termino(n, host, i=0, tipo="MAP"):
    t = tipo[0].lower()
    clase = "MapAttemptFinished" if tipo == "MAP" else "ReduceAttemptFinished"
    return ev(f"{tipo}_ATTEMPT_FINISHED", clase, taskid=tarea(n, t), attemptId=intento(n, i, t), taskType=tipo,
              taskStatus="SUCCEEDED", finishTime=9, hostname=host, port=8041, rackname="/fila1", state="map")


def fallo(n, host, i=0, status="FAILED"):
    return ev(f"MAP_ATTEMPT_{status}", "TaskAttemptUnsuccessfulCompletion", taskid=tarea(n), taskType="MAP",
              attemptId=intento(n, i), finishTime=5, hostname=host, port=8041, rackname={"string": "/fila2"},
              status=status, error="la PC se apagó")


RACKS = {"pc01": "/fila1", "pc02": "/fila1", "pc03": "/fila2", "pc04": "/fila2", "maestro": "/profe"}


def test_clasificar_localidad():
    r = RACKS.get
    assert ay.clasificar(["pc01", "pc03"], "pc03", r) == "data-local"
    assert ay.clasificar(["pc01", "maestro"], "pc02", r) == "rack-local"
    assert ay.clasificar(["pc01", "pc02"], "pc04", r) == "off-rack"
    assert ay.clasificar([], "pc04", r) is None and ay.clasificar(["pc01"], None, r) is None
    # Una PC sin rack conocido no se adivina
    assert ay.clasificar(["pc01"], "pc09", r) is None and ay.clasificar(["pc09"], "pc08", r) is None
    assert ay.clasificar(["pc09"], "pc09", r) == "data-local"


def test_localidad_de_mapreduce_desde_el_jhist():
    texto = jhist(
        empezo(0, "pc01,pc03"), corrio(0, "pc03"), termino(0, "pc03"),
        empezo(1, "pc01,maestro"), corrio(1, "pc02", loc="RACK_LOCAL"), termino(1, "pc02"),
        # El primer intento murió con su PC; el segundo corrió lejos del bloque
        empezo(2, "pc01,pc02"), corrio(2, "pc01"), fallo(2, "pc01"), corrio(2, "pc04", i=1, loc="OFF_SWITCH"),
        termino(2, "pc04", i=1),
        empezo(3, "pc03,pc04"), corrio(3, "pc04"),            # todavía corriendo
        empezo(0, "", tipo="REDUCE"), corrio(0, "pc02", loc="OFF_SWITCH", tipo="REDUCE"),
        "{roto",                                              # una línea a medio escribir (staging): se ignora
    )
    t = ay.localidad_mr(ay.parse_jhist(texto), RACKS.get)
    assert [(x["id"], x["tipo"], x["bloque"], x["corrio"], x["localidad"], x["estado"], x["intentos"]) for x in t] == [
        ("m_000000", "map", ["pc01", "pc03"], "pc03", "data-local", "ok", 1),
        ("m_000001", "map", ["pc01", "maestro"], "pc02", "rack-local", "ok", 1),
        ("m_000002", "map", ["pc01", "pc02"], "pc04", "off-rack", "ok", 2),
        ("m_000003", "map", ["pc03", "pc04"], "pc04", "data-local", "corriendo", 1),
        ("r_000000", "reduce", None, "pc02", None, "corriendo", 1),
    ]
    assert t[2]["fallidos"] == ["pc01"] and t[0]["rack"] == "/fila2" and t[0]["yarn"] == "NODE_LOCAL"
    assert ay.resumen(t) == {"data-local": 2, "rack-local": 1, "off-rack": 1}


def test_localidad_con_nombres_de_la_red():
    """El DNS de Docker suma el dominio (pc03.aula) y en el túnel puede venir la IP: todo se lee como pcNN."""
    texto = jhist(empezo(0, "pc01.aula,10.13.0.13"), corrio(0, "pc03.aula"), termino(0, "pc03.aula"),
                  empezo(1, "/default-rack/pc01.aula"), corrio(1, "10.13.0.12"), termino(1, "10.13.0.12"))
    t = ay.localidad_mr(ay.parse_jhist(texto), RACKS.get)
    assert [(x["bloque"], x["corrio"], x["localidad"]) for x in t] == [
        (["pc01", "pc03"], "pc03", "data-local"), (["pc01"], "pc02", "rack-local")]
    s = ay.localidad_spark({0: [{"index": 0, "host": "pc04.aula", "taskLocality": "NODE_LOCAL", "status": "SUCCESS"}]},
                           RACKS.get)
    assert (s[0]["corrio"], s[0]["rack"]) == ("pc04", "/fila2")
    assert ay.nodo_de("10.13.0.1") == "maestro" and ay.nodo_de("maestro.aula") == "maestro"
    assert ay.nodo_de("192.168.0.7") == "192.168.0.7" and ay.nodo_de(None) is None


def test_jhist_vacio_o_ajeno():
    assert ay.parse_jhist("") == {}
    assert ay.parse_jhist("no es un jhist\n{}\n") == {}
    assert ay.localidad_mr({}, RACKS.get) == []


def test_localidad_de_spark():
    tasks = [{"taskId": 0, "index": 0, "host": "pc01", "taskLocality": "NODE_LOCAL", "status": "SUCCESS"},
             {"taskId": 1, "index": 1, "host": "pc02", "taskLocality": "PROCESS_LOCAL", "status": "SUCCESS"},
             {"taskId": 2, "index": 2, "host": "pc03", "taskLocality": "RACK_LOCAL", "status": "RUNNING"},
             {"taskId": 3, "index": 3, "host": "pc04", "taskLocality": "ANY", "status": "FAILED"},
             {"taskId": 4, "index": 4, "host": "pc04", "taskLocality": "NO_PREF", "status": "SUCCESS"}]
    t = ay.localidad_spark({0: tasks}, RACKS.get)
    assert [(x["id"], x["corrio"], x["localidad"], x["estado"], x["bloque"]) for x in t] == [
        ("s0.0", "pc01", "data-local", "ok", None), ("s0.1", "pc02", "data-local", "ok", None),
        ("s0.2", "pc03", "rack-local", "corriendo", None), ("s0.3", "pc04", "off-rack", "fallo", None),
        ("s0.4", "pc04", None, "ok", None)]
    assert t[2]["rack"] == "/fila2" and t[0]["tipo"] == "spark"


# ------------------------------------------------------------------ escala

def medida(i, trabajo, pcs, seg, estado="ok"):
    return {"id": f"m{i}", "trabajo": trabajo, "pcs": pcs, "segundos": seg, "estado": estado, "inicio": i}


def test_curva_de_escala():
    ms = [medida(1, "mr-pi", 5, 100), medida(2, "mr-pi", 1, 400), medida(3, "mr-pi", 10, 60),
          medida(4, "mr-pi", 10, 40), medida(5, "spark-pi", 2, 50), medida(6, "mr-pi", 20, None, "fallo")]
    c = ay.curva(ms)
    pi = next(x for x in c if x["trabajo"] == "mr-pi")
    # Con varias medidas de la misma cantidad de PCs, el promedio; la base es la de menos PCs
    assert pi["puntos"] == [{"pcs": 1, "segundos": 400.0, "aceleracion": 1.0, "medidas": 1},
                            {"pcs": 5, "segundos": 100.0, "aceleracion": 4.0, "medidas": 1},
                            {"pcs": 10, "segundos": 50.0, "aceleracion": 8.0, "medidas": 2}]
    sp = next(x for x in c if x["trabajo"] == "spark-pi")
    assert sp["puntos"] == [{"pcs": 2, "segundos": 50.0, "aceleracion": 1.0, "medidas": 1}]
    assert ay.curva([]) == [] and ay.curva([medida(1, "mr-pi", 3, None, "fallo")]) == []


def test_pcs_que_prestan():
    doc = {"nodes": {"node": [
        {"nodeHostName": "pc01", "state": "RUNNING", "totalResource": {"memory": 2048, "vCores": 4}},
        {"nodeHostName": "pc02", "state": "LOST", "totalResource": {"memory": 2048, "vCores": 4}},
        {"nodeHostName": "maestro", "state": "RUNNING", "totalResource": {"memory": 1024, "vCores": 2}},
        {"nodeHostName": "pc03", "state": "RUNNING", "totalResource": {"memory": 4096, "vCores": 8}}]}}
    assert ay.prestan(doc) == {"pcs": 2, "nodos": ["pc01", "pc03"], "mb": 6144, "vcores": 12}
    assert ay.prestan(None) == {"pcs": 0, "nodos": [], "mb": 0, "vcores": 0}


def test_validar_medicion():
    assert ay.validar_medicion({"trabajo": "mr-pi"}) == ("mr-pi", {"maps": 16, "samples": 10000}, None)
    assert ay.validar_medicion({"trabajo": "spark-pi", "cola": "grupo1"}) == ("spark-pi", {"partitions": 16}, "grupo1")
    t, p, c = ay.validar_medicion({"trabajo": "mr-wordcount", "entrada": "/user/root/libros"})
    assert (t, c) == ("mr-wordcount", None)
    assert p == {"in": "/user/root/libros", "out": "/user/root/resultados/escala-wordcount", "overwrite": True}
    for malo in (None, {}, {"trabajo": "rm -rf"}, {"trabajo": "hive-ventas"}, {"trabajo": "mr-pi", "cola": "Grupo 1"},
                 {"trabajo": "mr-wordcount", "entrada": 5}, {"trabajo": "mr-pi", "cola": "default; x"}):
        with pytest.raises(ApiError) as e:
            ay.validar_medicion(malo)
        assert e.value.code == "invalid", malo


# ------------------------------------------------------------------ las rutas, en el maestro

import time  # noqa: E402

from starlette.testclient import TestClient  # noqa: E402

from sandbox_server.app import build_app  # noqa: E402


class Rest:
    """El RM, el JobHistory, Spark y WebHDFS falsos: url (sin host) → JSON o texto."""

    def __init__(self):
        self.r: dict[str, object] = {}
        self.pedidos: list[str] = []

    def __call__(self, url, timeout=5.0):
        self.pedidos.append(url)
        for k, v in self.r.items():
            if url.endswith(k) or k in url:
                if v is None:
                    return 404, b""
                body = v if isinstance(v, str) else json.dumps(v)
                return 200, body.encode()
        return (0, b"") if "8088" in url and not self.r.get("_rm") else (404, b"")


def nodos(*hosts):
    return {"nodes": {"node": [{"nodeHostName": h, "state": "RUNNING", "totalResource": {"memory": 2048, "vCores": 2}}
                               for h in hosts]}}


@pytest.fixture
def aula_yarn(settings, tmp_path, monkeypatch):
    monkeypatch.setenv("ROL", "maestro")
    monkeypatch.setenv("RED", "docker")
    monkeypatch.setenv("PCS_POR_FILA", "2")
    conf = tmp_path / "conf"
    conf.mkdir()
    (conf / "capacity-scheduler.xml").write_text(CAPACITY)
    monkeypatch.setenv("HADOOP_CONF_DIR", str(conf))
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html>")
    with TestClient(build_app(settings, ui_dir=ui)) as c:
        rest = Rest()
        rest.r["_rm"] = True
        c.app.state.yarn.http = rest
        ya = c.app.state.aula.yarn
        ya.PASO_S = 0.01
        ya.cmds = []

        def correr(argv, timeout=60):
            ya.cmds.append(argv)
            return ya.rc, "refreshQueues: " + ("ok" if ya.rc == 0 else "Failed to re-init queues : grupo1 is not STOPPED")
        ya.rc = 0
        ya.correr = correr
        c.rest, c.ya, c.conf = rest, ya, conf / "capacity-scheduler.xml"
        yield c


def test_api_colas(aula_yarn):
    c = aula_yarn
    c.rest.r["/ws/v1/cluster/scheduler"] = scheduler(hoja("default", 34.0, 10.0), hoja("grupo1", 33.0, 50.0, 2048, 2, 1))
    assert [q["nombre"] for q in c.get("/api/aula/colas").json()] == ["default", "grupo1"]
    r = c.put("/api/aula/colas", json={"grupos": ["grupo1", "grupo2"]})
    assert r.status_code == 200, r.text
    assert r.json()["grupos"] == ["grupo1", "grupo2"] and len(r.json()["colas"]) == 2
    assert c.ya.cmds == [["yarn", "rmadmin", "-refreshQueues"]]
    assert props(c.conf)[P + "queues"] == "default,grupo1,grupo2"
    assert "colas de YARN: default, grupo1, grupo2" in c.get("/api/aula").json()["eventos"][-1]
    # Si YARN no las acepta, el archivo vuelve a como estaba
    c.ya.rc = 255
    r = c.put("/api/aula/colas", json={"grupos": ["grupo3"]})
    assert r.status_code == 500 and "is not STOPPED" in r.json()["error"]
    assert props(c.conf)[P + "queues"] == "default,grupo1,grupo2"
    assert c.put("/api/aula/colas", json={"grupos": ["default"]}).status_code == 400
    # Un trabajo de muestra en la cola de un grupo
    pedidos = []

    async def submit(t, p, queue=None):
        pedidos.append((t, p, queue))
        return "application_1800000000000_0009"
    c.app.state.yarn.submit_template = submit
    r = c.post("/api/aula/colas/grupo2/trabajo", json={"trabajo": "spark-pi"})
    assert r.status_code == 202 and r.json() == {"id": "application_1800000000000_0009", "cola": "grupo2"}
    assert pedidos == [("spark-pi", {"partitions": 8}, "grupo2")]
    assert c.post("/api/aula/colas/grupo2/trabajo", json={"trabajo": "hive-ventas"}).status_code == 400
    assert c.post("/api/aula/colas/Grupo 2/trabajo", json={"trabajo": "mr-pi"}).status_code == 404


def test_api_colas_sin_rm(aula_yarn):
    aula_yarn.rest.r.pop("_rm")
    r = aula_yarn.get("/api/aula/colas")
    assert r.status_code == 503 and r.json()["code"] == "service_down"


def test_api_localidad_mapreduce_terminado_y_corriendo(aula_yarn):
    c = aula_yarn
    c.rest.r[f"/ws/v1/cluster/apps/{APP}"] = {"app": {"id": APP, "applicationType": "MAPREDUCE", "state": "FINISHED",
                                                      "finalStatus": "SUCCEEDED", "user": "root", "queue": "grupo1"}}
    done = "/mr-history/done/2026/11/10/000000"
    c.rest.r[f"/ws/v1/history/mapreduce/jobs/{JOB}/conf"] = {"conf": {"path": f"hdfs://maestro:9000{done}/{JOB}_conf.xml"}}
    c.rest.r[f"{done}?op=LISTSTATUS"] = {"FileStatuses": {"FileStatus": [
        {"pathSuffix": f"{JOB}_conf.xml"}, {"pathSuffix": f"{JOB}-1-root-QuasiMonteCarlo-2-4-1-SUCCEEDED-grupo1-1.jhist"}]}}
    c.rest.r[".jhist?op=OPEN"] = jhist(empezo(0, "pc01,pc03"), corrio(0, "pc02", loc="RACK_LOCAL"), termino(0, "pc02"))
    r = c.get(f"/api/aula/localidad/{APP}").json()
    assert (r["tipo"], r["estado"], r["fuente"], r["cola"], r["soportado"]) == ("MAPREDUCE", "FINISHED", "historial", "grupo1", True)
    # PCS_POR_FILA=2: pc01 y pc02 en la fila 1, pc03 en la 2
    assert [(t["id"], t["corrio"], t["rack"], t["localidad"]) for t in r["tareas"]] == [("m_000000", "pc02", "/fila1", "rack-local")]
    # Corriendo: lo lee del staging (el intento más nuevo del ApplicationMaster)
    c.rest.r[f"/ws/v1/cluster/apps/{APP}"]["app"].update(state="RUNNING", finalStatus="UNDEFINED")
    staging = f"/tmp/hadoop-yarn/staging/root/.staging/{JOB}"
    c.rest.r[f"{staging}?op=LISTSTATUS"] = {"FileStatuses": {"FileStatus": [
        {"pathSuffix": "job.xml"}, {"pathSuffix": f"{JOB}_1.jhist"}, {"pathSuffix": f"{JOB}_2.jhist"}]}}
    c.rest.pedidos.clear()
    r = c.get(f"/api/aula/localidad/{APP}").json()
    assert r["fuente"] == "en curso" and any(f"{JOB}_2.jhist?op=OPEN" in u for u in c.rest.pedidos)
    # Sin historial todavía: lo dice
    c.rest.r[f"{staging}?op=LISTSTATUS"] = {"FileStatuses": {"FileStatus": []}}
    r = c.get(f"/api/aula/localidad/{APP}").json()
    assert r["tareas"] == [] and "todavía no" in r["motivo"]
    # En binario (lo de fábrica en Hadoop 3; en CI vino así y daba cero tareas sin decir por qué): lo dice
    c.rest.r[f"{staging}?op=LISTSTATUS"] = {"FileStatuses": {"FileStatus": [{"pathSuffix": f"{JOB}_1.jhist"}]}}
    c.rest.r[".jhist?op=OPEN"] = "Avro-Binary\n\x00\x02basura"
    r = c.get(f"/api/aula/localidad/{APP}").json()
    assert r["tareas"] == [] and "jhist.format=json" in r["motivo"]


def test_conf_aula_pide_el_historial_en_json():
    # parse_jhist lee Avro-JSON: si conf_aula deja de pedirlo, la localidad da cero tareas
    lib = (Path(__file__).resolve().parents[2] / "sandbox" / "lib.sh").read_text()
    cuerpo = lib.split("conf_aula() {", 1)[1].split("\n}\n", 1)[0]
    assert "mapreduce.jobhistory.jhist.format json" in cuerpo


def test_api_localidad_spark_tez_y_errores(aula_yarn):
    c = aula_yarn
    sp = "application_1800000000000_0010"
    c.rest.r[f"/ws/v1/cluster/apps/{sp}"] = {"app": {"id": sp, "applicationType": "SPARK", "state": "FINISHED",
                                                     "finalStatus": "SUCCEEDED"}}
    c.rest.r[f"18080/api/v1/applications/{sp}/stages/0/1/taskList"] = [
        {"taskId": 0, "index": 0, "host": "pc03", "taskLocality": "NODE_LOCAL", "status": "SUCCESS"}]
    c.rest.r[f"18080/api/v1/applications/{sp}/stages"] = [{"stageId": 0, "attemptId": 0, "status": "COMPLETE"},
                                                          {"stageId": 0, "attemptId": 1, "status": "COMPLETE"}]
    r = c.get(f"/api/aula/localidad/{sp}").json()
    assert [(t["id"], t["corrio"], t["localidad"]) for t in r["tareas"]] == [("s0.0", "pc03", "data-local")]
    assert "no dónde estaba el bloque" in r["motivo"]
    tez = "application_1800000000000_0011"
    c.rest.r[f"/ws/v1/cluster/apps/{tez}"] = {"app": {"id": tez, "applicationType": "TEZ", "state": "RUNNING"}}
    r = c.get(f"/api/aula/localidad/{tez}").json()
    assert r["soportado"] is False and "TEZ" in r["motivo"]
    assert c.get("/api/aula/localidad/application_1800000000000_0999").status_code == 404
    assert c.get("/api/aula/localidad/nada;rm").status_code == 404


def test_api_medir(aula_yarn):
    c = aula_yarn
    app = "application_1800000000000_0012"
    c.rest.r["/ws/v1/cluster/nodes"] = nodos("pc01", "pc02", "maestro")
    c.rest.r[f"/ws/v1/cluster/apps/{app}"] = {"app": {"id": app, "state": "RUNNING"}}
    pedidos = []

    async def submit(t, p, queue=None):
        pedidos.append((t, p, queue))
        return app
    c.app.state.yarn.submit_template = submit
    r = c.post("/api/aula/escala", json={"trabajo": "mr-pi", "cola": "grupo1"})
    assert r.status_code == 202, r.text
    m = r.json()
    assert (m["trabajo"], m["pcs"], m["nodos"], m["vcores"], m["app"], m["estado"]) == \
        ("mr-pi", 2, ["pc01", "pc02"], 4, app, "corriendo")
    assert pedidos == [("mr-pi", {"maps": 16, "samples": 10000}, "grupo1")]
    # Una a la vez
    r = c.post("/api/aula/escala", json={"trabajo": "spark-pi"})
    assert r.status_code == 409 and r.json()["code"] == "busy"
    assert c.get("/api/aula/escala").json()["corriendo"]["app"] == app
    # Termina: anota el tiempo del RM y si cambiaron las PCs en el medio
    c.rest.r["/ws/v1/cluster/nodes"] = nodos("pc01")
    c.rest.r[f"/ws/v1/cluster/apps/{app}"] = {"app": {"id": app, "state": "FINISHED", "finalStatus": "SUCCEEDED",
                                                      "elapsedTime": 41234}}
    for _ in range(200):
        e = c.get("/api/aula/escala").json()
        if e["corriendo"] is None:
            break
        time.sleep(0.02)
    assert e["corriendo"] is None and e["ahora"]["pcs"] == 1
    m = e["medidas"][0]
    assert (m["estado"], m["segundos"], m["pcsAlFinal"], m["cambiaron"]) == ("ok", 41.2, 1, True)
    assert e["curva"] == [{"trabajo": "mr-pi", "entrada": None,
                           "puntos": [{"pcs": 2, "segundos": 41.2, "medidas": 1, "aceleracion": 1.0}]}]
    guardado = json.loads((c.app.state.aula.dir / "escala.json").read_text())
    assert guardado[0]["id"] == m["id"]
    assert "medido mr-pi con 2 PCs: 41.2 s" in c.get("/api/aula").json()["eventos"][-1]
    # Borrar una, y después todas
    assert c.delete("/api/aula/escala/nada").status_code == 404
    assert c.delete(f"/api/aula/escala/{m['id']}").json()["medidas"] == []
    assert c.delete("/api/aula/escala").status_code == 200


def test_api_medir_sin_pcs_o_falla(aula_yarn):
    c = aula_yarn
    c.rest.r["/ws/v1/cluster/nodes"] = nodos("maestro")
    r = c.post("/api/aula/escala", json={"trabajo": "mr-pi"})
    assert r.status_code == 503 and "Ninguna PC" in r.json()["error"]
    assert c.post("/api/aula/escala", json={"trabajo": "hive-ventas"}).status_code == 400
    # Si YARN no acepta el trabajo, no queda una medición colgada
    c.rest.r["/ws/v1/cluster/nodes"] = nodos("pc01")

    async def submit(t, p, queue=None):
        raise ApiError("El trabajo no llegó a YARN", "failed")
    c.app.state.yarn.submit_template = submit
    assert c.post("/api/aula/escala", json={"trabajo": "mr-pi"}).status_code == 500
    assert c.get("/api/aula/escala").json()["corriendo"] is None


def test_estado_del_aula_trae_las_colas():
    from sandbox_server import aula
    cs = ay.colas(scheduler(hoja("default", 50.0, 0.0), hoja("g1", 50.0, 20.0)))
    s = aula.armar({"rol": "maestro", "red": "docker"}, {}, [], None, None, {}, 0, [], {}, colas=cs)
    assert [q["nombre"] for q in s["colas"]] == ["default", "g1"]
    assert aula.armar({"rol": "maestro", "red": "docker"}, {}, [], None, None, {}, 0, [], {})["colas"] is None
