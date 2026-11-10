"""El aula en vivo (versión empresa, en el maestro): el plano y sus racks (con el script de topología de verdad),
los contadores de nftables (con la salida real de `nft -j`, fixtures/nft_set_hdfs.json), las tasas de tráfico por PC
y por par, la línea de tiempo de una PC que se cae y los contenedores de cada trabajo por PC."""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from conftest import fixture_json
from sandbox_server import aula, aula_vivo as av
from sandbox_server.app import build_app

TOPOLOGIA = Path(__file__).resolve().parents[2] / "empresa" / "aula" / "topologia"


# ------------------------------------------------------------------ el plano

def test_plano_valida_y_da_los_racks(tmp_path):
    plano, err = aula.normalizar_plano({"filas": [["pc1", None, "pc03"], ["pc02", ""]]})
    assert err is None and plano == {"filas": [["pc01", None, "pc03"], ["pc02", None]]}
    assert aula.racks_del_plano(plano) == {"pc01": "/fila1", "pc03": "/fila1", "pc02": "/fila2"}
    for malo in ({}, {"filas": []}, {"filas": [["pc01", "pc01"]]}, {"filas": [["maestro"]]}, {"filas": [[1]]},
                 {"filas": [["pc01"]] * 9}, {"filas": [[None] * 13]}):
        assert aula.normalizar_plano(malo)[1], malo
    g = aula.guardar_plano(tmp_path, plano)
    assert g["actualizado"] and g["cambianDeRack"] == []
    assert (tmp_path / "racks").read_text() == "pc01 /fila1\npc02 /fila2\npc03 /fila1\n"
    assert aula.leer_plano(tmp_path)["filas"] == plano["filas"]
    # Mover pc03 a la fila 2: avisa que su rack cambia (al próximo arranque)
    g = aula.guardar_plano(tmp_path, {"filas": [["pc01"], ["pc02", "pc03"]]})
    assert g["cambianDeRack"] == ["pc03"]


@pytest.mark.skipif(not shutil.which("bash") or os.name == "nt", reason="el script de topología es bash")
def test_topologia_lee_el_plano(tmp_path):
    env = {**os.environ, "AULA_DIR": str(tmp_path), "PCS_POR_FILA": "5"}
    def racks(*nodos):
        r = subprocess.run(["bash", str(TOPOLOGIA), *nodos], env=env, capture_output=True, text=True, timeout=10)
        assert r.returncode == 0, r.stderr
        return r.stdout.split()
    assert racks("pc03", "pc07", "maestro", "otra") == ["/fila1", "/fila2", "/profe", "/default-rack"]
    aula.guardar_plano(tmp_path, {"filas": [["pc07"], ["pc03"]]})
    assert racks("pc03", "pc7", "pc12") == ["/fila2", "/fila1", "/fila3"]     # pc12 sin ubicar: la cuenta
    # Solo plano.json (lo copió empresa-profe.cmd): el script arma racks
    (tmp_path / "racks").unlink()
    (tmp_path / "plano.json").write_text(json.dumps({"filas": [["pc3"], [None, "pc12"]]}))
    assert racks("pc03", "pc12") == ["/fila1", "/fila2"] and (tmp_path / "racks").read_text() == "pc03 /fila1\npc12 /fila2\n"


def test_el_estado_trae_el_plano_y_los_contenedores():
    plano = {"filas": [["pc02", "pc01"]]}
    pcs = [{"numero": "1", "nodo": "pc01"}, {"numero": "2", "nodo": "pc02"}]
    apps = {"pc02": [{"app": "application_1_0001", "n": 3, "am": True}]}
    s = aula.armar({"rol": "maestro", "red": "wireguard"}, {}, pcs, None, None, {}, 0, [], {"PCS_POR_FILA": "1"},
                   plano=plano, apps=apps)
    por = {p["nodo"]: p for p in s["pcs"]}
    assert por["pc02"]["fila"] == "/fila1" and por["pc02"]["lugar"] == {"fila": 0, "lugar": 0}
    assert por["pc01"]["lugar"] == {"fila": 0, "lugar": 1} and por["pc02"]["apps"][0]["am"]
    assert s["plano"] == plano


# ------------------------------------------------------------------ nftables

def test_lee_los_contadores_reales_de_nft():
    pares = av.leer_set_nft(fixture_json("nft_set_hdfs.json"))
    assert pares == {("10.13.0.13", "10.13.0.17"): 4005648, ("10.13.0.17", "10.13.0.1"): 1500}
    assert av.nodo_de_ip("10.13.0.13") == "pc03" and av.nodo_de_ip("10.13.0.1") == "maestro"
    assert av.nodo_de_ip("192.168.1.5") == "192.168.1.5"


def test_las_reglas_de_nft():
    r = av.reglas_nft("wg0")
    assert "table inet aula_trafico" in r and r.count("flags dynamic; counter;") == 4
    assert 'iifname "wg0" oifname "wg0" tcp dport { 9866, 9867 } update @hdfs { ip saddr . ip daddr }' in r
    assert "hook input" in r and "hook output" in r


# ------------------------------------------------------------------ tráfico y caídas

def m(t, pcs, sub=0, pend=0, pares=None):
    return {"t": t, "pcs": pcs, "hdfs": {"sub": sub, "pend": pend, "perdidos": 0}, "pares": pares, "apps": {}}


def pc(estado="arriba", rx=0.0, tx=0.0, cont=0, mb=100.0):
    return {"estado": estado, "ip": None, "contenedores": cont, "usadoMb": mb, "rxMb": rx, "txMb": tx}


