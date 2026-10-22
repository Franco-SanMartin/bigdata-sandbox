"""Prueba de humo contra la imagen 'full' de verdad (Hadoop real adentro).

No corre con el resto: se saltea salvo que exista SANDBOX_HUMO=1. Va contra un
servidor ya levantado y solo usa la biblioteca estándar, así se puede correr
desde afuera del contenedor sin instalar nada:

    docker run -d --name humo -p 8080:8080 franki678/bigdata-sandbox:full
    SANDBOX_HUMO=1 python3 -m pytest -q server/tests/humo
    # o, sin pytest:
    SANDBOX_HUMO=1 python3 server/tests/humo/test_humo.py

Variables: SANDBOX_URL (http://localhost:8080), HUMO_TIMEOUT (segundos para
llegar a 'running', 420 de fábrica) y HUMO_PROCESOS (segundos para ver
NameNode y DataNode arriba después, 120).
"""
import json
import os
import time
import urllib.error
import urllib.request

import pytest

URL = os.environ.get("SANDBOX_URL", "http://localhost:8080").rstrip("/")
TIMEOUT = float(os.environ.get("HUMO_TIMEOUT", "420"))
# Lo más chico que arranca: 1 NameNode, 1 DataNode, solo HDFS
CONFIG = {"datanodes": 1, "replication": 1, "blockSize": "1m", "namenodes": 1, "services": "hdfs",
          "mongodb": False, "jupyter": False, "pigHeapsize": 512}

pytestmark = pytest.mark.skipif(os.environ.get("SANDBOX_HUMO") != "1",
                                reason="prueba de humo: solo con SANDBOX_HUMO=1 contra la imagen")


def pedir(metodo, ruta, cuerpo=None, timeout=10):
    datos = None if cuerpo is None else json.dumps(cuerpo).encode()
    req = urllib.request.Request(URL + ruta, data=datos, method=metodo,
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            texto = r.read().decode()
            return r.status, (json.loads(texto) if texto and "json" in r.headers.get("content-type", "") else texto)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def estado():
    return pedir("GET", "/api/status")[1]


def esperar(cond, segundos, que):
    fin = time.time() + segundos
    while time.time() < fin:
        s = estado()
        if cond(s):
            return s
        if s["phase"] == "stopped" and s.get("boot") and any(p["state"] == "failed" for p in s["boot"]["steps"]):
            fallido = next(p for p in s["boot"]["steps"] if p["state"] == "failed")
            raise AssertionError(f"el arranque falló en '{fallido['name']}': {fallido['log'][-5:]}")
        time.sleep(2)
    raise AssertionError(f"no llegó a {que} en {segundos:g} s (fase {estado()['phase']})")


def test_arranca_hdfs_y_apaga():
    # El servidor contesta JSON enseguida (si no, la interfaz cae al modo demo)
    t0 = time.time()
    s = estado()
    assert time.time() - t0 < 1.5 and s["phase"] == "stopped"

    # SSE: saludo y estado inicial
    with urllib.request.urlopen(URL + "/api/events", timeout=10) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        assert r.readline() == b": conectado\n"

    codigo, compose = pedir("POST", "/api/config/compose", {"config": CONFIG})
    assert codigo == 200 and "bigdata-sandbox" in compose

    codigo, _ = pedir("POST", "/api/cluster/start", {"config": CONFIG})
    assert codigo == 202
    s = esperar(lambda s: s["phase"] == "running", TIMEOUT, "running")
    assert all(p["state"] in ("done", "skipped") for p in s["boot"]["steps"])

    # Los procesos aparecen arriba según el sondeo (puerto escuchando) y el
    # NameNode ve al DataNode por JMX
    s = esperar(lambda s: {p["id"]: p["state"] for p in s["processes"]}.get("dn1") == "up"
                and {p["id"]: p["state"] for p in s["processes"]}.get("nn1") == "up"
                and (s["hdfs"] or {}).get("liveDataNodes", 0) >= 1, float(os.environ.get("HUMO_PROCESOS", "120")), "NameNode y DataNode arriba")
    _, dns = pedir("GET", "/api/hdfs/datanodes")
    assert any(d["id"] == 1 and d["state"] == "live" for d in dns), dns

    codigo, _ = pedir("POST", "/api/cluster/stop")
    assert codigo == 202
    s = esperar(lambda s: s["phase"] == "stopped", 60, "stopped")
    assert not [p["id"] for p in s["processes"] if p["id"] != "ui" and p["state"] == "up"]
    _, acts = pedir("GET", "/api/activity?limit=5")
    assert acts[-1]["title"] == "Cluster apagado"


if __name__ == "__main__":
    os.environ.setdefault("SANDBOX_HUMO", "1")
    test_arranca_hdfs_y_apaga()
    print("humo ok")
