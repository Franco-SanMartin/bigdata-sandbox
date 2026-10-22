"""Pipeline: los seis pasos con las CLIs falsas de falsos.py (HDFS en una carpeta,
Hive y MySQL en archivos, MapReduce/Tez/Spark que imprimen su avance)."""
import asyncio
import json

import pytest
from starlette.testclient import TestClient

from sandbox_server import pipeline as P
from sandbox_server.errors import ApiError


async def esperar(p, sid, segundos=20):
    for _ in range(int(segundos / 0.02)):
        r = next(x for x in p.runs if x["id"] == sid)
        if r["state"] != "running":
            return r
        await asyncio.sleep(0.02)
    raise AssertionError(f"el paso {sid} no terminó")


async def paso(p, stage, tool, **options):
    sid = await p.run({"stage": stage, "tool": tool, "options": options})
    r = await esperar(p, sid)
    assert r["state"] == "done", r.get("error")
    return r


def cli(mundo) -> list[list[str]]:
    return [json.loads(l) for l in (mundo.base / "cli.log").read_text().splitlines()]


# ------------------------------------------------------------------ catálogo


def test_catalogo_con_entrada_salida_y_limites(mundo):
    cat = mundo.pipeline.catalog()
    assert [s["stage"] for s in cat] == P.ORDER
    for s in cat:
        assert s["input"] and s["output"]
        assert sum(1 for t in s["tools"] if t.get("recommended")) == 1
    sqoop = next(t for t in cat[0]["tools"] if t["id"] == "sqoop")
    m = sqoop["options"][0]
    assert (m["id"], m["kind"], m["default"], m["min"], m["max"]) == ("mappers", "number", 4, 1, 8)
    etl = {t["id"]: t for t in cat[1]["tools"]}
    assert etl["pandas"]["available"] and etl["pyspark"]["available"]
    assert not etl["pig"]["available"] and etl["pig"]["unavailableReason"]
    # Sin MySQL no hay Sqoop; con el cluster apagado no hay nada
    mundo.cl.processes = [x for x in mundo.cl.processes if x["id"] != "mysql"]
    sqoop = next(t for t in mundo.pipeline.catalog()[0]["tools"] if t["id"] == "sqoop")
    assert sqoop["unavailableReason"] == "MySQL está apagado"
    mundo.cl.phase = "stopped"
    assert not any(t["available"] for s in mundo.pipeline.catalog() for t in s["tools"])


# ------------------------------------------------------------------ errores de POST step


def test_falta_la_etapa_anterior_es_invalid(mundo):
    async def main():
        with pytest.raises(ApiError) as e:
            await mundo.pipeline.run({"stage": "almacen", "tool": "hivetab"})
        assert e.value.code == "invalid" and "ETL" in str(e.value)
        with pytest.raises(ApiError) as e:
            await mundo.pipeline.run({"stage": "etl", "tool": "pyspark"})
        assert e.value.code == "invalid"
        with pytest.raises(ApiError) as e:
            await mundo.pipeline.run({"stage": "resultados", "tool": "getmerge", "options": {"por": "mes"}})
        assert e.value.code == "invalid" and "por mes" in str(e.value)
        with pytest.raises(ApiError) as e:
            await mundo.pipeline.run({"stage": "analisis", "tool": "hive", "options": {"por": "color"}})
        assert e.value.code == "invalid"
        assert mundo.pipeline.runs == []
    asyncio.run(main())


def test_cluster_apagado_no_disponible_e_inexistente(mundo):
    async def main():
        with pytest.raises(ApiError) as e:
            await mundo.pipeline.run({"stage": "etl", "tool": "pig"})
        assert e.value.code == "unsupported"
        with pytest.raises(ApiError) as e:
            await mundo.pipeline.run({"stage": "etl", "tool": "nada"})
        assert e.value.code == "not_found"
        mundo.cl.phase = "stopped"
        with pytest.raises(ApiError) as e:
            await mundo.pipeline.run({"stage": "ingesta", "tool": "put"})
        assert e.value.code == "cluster_stopped"
    asyncio.run(main())


