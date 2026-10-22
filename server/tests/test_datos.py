"""Datos: catálogo, esquema, consultas y planes de Hive, MySQL y MongoDB con las
CLIs falsas de falsos.py (beeline, mysql y mongosh)."""
import asyncio
import json

import pytest

from conftest import fixture_text
from sandbox_server import datos as D
from sandbox_server.errors import ApiError

FILAS = "ticket,fecha,sucursal,producto,cantidad,precio,importe,medio_pago\n" + "".join(
    f"{i},2026-0{1 + i % 3}-10,{['centro', 'norte'][i % 2]},yerba,{1 + i % 2},2652,{2652 * (1 + i % 2)},qr\n"
    for i in range(1, 8))


def con_tabla_de_hive(mundo):
    """default.ventas_limpias externa sobre /user/root/ml/ventas_limpias (siete filas)."""
    d = mundo.fs / "user/root/ml/ventas_limpias"
    d.mkdir(parents=True)
    (d / "part-00000.parquet").write_text(FILAS)
    cols = [["ticket", "bigint"], ["fecha", "date"], ["sucursal", "string"], ["producto", "string"],
            ["cantidad", "int"], ["precio", "bigint"], ["importe", "bigint"], ["medio_pago", "string"]]
    (mundo.base / "hive.json").write_text(json.dumps(
        {"default.ventas_limpias": {"columns": cols, "location": "/user/root/ml/ventas_limpias"}}))


def test_catalogo_de_las_tres_fuentes(mundo):
    con_tabla_de_hive(mundo)

    async def main():
        cat = await mundo.datos.catalog()
        by = {(x["source"], x["name"]): x for x in cat}
        h = by[("hive", "default.ventas_limpias")]
        assert h["kind"] == "externa" and h["location"] == "/user/root/ml/ventas_limpias"
        assert h["columns"][:2] == [{"name": "ticket", "type": "BIGINT"}, {"name": "fecha", "type": "DATE"}]
        m = by[("mysql", "tienda.ventas")]
        assert m == {"source": "mysql", "name": "tienda.ventas", "kind": "tabla", "rows": 6,
                     "columns": [{"name": "id", "type": "INT PK"}, {"name": "fecha", "type": "DATE"},
                                 {"name": "sucursal", "type": "VARCHAR(20)"}, {"name": "producto", "type": "VARCHAR(20)"},
                                 {"name": "cantidad", "type": "INT"}, {"name": "precio", "type": "INT"}]}
        g = by[("mongodb", "tienda.productos")]
        assert g["kind"] == "colección" and g["rows"] == 2
        assert {"name": "colores", "type": "array, a veces"} in g["columns"]
        # Una fuente apagada no aparece y no rompe el resto
        mundo.cl.processes = [p for p in mundo.cl.processes if p["id"] != "mongodb"]
        mundo.datos.invalidate()
        assert {x["source"] for x in await mundo.datos.catalog()} == {"hive", "mysql"}
        mundo.cl.phase = "stopped"
        with pytest.raises(ApiError) as e:
            await mundo.datos.catalog()
        assert e.value.code == "cluster_stopped"
    asyncio.run(main())


def test_esquema(mundo):
    con_tabla_de_hive(mundo)

    async def main():
        h = await mundo.datos.schema("hive", "default.ventas_limpias")
        assert h["format"] == "parquet" and h["ddl"].startswith("CREATE EXTERNAL TABLE `default.ventas_limpias`(")
        assert h["sample"]["columns"][0] == "ticket" and len(h["sample"]["rows"]) == 5
        assert h["sizeMb"] > 0
        m = await mundo.datos.schema("mysql", "tienda.ventas")
        assert m["indexes"] == [{"name": "PRIMARY", "columns": ["id"], "unique": True}]
        assert m["columns"][0]["key"] == "PK" and m["sample"]["total"] == 6 and m["format"] == "InnoDB"
        g = await mundo.datos.schema("mongodb", "tienda.productos")
        assert g["sample"]["rows"][0] == ['{ _id: "yerba", precio: 2652, stock: 120 }']
        assert g["columns"][0] == {"name": "_id", "type": "string", "presence": 100.0, "key": "PK"}
        for src, name, code in (("hive", "default.nada", "not_found"), ("mysql", "sinpunto", "invalid"),
                                ("oracle", "a.b", "invalid")):
            with pytest.raises(ApiError) as e:
                await mundo.datos.schema(src, name)
            assert e.value.code == code
    asyncio.run(main())


def test_consultas(mundo):
    con_tabla_de_hive(mundo)

    async def main():
        r = await mundo.datos.query("hive", "SELECT * FROM default.ventas_limpias LIMIT 3")
        assert r["engine"] == "uno" and "appId" not in r and r["columns"][0] == "ticket" and len(r["rows"]) == 3
        r = await mundo.datos.query("hive", "SELECT sucursal, COUNT(*) AS filas FROM default.ventas_limpias "
                                            "GROUP BY sucursal")
        assert r["engine"] == "tez" and r["appId"].startswith("application_") and r["trace"]["appIds"] == [r["appId"]]
        r = await mundo.datos.query("mysql", "SELECT * FROM ventas ORDER BY precio DESC LIMIT 2")
        assert r["rows"][0][:3] == [3, "2026-01-03", "sur"] and r["scanned"] == 9
        r = await mundo.datos.query("mongodb", "db.productos.find()")
        assert r["columns"] == ["documento"] and len(r["rows"]) == 2
    asyncio.run(main())