def test_trafico_por_pc_y_por_par():
    a = m(100, {"pc01": pc(rx=10, tx=5)}, pares={"total": {("10.13.0.11", "10.13.0.12"): 0}, "hdfs": {}, "shuffle": {}, "yarn": {}})
    b = m(102, {"pc01": pc(rx=20, tx=5)}, pares={"total": {("10.13.0.11", "10.13.0.12"): 4_000_000},
                                                "hdfs": {("10.13.0.11", "10.13.0.12"): 3_000_000}, "shuffle": {}, "yarn": {}})
    t = av.trafico([a, b], fuente="nft")
    # 10 MB en 2 s = 41,9 Mbit/s que mandó pc01; 4 MB del par en 2 s = 16 Mbit/s, 12 de bloques de HDFS
    assert t["serie"][0]["pcs"]["pc01"] == {"manda": 41.943, "recibe": 0.0}
    par = t["pares"][0]
    assert (par["de"], par["a"], par["mbps"]) == ("pc01", "pc02", 16.0)
    assert par["clases"]["hdfs"] == 12.0 and par["clases"]["otro"] == 4.0
    assert t["porPc"][0]["nodo"] == "pc01" and t["porPc"][0]["usoTecho"] > 0.8
    # Sin nft: solo por PC
    assert av.trafico([a, b], fuente="wg")["serie"] and av.trafico([{**a, "pares": None}, {**b, "pares": None}])["pares"] == []


def test_una_pc_que_se_cae_y_hdfs_copia_sus_bloques():
    serie = [m(0, {"pc01": pc(cont=3, mb=640), "pc02": pc()}),
             m(2, {"pc01": pc(cont=3, mb=640), "pc02": pc()}),
             m(4, {"pc01": pc("sin-respuesta", cont=0), "pc02": pc()}),
             m(44, {"pc01": pc("caida"), "pc02": pc()}, sub=40, pend=10),
             m(60, {"pc01": pc("caida"), "pc02": pc()}, sub=12, pend=5),
             m(80, {"pc01": pc("caida"), "pc02": pc()}, sub=0, pend=0),
             m(82, {"pc01": pc("caida"), "pc02": pc()}, sub=0, pend=0)]
    cs = av.caidas(serie)
    assert len(cs) == 1 and cs[0]["nodo"] == "pc01" and not cs[0]["abierta"]
    r = cs[0]["resumen"]
    assert r["contenedoresPerdidos"] == 3 and r["bloquesRecopiados"] == 40 and r["rojaALosS"] == 40.0
    assert r["copiadoALosS"] == 76.0 and "re-copió 40 bloques" in r["texto"] and "640 MB" in r["texto"]
    assert [x["estado"] for x in cs[0]["serie"]][:2] == ["sin-respuesta", "caida"]


def test_una_pc_que_vuelve():
    serie = [m(0, {"pc01": pc()}), m(2, {"pc01": pc("sin-respuesta")}), m(10, {"pc01": pc()})]
    c = av.caidas(serie)[0]
    assert c["resumen"]["cierre"] == "volvió" and "volvió a los 8 s" in c["resumen"]["texto"]
    # Una que todavía no volvió queda abierta
    assert av.caidas(serie[:2])[0]["abierta"]


def test_contenedores_por_trabajo():
    doc = {"containers": {"container": [
        {"id": "container_e03_1794289929080_0005_01_000001", "state": "RUNNING"},
        {"id": "container_1794289929080_0005_01_000002", "state": "RUNNING"},
        {"id": "container_1794289929080_0007_01_000003", "state": "RUNNING"},
        {"id": "container_1794289929080_0007_01_000004", "state": "COMPLETE"}]}}
    apps = av.apps_por_pc(av.contenedores_de_nm(doc))
    assert apps == [{"app": "application_1794289929080_0005", "n": 2, "am": True},
                    {"app": "application_1794289929080_0007", "n": 1, "am": False}]


# ------------------------------------------------------------------ rutas

@pytest.fixture
def maestro(settings, tmp_path, monkeypatch):
    monkeypatch.setenv("ROL", "maestro")
    monkeypatch.setenv("RED", "wireguard")
    a = settings.hadoop_dir / "aula"
    (a / "pcs").mkdir(parents=True)
    (a / "pcs" / "PC107").write_text("numero=1\nnodo=pc01\nnombre=PC107\nip=10.13.0.11\npub=x\n")
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html>")
    with TestClient(build_app(settings, ui_dir=ui)) as c:
        yield c


def test_rutas_del_aula_en_vivo(maestro):
    assert maestro.get("/api/aula/plano").json() is None
    r = maestro.put("/api/aula/plano", json={"filas": [["pc01", None]]})
    assert r.status_code == 200 and r.json()["filas"] == [["pc01", None]]
    assert maestro.put("/api/aula/plano", json={"filas": [["xx"]]}).status_code == 400
    a = maestro.get("/api/aula").json()
    assert a["plano"]["filas"] == [["pc01", None]] and a["pcs"][0]["lugar"] == {"fila": 0, "lugar": 0}
    t = maestro.get("/api/aula/trafico").json()
    assert t["techoMbps"] == 50 and t["fuente"] in ("wg", "nft") and "serie" in t
    assert maestro.get("/api/aula/caidas").json() == []
    assert maestro.get("/api/aula/trafico?desde=x").status_code == 400