def test_busy_mientras_corre_un_paso(mundo, monkeypatch):
    monkeypatch.setenv("FALSO_PAUSA", "0.3")

    async def main():
        sid = await mundo.pipeline.run({"stage": "ingesta", "tool": "sqoop"})
        with pytest.raises(ApiError) as e:
            await mundo.pipeline.run({"stage": "ingesta", "tool": "put"})
        assert e.value.code == "busy"
        with pytest.raises(ApiError) as e:
            mundo.pipeline.reset()
        assert e.value.code == "busy"
        r = await esperar(mundo.pipeline, sid)
        assert r["state"] == "done"
    asyncio.run(main())


def test_paso_que_falla_queda_failed_con_la_linea_del_motor(mundo, monkeypatch):
    monkeypatch.setenv("FALSO_FALLA", "sqoop")

    async def main():
        q = mundo.bus.subscribe()
        sid = await mundo.pipeline.run({"stage": "ingesta", "tool": "sqoop", "options": {"mappers": 2}})
        r = await esperar(mundo.pipeline, sid)
        assert r["state"] == "failed"
        assert "Connection refused" in r["error"] and r["message"] == r["error"]
        assert mundo.pipeline.state()["stages"][0]["state"] == "failed"
        evs = []
        while not q.empty():
            evs.append(q.get_nowait())
        assert evs and [d["step"]["state"] for t, d in evs if t == "step"][-1] == "failed"
    asyncio.run(main())


def test_sqoop_import_con_mappers_y_credenciales_por_variable(mundo):
    async def main():
        r = await paso(mundo.pipeline, "ingesta", "sqoop", mappers=3)
        assert r["output"]["path"] == P.TIENDA_VENTAS and r["output"]["rows"] == 6
        assert r["message"] == "6 filas en 3 archivos part-m"
        assert r["appIds"] == ["application_1792041277726_0001"]
        assert r["trace"]["after"]["rows"][0][0] in (1, 2, 3)
        # La clave no aparece en lo que se muestra: va por variable de entorno
        assert '--password "$SQOOP_PASS"' in r["trace"]["command"]
        assert "clave-de-prueba" not in json.dumps(r)
        argv = next(a for a in cli(mundo) if a[0] == "sqoop")
        assert argv[argv.index("--password") + 1] == "clave-de-prueba"
        assert argv[argv.index("-m") + 1] == "3"
        # Fuera de min/max del catálogo (o que no es un entero) es invalid, no se recorta
        for malo in ("muchos", 0, 9, 2.5, True):
            with pytest.raises(ApiError) as e:
                await mundo.pipeline.run({"stage": "ingesta", "tool": "sqoop", "options": {"mappers": malo}})
            assert e.value.code == "invalid" and "de 1 a 8" in str(e.value)
    asyncio.run(main())


# ------------------------------------------------------------------ ML y reset


def test_el_paso_de_ml_deja_el_id_del_modelo(mundo):
    async def main():
        r = await paso(mundo.pipeline, "ml", "sklearn", task="clasificacion")
        assert r["modelId"] == "m1"
        m = mundo.ml.runs[0]
        assert m["id"] == "m1" and m["model"] == "arbol" and m["state"] == "done"
        assert r["message"].startswith("Árbol de decisión: aciertos = 0,9093")
        assert r["trace"]["after"]["columns"] == ["métrica", "valor"]
    asyncio.run(main())


def test_reset_vacia_el_historial(mundo):
    async def main():
        q = mundo.bus.subscribe()
        await paso(mundo.pipeline, "ingesta", "put")
        assert len(mundo.pipeline.steps()) == 1
        mundo.pipeline.reset()
        assert mundo.pipeline.steps() == []
        assert mundo.pipeline.state()["current"] == "ingesta"
        assert all(s["state"] == "pending" for s in mundo.pipeline.state()["stages"])
        evs = []
        while not q.empty():
            evs.append(q.get_nowait())
        assert ("step", {}) in evs
    asyncio.run(main())


