"""La vista Aula (versión empresa, ROL=maestro): el estado del laboratorio
armado con lo que dicen la inscripción, el NameNode, el ResourceManager y el
túnel. Los JSON tienen la forma real de Hadoop 3.3.6 (ver fixtures/nn_jmx.json
y fixtures/rm_nodes.json), con los nombres que usa el aula."""
import json

import pytest
from starlette.testclient import TestClient

from sandbox_server import aula
from sandbox_server.app import build_app

AHORA = 1_800_000_000
PUB = {n: (n * 43)[:43] + "=" for n in ("A", "B", "C")}
M_WG = {"rol": "maestro", "red": "wireguard"}
M_DOCKER = {"rol": "maestro", "red": "docker"}
HUB = {"codigo": "K7Q2", "modo": "kernel", "pub": "x"}
LINEA = 'cmd /c ""%USERPROFILE%\\Desktop\\empresa-alumno.cmd" 192.169.0.86 K7Q2"'
ENV = {"IP_AULA": "192.169.0.86", "PCS_POR_FILA": "2", "LINEA_VEYON": LINEA}


def jmx(nodos: dict, muertos: dict | None = None, total=10, perdidos=0, sub=0) -> dict:
    def dn(ip, bloques, ultimo):
        return {"xferaddr": f"{ip}:9866", "lastContact": ultimo, "numBlocks": bloques, "usedSpace": bloques * 1048576}
    return {"beans": [
        {"name": "Hadoop:service=NameNode,name=FSNamesystem", "BlocksTotal": total, "MissingBlocks": perdidos,
         "UnderReplicatedBlocks": sub},
        {"name": "Hadoop:service=NameNode,name=NameNodeInfo",
         "LiveNodes": json.dumps({f"{h}:9866": dn(*v) for h, v in nodos.items()}),
         "DeadNodes": json.dumps({f"{h}:9866": dn(*v) for h, v in (muertos or {}).items()})},
    ]}


def rm(nodos: dict) -> dict:
    return {"nodes": {"node": [
        {"id": f"{h}:8041", "nodeHostName": h, "state": st, "numContainers": c, "usedMemoryMB": usado,
         "availMemoryMB": mb - usado, "usedVirtualCores": c, "availableVirtualCores": vc - c,
         "totalResource": {"memory": mb, "vCores": vc}}
        for h, (st, mb, vc, usado, c) in nodos.items()]}}


def inscripta(n, nombre, pub, ram=3891, cores=4, yarn=2048):
    return {"numero": str(n), "nodo": f"pc{n:02d}", "nombre": nombre, "ip": f"10.13.0.{10 + n}", "pub": pub,
            "ram_mb": str(ram), "cores": str(cores), "yarn_mb": str(yarn), "vcores": str(cores),
            "cpu": "Intel(R) Core(TM) i3-2120 CPU @ 3.30GHz", "inscripta": str(AHORA - 600)}


def saludo(hace: int) -> dict:
    return {"saludo": AHORA - hace, "rx": 0, "tx": 0}


def test_modo_sale_de_rol_y_red():
    assert aula.modo({}) is None
    assert aula.modo({"ROL": "solo"}) is None
    assert aula.modo({"ROL": "trabajador"}) is None
    assert aula.modo({"ROL": "Maestro"}) == M_DOCKER
    assert aula.modo({"ROL": "maestro", "RED": "WireGuard"}) == M_WG


def test_wg_dump():
    texto = ("privada\tpublica\t51820\toff\n"
             f"{PUB['A']}\t(none)\t172.17.0.1:40001\t10.13.0.11/32\t{AHORA - 20}\t1048576\t2097152\toff\n"
             f"{PUB['B']}\t(none)\t(none)\t10.13.0.12/32\t0\t0\t0\toff\n")
    d = aula.wg_dump(texto)
    assert d[PUB["A"]] == {"saludo": AHORA - 20, "rx": 1048576, "tx": 2097152, "endpoint": "172.17.0.1:40001"}
    assert d[PUB["B"]]["saludo"] == 0 and d[PUB["B"]]["endpoint"] is None


