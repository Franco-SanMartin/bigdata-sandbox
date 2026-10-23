"""Datos: catálogo, esquema, consultas y planes de Hive, MySQL y MongoDB con las
CLIs falsas de falsos.py (beeline, mysql y mongosh). Pig no tiene CLI falsa: se
reemplaza Datos.exec y se le da la salida real guardada en fixtures/pig_*.txt."""
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
    assert {x["source"] for x in ex} == {"hive", "mysql", "mongodb", "pig"}
    assert all(x["text"] and x["label"] and x["script"].startswith("ejemplos/") for x in ex)
    assert any(x["label"] == "Crear tabla ventas desde HDFS" and x["source"] == "hive" for x in ex)
    # Los ejemplos de Pig pasan el control de la interfaz
    for x in ex:
        if x["source"] == "pig":
            D.pig_check(x["text"])


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


# ---------------------------------------------------------------- Pig

@pytest.mark.parametrize("script", [
    "sh ls /;",
    "a = LOAD 'x';\nSH rm -rf /;",
    "exec otro.pig;",
    "run /tmp/otro.pig;",
    "a = LOAD 'x'; b = STREAM a THROUGH `cat`; DUMP b;",
    "%declare hoy `date`\na = LOAD 'x';",
    "DEFINE cmd `python3 x.py`;",
    "fs -rm -r /tmp/algo;",
    "fs -rm -r -f /user;",
    "fs -rm -r /user/root;",
    "fs -rmr /user/hive/warehouse/ventas;",
    "fs -rm -r hdfs://nn:8020/;",
    "fs -rm -r /user/root/../../tmp;",
    "fs -rm -r /user/*/datos;",
    "rmf /tmp/x;",
    "rm /;",
    "%default salida '/tmp/afuera'\nfs -rm -r -f $salida;",
    "fs -rm -r -f $sin_definir;",
    "fs -get /user/root/ventas /etc;",
    "copyToLocal /user/root/ventas /root;",
    "REGISTER 'udfs.py' USING jython AS u;",
])
def test_pig_bloquea_lo_peligroso(script):
    with pytest.raises(ApiError) as e:
        D.pig_check(script)
    assert e.value.code == "invalid" and "terminal del contenedor" in str(e.value)


@pytest.mark.parametrize("script", [
    "a = LOAD '/user/root/ventas';\nDUMP a;",
    "-- sh ls\n/* exec x.pig; */ a = LOAD '/user/root/ventas'; DUMP a;",
    "a = LOAD '/user/root/ventas'; b = FILTER a BY $0 == 'sh ls; exec' ; DUMP b;",
    "fs -rm -r -f /user/root/resultados/pig;",
    "fs -rm -r -f resultados/pig;",
    "%default salida '/user/root/resultados/pig_por_producto'\nfs -rm -r -f $salida;",
    "rm = LOAD '/user/root/ventas'; DUMP rm;",
    "REGISTER /opt/pig/lib/piggybank.jar;",
])
def test_pig_deja_pasar_lo_normal(script):
    D.pig_check(script)


def test_pig_prepara_describe_antes_de_cada_dump():
    script, dumps = D.pig_prepare("-- arriba\na = LOAD 'x';\nDUMP a;\nb = LIMIT a 2;\n  dump b ;")
    assert dumps == ["a", "b"]
    lines = script.splitlines()
    assert lines[0].strip() == ""  # el comentario queda en blanco: los números de línea no se mueven
    assert lines[2] == "DESCRIBE a; DUMP a;" and lines[4] == "  DESCRIBE b; dump b ;"


def test_pig_parsea_describe_y_dump():
    bloques = D.parse_pig_dump(fixture_text("pig_dump.txt"))
    assert [b["alias"] for b in bloques] == ["filas", "resumen"]
    f = bloques[0]
    assert f["columns"] == ["fecha", "sucursal", "producto", "cantidad", "precio"]
    assert f["rows"][1] == ["2026-01-02", "norte", None, 1, None]
    r = bloques[1]
    assert r["columns"] == ["sucursal", "tickets", "unidades"]
    assert r["rows"][0] == ["centro", 412, 655] and r["rows"][2][2] == 0.5
    assert r["rows"][3] == [None, 3, "{(a),(b,c)}"]
    # Sin DESCRIBE (o con otro ancho), las columnas son $0, $1…
    sin = D.parse_pig_dump("Schema for x unknown.\n(a,1)\n(b,2)\n")
    assert sin == [{"alias": "x", "columns": ["$0", "$1"], "rows": [["a", 1], ["b", 2]]}]


def test_pig_error_con_el_mensaje_que_importa():
    e = D.pig_error("", fixture_text("pig_error.txt"), 6)
    assert e.code == "failed" and str(e).startswith("ERROR 1025: <file consulta.pig, line 4, column 30> Invalid field")
    e = D.pig_error("", "solo una línea rara\n", 2)
    assert str(e) == "solo una línea rara"