def test_errores_de_consulta_con_la_ultima_linea_del_motor(mundo):
    """Punto 5: code failed y el mensaje es la última línea de error que imprimió el motor."""
    async def main():
        with pytest.raises(ApiError) as e:
            await mundo.datos.query("hive", "SELECT * FROM nada")
        assert e.value.code == "failed"
        assert str(e.value) == "FAILED: SemanticException [Error 10001]: Line 1:14 Table not found 'nada'"
        with pytest.raises(ApiError) as e:
            await mundo.datos.query("hive", "SELEC 1")
        assert str(e.value) == "FAILED: ParseException line 1:0 cannot recognize input near 'SELEC' '<EOF>' '<EOF>'"
        with pytest.raises(ApiError) as e:
            await mundo.datos.query("mysql", "SELECT * FROM nada")
        assert (e.value.code, str(e.value)) == ("failed", "ERROR 1146 (42S02) at line 1: Table 'tienda.nada' doesn't exist")
        with pytest.raises(ApiError) as e:
            await mundo.datos.query("mongodb", "db.productos.find({)")
        assert (e.value.code, str(e.value)) == ("failed", "SyntaxError: Unexpected token (2:20)")
        with pytest.raises(ApiError) as e:
            await mundo.datos.explain("mysql", "SELEC 1")
        assert e.value.code == "failed" and str(e.value).startswith("ERROR 1064 (42000)")
        # En MongoDB una colección que no existe da cero documentos, no un error
        r = await mundo.datos.query("mongodb", "db.noexiste.find()")
        assert r["rows"] == [] and r["trace"]["output"].startswith("0 filas")
        with pytest.raises(ApiError) as e:
            await mundo.datos.query("mysql", "  ")
        assert e.value.code == "invalid"
        mundo.cl.processes = [p for p in mundo.cl.processes if p["id"] != "mysql"]
        with pytest.raises(ApiError) as e:
            await mundo.datos.query("mysql", "SELECT 1")
        assert e.value.code == "service_down"
    asyncio.run(main())


def test_errores_reales_de_cada_motor():
    """Con las salidas reales del humo (Hive 4.0.0 por beeline, MariaDB, mongosh)."""
    esperado = {
        "hive": "FAILED: SemanticException [Error 10001]: Line 1:14 Table not found 'no_existe_humo'",
        "mysql": "ERROR 1146 (42S02) at line 1: Table 'tienda.no_existe_humo' doesn't exist",
        "mongodb": "MongoServerError: unknown top level operator: $nada. If you have a field name that starts "
                   "with a '$' symbol, consider using $getField or $setField.",
    }
    for src, msg in esperado.items():
        e = D.Datos.error_of(src, 1, "", fixture_text(f"error_{src}.txt"))
        assert (e.code, str(e)) == ("failed", msg)


def test_planes(mundo):
    async def main():
        h = await mundo.datos.explain("hive", "SELECT * FROM ventas_limpias LIMIT 5")
        assert h["source"] == "hive" and h["engine"] == "uno"
        assert [x["label"] for x in h["nodes"]] == ["Fetch Operator", "TableScan", "Select Operator"]
        m = await mundo.datos.explain("mysql", "SELECT * FROM ventas")
        assert m["nodes"][1] == {"id": 1, "label": "Recorre ventas entera (ALL)", "children": [], "rows": 6}
        g = await mundo.datos.explain("mongodb", "db.productos.find({ precio: 2652 })")
        assert g["nodes"][0]["label"] == "COLLSCAN" and "executionStats.totalDocsExamined: 2" in g["raw"]
        with pytest.raises(ApiError) as e:
            await mundo.datos.explain("mongodb", "1 + 1")
        assert e.value.code == "invalid"
    asyncio.run(main())


def test_ejemplos():
    ex = D.Datos.examples(None)  # no usa el estado
    assert {x["source"] for x in ex} == {"hive", "mysql", "mongodb"}
    assert all(x["text"] and x["label"] and x["script"].startswith("ejemplos/") for x in ex)


def test_el_pipeline_invalida_el_catalogo(mundo):
    """Punto 7: después de un paso que crea una tabla, el catálogo ya la trae (no queda en caché)."""
    async def main():
        assert not any(x["source"] == "hive" for x in await mundo.datos.catalog())
        con_tabla_de_hive(mundo)
        assert not any(x["source"] == "hive" for x in await mundo.datos.catalog())  # caché
        mundo.datos.invalidate("hive")
        assert any(x["name"] == "default.ventas_limpias" for x in await mundo.datos.catalog())
    asyncio.run(main())


def test_hive_rows_sin_estadisticas():
    assert D.hive_rows({}) is None
    assert D.hive_rows({"numRows": "0"}) is None
    assert D.hive_rows({"numRows": "-1"}) is None
    assert D.hive_rows({"numRows": "0", "COLUMN_STATS_ACCURATE": '{"BASIC_STATS":"true"}'}) == 0
    assert D.hive_rows({"numRows": "1200"}) == 1200