def test_lamparas_y_ya_pueden_apagar():
    pcs = [inscripta(1, "PC107", PUB["A"]), inscripta(2, "PC121", PUB["B"], ram=7884, cores=8, yarn=5120),
           inscripta(3, "PC180", PUB["C"])]
    j = jmx({"maestro": ("10.13.0.1", 10, 1), "pc01": ("10.13.0.11", 4, 2), "pc02": ("10.13.0.12", 6, 1)})
    r = rm({"pc01": ("RUNNING", 2048, 4, 1024, 2), "pc02": ("RUNNING", 5120, 8, 0, 0)})
    wg = {PUB["A"]: saludo(30), PUB["B"]: saludo(10)}
    a = aula.armar(M_WG, HUB, pcs, j, r, wg, AHORA, ["21:03:10 PC107 se sumó como pc01"], ENV)
    assert [(p["nodo"], p["estado"]) for p in a["pcs"]] == [("pc01", "arriba"), ("pc02", "arriba"), ("pc03", "sumandose")]
    pc01, pc02, pc03 = a["pcs"]
    assert pc01["nombre"] == "PC107" and pc01["ipTunel"] == "10.13.0.11" and pc01["fila"] == "/fila1"
    assert pc02["nodemanager"]["mb"] == 5120 and pc02["nodemanager"]["vcores"] == 8 and pc02["dockerRamMb"] == 7884
    assert pc01["datanode"]["bloques"] == 4 and pc01["tunel"]["saludoHaceS"] == 30
    # pc03 se inscribió pero todavía no saludó por el túnel ni se anotó en HDFS
    assert pc03["fila"] == "/fila2" and "túnel" in pc03["motivo"] and pc03["prestaMb"] == 2048
    assert a["yarn"] == {"mb": 7168, "mbUsados": 1024, "vcores": 12, "vcoresUsados": 2, "contenedores": 2}
    assert a["resumen"] == {"sumandose": 1, "arriba": 2, "sin-respuesta": 0, "caida": 0}
    assert a["codigo"] == "K7Q2" and a["ipAula"] == "192.169.0.86" and a["mtu"] == 1380 and a["replicacion"] == 2
    assert a["lineaVeyon"] == LINEA and a["eventos"] == ["21:03:10 PC107 se sumó como pc01"]
    # El maestro tiene los 10 bloques: se puede apagar
    assert a["maestro"]["bloques"] == 10 and a["apagar"]["listo"] is True
    # Una PC que solo reservó su número (empresa-alumno.cmd todavía no creó su contenedor)
    pcs.append({"numero": "4", "nodo": "pc04", "nombre": "PC223", "ip": "10.13.0.14"})
    a = aula.armar(M_WG, HUB, pcs, j, r, wg, AHORA, [], ENV)
    assert a["pcs"][3]["estado"] == "sumandose" and "reservó" in a["pcs"][3]["motivo"]


def test_linea_de_veyon_con_la_carpeta_del_profe():
    env = {"IP_AULA": "192.169.0.86", "CARPETA_VEYON": "%USERPROFILE%\\Desktop\\"}
    a = aula.armar(M_WG, HUB, [], None, None, {}, AHORA, [], env)
    assert a["lineaVeyon"] == LINEA
    assert aula.armar(M_WG, {}, [], None, None, {}, AHORA, [], env)["lineaVeyon"] is None   # sin código todavía


def test_todavia_no_se_puede_apagar():
    j = jmx({"maestro": ("10.13.0.1", 7, 1), "pc01": ("10.13.0.11", 10, 1)}, total=10)
    a = aula.armar(M_WG, HUB, [], j, None, {}, AHORA, [], ENV)
    assert a["apagar"]["listo"] is False and "7 de 10" in a["apagar"]["porque"]
    j = jmx({"maestro": ("10.13.0.1", 10, 1)}, total=10, perdidos=2)
    a = aula.armar(M_WG, HUB, [], j, None, {}, AHORA, [], ENV)
    assert a["apagar"]["listo"] is False and "faltan 2 bloques" in a["apagar"]["porque"]
    a = aula.armar(M_WG, HUB, [], None, None, {}, AHORA, [], ENV)
    assert a["apagar"]["listo"] is False and a["hdfs"]["disponible"] is False


def test_una_pc_que_se_apaga():
    pcs = [inscripta(1, "PC107", PUB["A"]), inscripta(2, "PC121", PUB["B"])]
    wg = {PUB["A"]: saludo(5), PUB["B"]: saludo(5)}
    # pc02 dejó de mandar latidos hace 20 s: todavía no está muerta
    j = jmx({"maestro": ("10.13.0.1", 4, 1), "pc01": ("10.13.0.11", 2, 1), "pc02": ("10.13.0.12", 2, 20)})
    r = rm({"pc01": ("RUNNING", 2048, 4, 0, 0), "pc02": ("RUNNING", 2048, 4, 0, 0)})
    a = aula.armar(M_WG, HUB, pcs, j, r, wg, AHORA, [], ENV)
    assert a["pcs"][1]["estado"] == "sin-respuesta" and "40 s" in a["pcs"][1]["motivo"]
    # a los 40 s: muerta
    j = jmx({"maestro": ("10.13.0.1", 4, 1), "pc01": ("10.13.0.11", 2, 1)}, muertos={"pc02": ("10.13.0.12", 2, 45)})
    a = aula.armar(M_WG, HUB, pcs, j, r, wg, AHORA, [], ENV)
    assert a["pcs"][1]["estado"] == "caida" and a["resumen"]["caida"] == 1
    # YARN la perdió (LOST) aunque el DataNode siga
    j = jmx({"maestro": ("10.13.0.1", 4, 1), "pc01": ("10.13.0.11", 2, 1), "pc02": ("10.13.0.12", 2, 1)})
    r = rm({"pc01": ("RUNNING", 2048, 4, 0, 0), "pc02": ("LOST", 2048, 4, 0, 0)})
    a = aula.armar(M_WG, HUB, pcs, j, r, wg, AHORA, [], ENV)
    assert a["pcs"][1]["estado"] == "caida" and "LOST" in a["pcs"][1]["motivo"]
    assert a["yarn"]["mb"] == 2048   # solo cuentan los NodeManagers que andan
    # El túnel no saluda hace 5 minutos
    wg[PUB["B"]] = saludo(300)
    r = rm({"pc01": ("RUNNING", 2048, 4, 0, 0), "pc02": ("RUNNING", 2048, 4, 0, 0)})
    a = aula.armar(M_WG, HUB, pcs, j, r, wg, AHORA, [], ENV)
    assert a["pcs"][1]["estado"] == "sin-respuesta" and "5 min" in a["pcs"][1]["motivo"]