def test_pig_explain():
    script, alias = D.pig_explain_script(
        "%default salida '/user/root/r'\na = LOAD 'x';\nb = GROUP a BY $0;\nDUMP b;\n"
        "fs -rm -r -f $salida;\nSTORE b INTO '$salida';")
    assert alias == "b" and "DUMP" not in script and "STORE" not in script and "fs " not in script
    assert script.startswith("%default salida") and script.rstrip().endswith("EXPLAIN b;")
    with pytest.raises(ApiError):
        D.pig_explain_script("fs -ls /user/root;")
    plan = D.parse_pig_explain(fixture_text("pig_explain.txt").splitlines())
    assert plan["engine"] == "mr" and plan["yarnStages"] == 2
    raiz, primero = plan["nodes"]
    assert raiz["label"] == "Trabajo MapReduce 2 (scope-40)" and raiz["children"] == [1]
    assert primero["label"] == "Trabajo MapReduce 1 (scope-35)" and primero["children"] == []
    assert primero["detail"].startswith("map: Load → New For Each → Filter → Local Rearrange · combine:")
    assert "reduce: Package → New For Each → Store" in primero["detail"]


def pig_falso(mundo, monkeypatch, salida="", err="", rc=0):
    """Reemplaza Datos.exec: guarda el argv y el script que Pig recibiría."""
    vistos = []

    async def exec_(self, argv, timeout=120, cwd=None):
        assert argv[:3] == ["pig", "-x", "mapreduce"] and argv[-2] == "-f"
        with open(argv[-1]) as f:
            vistos.append({"argv": argv, "script": f.read(), "timeout": timeout, "cwd": cwd})
        return rc, salida, err
    monkeypatch.setattr(D.Datos, "exec", exec_)
    return vistos


def test_pig_consulta(mundo, monkeypatch):
    vistos = pig_falso(mundo, monkeypatch, fixture_text("pig_dump.txt"), fixture_text("pig_stderr.txt"))

    async def main():
        r = await mundo.datos.query("pig", "a = LOAD '/user/root/ventas';\nDUMP a;\nb = LIMIT a 1;\nDUMP b;")
        assert r["columns"] == ["sucursal", "tickets", "unidades"] and len(r["rows"]) == 4
        assert r["engine"] == "mr" and r["appId"] == "application_1761220000000_0008"
        assert r["trace"]["appIds"] == ["application_1761220000000_0007", "application_1761220000000_0008"]
        assert r["trace"]["command"] == "pig -x mapreduce -f consulta.pig"
        assert "2 trabajos MapReduce" in r["trace"]["action"] and "último" in r["note"]
        v = vistos[0]
        assert "DESCRIBE a; DUMP a;" in v["script"] and v["timeout"] == D.PIG_TIMEOUT
        # El archivo temporal se borra al terminar
        import os
        assert not os.path.exists(v["argv"][-1]) and not os.path.exists(v["cwd"])
        # Lo peligroso no llega a correr
        with pytest.raises(ApiError) as e:
            await mundo.datos.query("pig", "sh rm -rf /;")
        assert e.value.code == "invalid" and len(vistos) == 1
        # Sin DUMP: listo, sin columnas
        r = await mundo.datos.query("pig", "a = LOAD 'x'; STORE a INTO '/user/root/r';")
        assert r["columns"] == [] and "STORE" in r["note"] and r["trace"]["output"].startswith("Listo")
    asyncio.run(main())


def test_pig_error_y_servicios(mundo, monkeypatch):
    pig_falso(mundo, monkeypatch, "", fixture_text("pig_error.txt"), 6)

    async def main():
        with pytest.raises(ApiError) as e:
            await mundo.datos.query("pig", "a = LOAD 'x'; DUMP a;")
        assert e.value.code == "failed" and "cantidd" in str(e.value) and str(e.value).startswith("ERROR 1025")
        with pytest.raises(ApiError) as e:
            await mundo.datos.schema("pig", "a.b")
        assert e.value.code == "invalid"
        mundo.cl.processes = [p for p in mundo.cl.processes if p["id"] != "nm"]
        with pytest.raises(ApiError) as e:
            await mundo.datos.query("pig", "a = LOAD 'x'; DUMP a;")
        assert e.value.code == "service_down"
        mundo.cl.processes = [p for p in mundo.cl.processes if p["id"] != "rm"]
        with pytest.raises(ApiError) as e:
            await mundo.datos.explain("pig", "a = LOAD 'x'; DUMP a;")
        assert e.value.code == "service_down" and "YARN" in str(e.value)
    asyncio.run(main())


def test_pig_plan(mundo, monkeypatch):
    vistos = pig_falso(mundo, monkeypatch, fixture_text("pig_explain.txt"))

    async def main():
        p = await mundo.datos.explain("pig", "a = LOAD 'x';\nb = GROUP a BY $0;\nDUMP b;")
        assert p["source"] == "pig" and p["yarnStages"] == 2 and p["raw"][0].startswith("#---")
        assert vistos[0]["script"].rstrip().endswith("EXPLAIN b;")
    asyncio.run(main())