# ------------------------------------------------------------------ de punta a punta


def test_pipeline_completo(mundo):
    async def main():
        q = mundo.bus.subscribe()
        p = mundo.pipeline
        r = await paso(p, "ingesta", "put")
        assert r["output"]["path"] == P.SUCIAS and r["output"]["rows"] == 42
        assert (mundo.fs / "user/root/ml/ventas_sucias.csv").exists()
        assert p.state()["current"] == "etl" and p.state()["next"]["stage"] == "almacen"

        r = await paso(p, "etl", "pyspark")
        assert r["appIds"] and r["message"] == "42 → 37 filas, en 2 archivos Parquet"
        assert ["Duplicados eliminados", "2"] in r["output"]["summary"]
        assert r["output"]["rows"] == 37 and r["output"]["sizeMb"] >= 0

        r = await paso(p, "almacen", "hivetab")
        assert r["output"]["path"] == "default.ventas_limpias" and r["output"]["rows"] == 37
        assert r["trace"]["after"]["columns"] == P.LIMPIAS_COLS and len(r["trace"]["after"]["rows"]) == 5
        hive = json.loads((mundo.base / "hive.json").read_text())
        assert hive["default.ventas_limpias"]["columns"][1] == ["fecha", "date"]  # lo escribió Spark

        r = await paso(p, "analisis", "hive", por="sucursal")
        assert r["output"]["path"] == "/user/root/resultados/por_sucursal" and r["output"]["rows"] == 4
        assert r["appIds"] and r["trace"]["after"]["columns"] == ["sucursal", "filas", "facturado"]
        rows = r["trace"]["after"]["rows"]
        assert sum(x[1] for x in rows) == 37 and rows == sorted(rows, key=lambda x: -x[2])

        r = await paso(p, "ml", "sklearn", task="clasificacion")
        assert r["modelId"]

        r = await paso(p, "resultados", "mysql", por="sucursal")
        assert r["output"] == {"path": "tienda.resumen_sucursal", "rows": 4}
        assert r["trace"]["after"]["rows"][0][0] in ("centro", "norte", "sur", "oeste")

        st = p.state()
        assert [s["state"] for s in st["stages"]] == ["done"] * 6
        assert st["current"] == "resultados" and st["next"] is None and st["working"] is None
        assert st["dataset"]["path"] == "tienda.resumen_sucursal" and st["dataset"]["format"] == "tabla MySQL"
        assert [s["stage"] for s in p.steps()] == list(reversed(P.ORDER))

        steps = []
        while not q.empty():
            t, d = q.get_nowait()
            if t == "step":
                steps.append(d["step"])
        assert {s["stage"] for s in steps} == set(P.ORDER)
        assert any(s["state"] == "running" and 0 < s["progress"] < 1 for s in steps)
        assert all(s["state"] == "done" for s in steps if s["progress"] == 1)
    asyncio.run(main())


def test_otras_herramientas(mundo):
    """pandas en el ETL y en el análisis, Parquet, Spark SQL y getmerge."""
    async def main():
        p = mundo.pipeline
        await paso(p, "ingesta", "put")
        r = await paso(p, "etl", "pandas")
        assert r["message"] == "42 → 37 filas, en Parquet"
        assert r["trace"]["before"]["total"] == 42 and len(r["trace"]["after"]["rows"]) == 5
        r = await paso(p, "almacen", "parquet")
        assert r["message"].startswith("1 archivo Parquet")
        r = await paso(p, "almacen", "hivetab")
        hive = json.loads((mundo.base / "hive.json").read_text())
        assert hive["default.ventas_limpias"]["columns"][1] == ["fecha", "timestamp"]  # lo escribió pandas
        r = await paso(p, "analisis", "pandas", por="mes")
        assert r["trace"]["after"]["columns"] == ["mes", "facturado"]
        assert all(x[0] in P.MESES for x in r["trace"]["after"]["rows"])
        r = await paso(p, "analisis", "sparksql", por="producto")
        assert r["appIds"] and r["trace"]["after"]["columns"] == ["producto", "unidades", "facturado"]
        r = await paso(p, "resultados", "getmerge", por="producto")
        assert r["output"] == {"path": "por_producto.csv", "rows": 4}
        assert (mundo.dir / "por_producto.csv").exists()
    asyncio.run(main())