def test_aula_simulada_sin_inscripcion():
    """RED=docker: no hay inscripción ni túnel, las PCs salen del NameNode y YARN."""
    j = jmx({"maestro": ("172.18.0.2", 3, 1), "pc01": ("172.18.0.3", 3, 1)})
    r = rm({"pc01": ("RUNNING", 2048, 8, 0, 0)})
    a = aula.armar(M_DOCKER, {}, [], j, r, {}, AHORA, [], {})
    assert a["red"] == "docker" and a["mtu"] is None and a["replicacion"] == 3 and a["codigo"] is None
    assert [(p["nodo"], p["estado"], p["ipTunel"]) for p in a["pcs"]] == [("pc01", "arriba", "172.18.0.3")]
    # Solo HDFS (SERVICIOS=hdfs): no hace falta el NodeManager para estar arriba
    a = aula.armar(M_DOCKER, {}, [], j, None, {}, AHORA, [], {}, con_yarn=False)
    assert a["pcs"][0]["estado"] == "arriba"


def test_leer_pcs_hub_y_eventos(tmp_path):
    (tmp_path / "pcs").mkdir()
    (tmp_path / "pcs" / "PC121").write_text("numero=2\nnodo=pc02\nnombre=PC121\n")
    (tmp_path / "pcs" / "PC107").write_text("numero=1\nnodo=pc01\nnombre=PC107\n")
    (tmp_path / "pcs" / "PC9.tmp").write_text("numero=9\n")
    (tmp_path / "codigo").write_text("K7Q2\n")
    (tmp_path / "eventos.log").write_text("a\n\nb\n")
    assert [p["nombre"] for p in aula.leer_pcs(tmp_path)] == ["PC107", "PC121"]
    assert aula.leer_hub(tmp_path) == {"codigo": "K7Q2", "modo": None, "pub": None}
    assert aula.leer_eventos(tmp_path) == ["a", "b"]


@pytest.fixture
def maestro(settings, tmp_path, monkeypatch):
    monkeypatch.setenv("ROL", "maestro")
    monkeypatch.setenv("RED", "wireguard")
    monkeypatch.setenv("IP_AULA", "192.169.0.86")
    a = settings.hadoop_dir / "aula"
    (a / "pcs").mkdir(parents=True)
    (a / "codigo").write_text("K7Q2\n")
    (a / "pcs" / "PC107").write_text("numero=1\nnodo=pc01\nnombre=PC107\nip=10.13.0.11\npub=x\n")
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html>")
    with TestClient(build_app(settings, ui_dir=ui)) as c:
        yield c


def test_api_en_el_maestro(maestro):
    s = maestro.get("/api/status").json()
    assert s["aula"] == M_WG
    # La configuración sale de las variables del contenedor (replicación 2 en el aula)
    assert s["config"]["replication"] == 2 and s["config"]["jupyter"] is False
    # Los procesos del maestro: sin NodeManager y con su DataNode "archivo" en el 9864
    ids = [p["id"] for p in s["processes"]]
    assert "nm" not in ids and "dn1" in ids and "snn" in ids
    assert next(p for p in s["processes"] if p["id"] == "dn1")["ports"] == [9864, 9866]
    a = maestro.get("/api/aula").json()
    assert a["codigo"] == "K7Q2" and a["ipAula"] == "192.169.0.86"
    assert [(p["nodo"], p["nombre"], p["estado"]) for p in a["pcs"]] == [("pc01", "PC107", "sumandose")]
    # El volumen no se borra desde la interfaz, y los cambios de configuración no se aplican
    r = maestro.post("/api/cluster/reset")
    assert r.status_code == 409 and "empresa-profe.cmd" in r.json()["error"]
    v = maestro.post("/api/config/validate", json={"config": {"datanodes": 5}}).json()
    assert v and v[0]["level"] == "warning"


def test_api_aula_fuera_del_maestro(settings, tmp_path):
    with TestClient(build_app(settings, ui_dir=tmp_path)) as c:
        r = c.get("/api/aula")
    assert r.status_code == 501 and r.json()["code"] == "unsupported"
