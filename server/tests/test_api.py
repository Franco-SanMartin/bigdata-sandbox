"""Las rutas /api/... con el cliente de prueba de Starlette."""
import asyncio
import time

import pytest
from starlette.testclient import TestClient

from conftest import BASE
from sandbox_server.app import build_app
from sandbox_server.events import EventBus, sse_format, sse_stream


@pytest.fixture
def client(settings, tmp_path):
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html><title>sandbox</title>")
    with TestClient(build_app(settings, ui_dir=ui)) as c:
        yield c


def esperar_fase(client, fase, timeout=10):
    fin = time.time() + timeout
    while time.time() < fin:
        if client.get("/api/status").json()["phase"] == fase:
            return
        time.sleep(0.05)
    raise AssertionError(f"no llegó a {fase}")


def test_status_es_json_y_tiene_el_contrato(client):
    r = client.get("/api/status")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    s = r.json()
    assert set(s) == {"phase", "config", "volumeNameNodes", "startedAt", "now", "memory", "processes", "hdfs",
                      "yarn", "boot", "image"}
    assert s["phase"] == "stopped" and s["boot"] is None
    assert s["image"]["name"] == "franki678/bigdata-sandbox"
    assert {p["state"] for p in s["processes"] if p["id"] != "ui"} == {"off"}
    assert set(s["memory"]) == {"limitMb", "usedMb", "estimateMb", "history"}


def test_config(client):
    issues = client.post("/api/config/validate", json={"config": {**BASE, "datanodes": 0}}).json()
    assert issues[0] == {"field": "datanodes", "level": "error", "message": "Tiene que ser un número de 1 a 9."}
    est = client.post("/api/config/estimate", json={"config": BASE}).json()
    assert est["totalMb"] == sum(p["mb"] for p in est["parts"])
    r = client.post("/api/config/compose", json={"config": BASE})
    assert r.headers["content-type"].startswith("text/yaml")
    assert "image: franki678/bigdata-sandbox:full" in r.text and 'DATANODES: "2"' in r.text
    assert client.put("/api/config", json={"config": {**BASE, "datanodes": 3}}).status_code == 204
    assert client.get("/api/status").json()["config"]["datanodes"] == 3


def test_errores_en_json(client):
    r = client.post("/api/config/validate", content=b"no es json")
    assert r.status_code == 400 and r.json() == {"error": "el cuerpo tiene que ser JSON", "code": "invalid"}
    assert client.post("/api/config/validate", json={}).json() == {"error": "falta { config }", "code": "invalid"}
    r = client.post("/api/cluster/start", json={"config": {**BASE, "blockSize": "x"}})
    assert r.status_code == 400 and r.json()["issues"][0]["field"] == "blockSize"
    # Con el cluster apagado, los códigos de ui/src/api/errors.ts
    r = client.get("/api/yarn/apps")
    assert r.status_code == 409 and r.json()["code"] == "cluster_stopped"
    r = client.get("/api/hdfs/ls?path=/")
    assert r.status_code == 409 and r.json()["code"] == "cluster_stopped"
    r = client.get("/api/no-existe")
    assert r.status_code == 404 and r.json()["code"] == "not_found"
    assert client.get("/api/status", headers={}).status_code == 200
    r = client.delete("/api/status")
    assert r.status_code in (404, 405) and r.json()["code"] in ("not_found", "invalid")