# ------------------------------------------------------------------ rutas


def test_las_14_rutas(mundo, settings, tmp_path):
    """Pipeline, Datos y ML por HTTP, con la forma de ui/API.md y los errores {error, code}."""
    import time

    from sandbox_server.app import build_app
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html>")
    with TestClient(build_app(settings, ui_dir=ui)) as c:
        st = c.app.state
        cl = st.cluster
        cl.phase, cl.config, cl.hdfs = "running", mundo.cl.config, mundo.cl.hdfs
        cl.nn_active_port, cl.processes = 9870, mundo.cl.processes
        st.hdfs.http = mundo.hdfs.http

        r = c.get("/api/pipeline/catalog")
        assert r.status_code == 200 and len(r.json()) == 6
        assert c.get("/api/pipeline").json()["current"] == "ingesta"
        assert c.get("/api/pipeline/steps").json() == []
        r = c.post("/api/pipeline/steps", json={"stage": "almacen", "tool": "hivetab"})
        assert r.status_code == 400 and r.json()["code"] == "invalid" and r.json()["error"]
        r = c.post("/api/pipeline/step", json={"stage": "ingesta", "tool": "put"})
        assert r.status_code == 202 and r.json() == {"id": "p1"}
        fin = time.time() + 15
        while c.get("/api/pipeline/steps").json()[0]["state"] == "running" and time.time() < fin:
            time.sleep(0.05)
        assert c.get("/api/pipeline/steps").json()[0]["state"] == "done"
        r = c.post("/api/pipeline/reset")
        assert r.status_code == 204 and c.get("/api/pipeline/steps").json() == []

        cat = c.get("/api/data/catalog").json()
        assert {x["source"] for x in cat} == {"mysql", "mongodb"}
        r = c.get("/api/data/schema", params={"source": "mysql", "name": "tienda.ventas"})
        assert r.status_code == 200 and r.json()["rows"] == 6
        r = c.get("/api/data/schema", params={"source": "mysql", "name": "tienda.nada"})
        assert r.status_code == 404 and r.json()["code"] == "not_found"
        r = c.post("/api/data/query", json={"source": "mysql", "text": "SELECT * FROM ventas"})
        assert r.status_code == 200 and r.json()["columns"][0] == "id"
        r = c.post("/api/data/query", json={"source": "mysql", "text": "SELECT * FROM nada"})
        assert r.status_code == 500 and r.json() == {"error": "ERROR 1146 (42S02) at line 1: Table 'tienda.nada' "
                                                              "doesn't exist", "code": "failed"}
        r = c.post("/api/data/explain", json={"source": "mysql", "text": "SELECT * FROM ventas"})
        assert r.status_code == 200 and r.json()["source"] == "mysql"
        assert len(c.get("/api/data/examples").json()) > 10

        assert c.get("/api/ml/datasets").json()[0]["id"] == "senal"
        r = c.post("/api/ml/recommend", json={"dataset": "senal", "task": "clasificacion"})
        assert r.status_code == 200 and r.json()["choices"][0]["model"] == "arbol"
        r = c.post("/api/ml/train", json={"dataset": "senal", "task": "clasificacion", "model": "arbol",
                                          "engine": "sklearn", "trainPct": 80})
        assert r.status_code == 202 and r.json() == {"id": "m1"}
        fin = time.time() + 15
        while c.get("/api/ml/models").json()[0]["state"] == "running" and time.time() < fin:
            time.sleep(0.05)
        m = c.get("/api/ml/models").json()[0]
        assert m["state"] == "done" and m["reference"] is False and m["metrics"] == {"aciertos": 0.9093}