def test_ciclo_completo(client):
    assert client.post("/api/cluster/start", json={"config": BASE}).status_code == 202
    assert client.post("/api/cluster/start", json={"config": BASE}).status_code == 409
    esperar_fase(client, "running")
    s = client.get("/api/status").json()
    assert all(st["state"] in ("done", "skipped") for st in s["boot"]["steps"])
    assert client.post("/api/cluster/reset").status_code == 409
    r = client.post("/api/processes/dn1/stop")
    assert r.status_code == 202
    run_id = r.json()["id"]
    # El falso no tiene /opt/sandbox/bin/datanode: la acción falla y queda registrada
    fin = time.time() + 5
    while client.get(f"/api/actions/{run_id}").json()["state"] == "running" and time.time() < fin:
        time.sleep(0.05)
    assert client.get(f"/api/actions/{run_id}").json()["state"] == "failed"
    assert client.get("/api/actions/x999").status_code == 404
    assert client.post("/api/processes/rm/stop").status_code == 400
    assert client.post("/api/cluster/apply", json={"config": {**BASE, "datanodes": 3}}).status_code == 202
    time.sleep(0.2)
    esperar_fase(client, "running")
    assert client.get("/api/status").json()["config"]["datanodes"] == 3
    assert client.post("/api/cluster/stop").status_code == 202
    esperar_fase(client, "stopped")
    assert client.post("/api/cluster/reset").status_code == 202
    acts = client.get("/api/activity?limit=500").json()
    assert acts[-1]["title"] == "Volumen borrado"
    assert len(client.get("/api/activity?limit=2").json()) == 2


def test_hdfs_sin_cluster(client):
    assert client.get("/api/hdfs/files?recursive=1").json() == []
    client.put("/api/config", json={"config": BASE})
    dns = client.get("/api/hdfs/datanodes").json()
    assert [(d["id"], d["state"]) for d in dns] == [(1, "off"), (2, "off")]


def test_interfaz_estatica(client):
    r = client.get("/")
    assert r.status_code == 200 and "sandbox" in r.text


def test_interfaz_spa(client):
    r = client.get("/hdfs/algo")
    assert r.status_code == 200 and "sandbox" in r.text
    assert client.get("/assets/no-esta.js").status_code == 404
    assert client.get("/api/no-esta").json()["code"] == "not_found"


def test_sin_interfaz(settings, tmp_path):
    with TestClient(build_app(settings, ui_dir=tmp_path / "no-hay")) as c:
        assert "no encuentra la interfaz" in c.get("/").text


def test_events_es_sse(settings, tmp_path):
    app = build_app(settings, ui_dir=tmp_path)
    with TestClient(app) as c:
        app.state.bus.close()        # así el stream termina después del saludo
        r = c.get("/api/events")
        assert r.headers["content-type"].startswith("text/event-stream")
        assert r.headers["cache-control"] == "no-cache"
        assert r.text == ": conectado\n\nevent: status\ndata: {}\n\n"


def test_sse_stream_reparte_eventos():
    async def main():
        bus = EventBus()
        gen = sse_stream(bus, keepalive=0.05)
        assert await gen.__anext__() == b": conectado\n\n"
        assert await gen.__anext__() == b"event: status\ndata: {}\n\n"
        bus.log("Vos", "info", "Hola")
        chunk = await gen.__anext__()
        assert chunk.startswith(b"event: activity\ndata: {\"entry\":{\"id\":\"a1\"")
        assert await gen.__anext__() == b": sigo\n\n"
        bus.close()
        with pytest.raises(StopAsyncIteration):
            await gen.__anext__()
        assert bus.subscribers == 0
    asyncio.run(main())


def test_cola_llena_descarta_lo_viejo():
    async def main():
        bus = EventBus()
        q = bus.subscribe()
        for i in range(600):
            bus.publish("status", {"i": i})
        assert q.qsize() == 500 and q.get_nowait()[1]["i"] == 100
    asyncio.run(main())


def test_formato_sse_en_una_linea():
    assert sse_format("activity", {"t": "a\nb"}) == b'event: activity\ndata: {"t":"a\\nb"}\n\n'


def test_la_actividad_sale_en_docker_logs(capsys):
    """python3 -m sandbox_server prende el eco: docker logs muestra arranque y apagado."""
    bus = EventBus()
    bus.log("Cluster", "info", "callado")
    assert capsys.readouterr().out == ""
    bus.echo = True
    bus.log("Cluster", "info", "Apagando el cluster en orden")
    bus.log("Cluster", "warn", "El apagado tardó demasiado")
    assert capsys.readouterr().out.splitlines() == [
        "[Cluster] Apagando el cluster en orden", "[Cluster] WARN: El apagado tardó demasiado"]
