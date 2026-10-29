"""Estudio de ML con Spark de verdad (sandbox_ml.fuentes, perfil_spark y limpieza): cada formato se escribe y se
vuelve a leer con el mismo código que generan los scripts, el perfil sale de los agregados de Spark, la vista
previa de la limpieza cuenta bien las filas afectadas y el modelo entrenado lleva la limpieza adentro.

Necesitan pyspark (y Java): corren adentro de la imagen (franki678/bigdata-sandbox:full) y se saltean solos en
el CI del servidor, que no tiene Spark.

    docker exec <contenedor> bash -c "cd /repo/server && python3 -m pytest -q tests/test_estudio_spark.py"
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

pyspark = pytest.importorskip("pyspark")

from sandbox_ml import fuentes, limpieza as lz, perfil_spark, receta as rec  # noqa: E402
from sandbox_ml import codigo as gen  # noqa: E402

ML = Path(lz.__file__).resolve().parent.parent
# Rutas absolutas como en HDFS, pero en el disco: fs.defaultFS = file:///
CONF = ["--conf", "spark.hadoop.fs.defaultFS=file:///", "--conf", "spark.ui.enabled=false",
        "--conf", "spark.sql.shuffle.partitions=4"]


@pytest.fixture(scope="module")
def spark():
    from pyspark.sql import SparkSession
    s = (SparkSession.builder.master("local[2]").appName("tests del estudio")
         .config("spark.hadoop.fs.defaultFS", "file:///").config("spark.ui.enabled", "false")
         .config("spark.sql.shuffle.partitions", "4").getOrCreate())
    s.sparkContext.setLogLevel("ERROR")
    yield s
    s.stop()


def ventas(spark, n=600):
    """Ventas "sucias": precios con $ y puntos, categorías con espacios y mayúsculas, nulos, un extremo,
    fechas dd/MM/yyyy, filas repetidas y un objetivo con sí/no escrito de varias formas."""
    filas = []
    for i in range(n):
        precio = None if i % 25 == 3 else f"${1000 + 13 * (i % 70)}.{i % 10}0" if i % 3 else str(900 + i % 50)
        if i == 101:
            precio = "999999"
        cat = ("Frecuente", " frecuente", "OCASIONAL", "ocasional ", "mayorista", "rara")[i % 6] if i % 97 else "unica"
        compra = "Sí" if (i % 4 in (0, 1)) else ("si" if i % 7 == 0 else "no")
        filas.append((i // 2 if i < 40 else i, precio, cat, i % 5, f"{1 + i % 28:02d}/{1 + i % 12:02d}/2025",
                      2024 + i % 2, 1 + i % 3, compra))
    return spark.createDataFrame(filas, "id_venta int, precio string, categoria string, cantidad int, fecha string, "
                                        "anio int, mes int, compra string")


# ------------------------------------------------------------------ formatos


def escribir(df, tmp: Path):
    """El mismo DataFrame en todos los formatos (y comprimidos y particionado), como lo dejaría un trabajo de Spark."""
    base = df.drop("anio", "mes")
    destinos = {
        "parquet_part": lambda p: df.write.partitionBy("anio", "mes").parquet(p),
        "orc": lambda p: base.write.orc(p),
        "avro": lambda p: base.write.format("avro").save(p),
        "json": lambda p: base.write.json(p),
        "csv_gz": lambda p: base.write.option("header", True).option("compression", "gzip").csv(p),
        "csv_bz2": lambda p: base.write.option("header", True).option("compression", "bzip2").csv(p),
        "tsv_snappy": lambda p: base.write.option("header", True).option("sep", "\t").option("compression", "snappy").csv(p),
        "texto": lambda p: base.selectExpr("concat_ws('|', *) AS value").write.text(p),
    }
    for nombre, f in destinos.items():
        f(str(tmp / nombre))


def listar(tmp: Path) -> list[dict]:
    return [{"path": str(Path(r) / a).replace(os.sep, "/"), "bytes": (Path(r) / a).stat().st_size}
            for r, _, archivos in os.walk(tmp) for a in archivos]


def leer(spark, d: dict):
    ns = {"spark": spark, "F": __import__("pyspark.sql.functions", fromlist=["F"])}
    exec("\n".join(fuentes.codigo_lector(d)), ns)
    return ns["datos"]


def test_todos_los_formatos_se_detectan_y_se_leen(spark, tmp_path):
    df = ventas(spark)
    escribir(df, tmp_path)
    fs = {Path(f["ruta"]).name: f for f in fuentes.agrupar(listar(tmp_path), ignorar=())}
    assert set(fs) == {"parquet_part", "orc", "avro", "json", "csv_gz", "csv_bz2", "tsv_snappy", "texto"}
    assert fs["parquet_part"]["formato"] == "parquet" and fs["parquet_part"]["particiones"]["columnas"] == ["anio", "mes"]
    assert fs["parquet_part"]["particiones"]["n"] == 6 and fs["parquet_part"]["compresion"] == "snappy"
    assert fs["orc"]["formato"] == "orc" and fs["avro"]["formato"] == "avro"
    assert fs["json"]["formato"] == "json" and fs["json"]["multilinea"] is False
    assert (fs["csv_gz"]["formato"], fs["csv_gz"]["compresion"]) == ("csv", "gzip")
    assert fs["csv_bz2"]["compresion"] == "bz2"
    # Spark escribe el TSV como .csv.snappy: el separador sale de mirar las primeras líneas (descomprimidas)
    assert fs["tsv_snappy"]["compresion"] == "snappy" and fs["tsv_snappy"].get("separador", ",") == ","
    lineas = [r.value for r in spark.read.text(fs["tsv_snappy"]["ruta"]).limit(20).collect()]
    fs["tsv_snappy"]["separador"] = fuentes.adivinar_separador(lineas)
    assert fs["tsv_snappy"]["separador"] == "\t"
    for nombre, f in fs.items():
        d, errores = fuentes.normalizar({k: v for k, v in f.items() if k in ("origen", "ruta", "formato", "separador",
                                                                              "multilinea")})
        assert not errores, (nombre, errores)
        if nombre == "texto":
            d["formato"] = "texto"
        leido = leer(spark, d)
        assert leido.count() == 600, nombre
        if nombre != "texto":
            assert {"id_venta", "precio", "categoria", "compra"} <= set(leido.columns), (nombre, leido.columns)
    # Las particiones son columnas y el filtro las poda
    d, _ = fuentes.normalizar({"origen": "hdfs", "ruta": fs["parquet_part"]["ruta"], "filtro_particiones": "anio = 2025 AND mes = 1"})
    assert leer(spark, d).count() == 100
    # El esquema editado se aplica al leer
    d, _ = fuentes.normalizar({"origen": "hdfs", "ruta": fs["csv_gz"]["ruta"], "formato": "csv", "esquema": {"cantidad": "double"}})
    assert dict(leer(spark, d).dtypes)["cantidad"] == "double"


def test_json_de_un_documento(spark, tmp_path):
    p = tmp_path / "clientes.json"
    p.write_text(json.dumps([{"id": i, "nombre": f"c{i}", "dir": {"ciudad": "Rosario"}} for i in range(5)], indent=2))
    d, _ = fuentes.normalizar({"origen": "hdfs", "ruta": str(p)})
    assert d["formato"] == "json" and d["multilinea"] is True
    df = leer(spark, d)
    assert df.count() == 5
    perfil = perfil_spark.perfilar_df(df)
    cols = {c["nombre"]: c for c in perfil["columnas"]}
    assert cols["dir"]["rol"] == "ignorar" and "anidado" in cols["dir"]["por_que"]


def test_errores_claros(spark, tmp_path):
    for d, esperado in (({"origen": "hdfs", "ruta": str(tmp_path / "no-esta"), "formato": "parquet"}, "No existe"),
                        ({"origen": "hive", "tabla": "no_existe_esta"}, "No existe la tabla")):
        with pytest.raises(Exception) as e:
            leer(spark, d).count()
        assert esperado in fuentes.explicar_error(lz._texto_error(e.value))["mensaje"], lz._texto_error(e.value)[:500]
    (tmp_path / "x.csv").write_text("a,b\n1,2\n")
    with pytest.raises(Exception) as e:
        leer(spark, {"origen": "hdfs", "ruta": str(tmp_path / "x.csv"), "formato": "parquet"}).count()
    assert "Parquet" in fuentes.explicar_error(lz._texto_error(e.value))["mensaje"]


# ------------------------------------------------------------------ perfil


def test_perfil_con_spark(spark):
    df = ventas(spark)
    p = perfil_spark.perfilar_df(df, "compra", "completo")
    assert p["filas"] == 600 and p["filas_total"] == 600 and not p["recortado"] and p["motor"] == "spark"
    c = {x["nombre"]: x for x in p["columnas"]}
    assert c["precio"]["nulos"] == 24 and c["precio"]["tipo"] == "str"
    assert c["cantidad"]["num"]["min"] == 0 and c["cantidad"]["num"]["max"] == 4 and c["cantidad"]["num"]["p50"] == 2
    assert sum(c["cantidad"]["histograma"]["cuentas"]) == 600
    assert abs(c["id_venta"]["unicos"] - 580) < 25          # HyperLogLog: aproximado
    assert c["fecha"]["rol"] == "categorica" and "dd/mm" in c["fecha"]["por_que"]
    assert {t["valor"] for t in c["categoria"]["top"]} >= {"Frecuente", " frecuente", "OCASIONAL"}
    assert p["objetivo"]["tarea"] == "clasificacion" and {b["clase"] for b in c["compra"]["balance"]} == {"Sí", "si", "no"}
    assert p["duplicadas"] == 0 and len(p["vista"]["filas"]) == 20
    m = perfil_spark.perfilar_df(df, None, "muestra", 200)
    assert m["recortado"] and 150 <= m["filas"] <= 200 and m["filas_total"] == 600


def test_perfil_por_spark_submit(tmp_path):
    """El mismo camino que el servidor: spark-submit perfil_spark.py, con la línea @@perfil@@ (y @@error@@)."""
    (tmp_path / "v.csv").write_text("a,b,c\n" + "".join(f"{i},{'x' if i % 2 else 'y'},2025-01-{1 + i % 28:02d}\n" for i in range(50)))
    script = str(ML / "sandbox_ml" / "perfil_spark.py")

    def correr(d):
        return subprocess.run(["spark-submit", "--master", "local[1]", *CONF, script, json.dumps(d), "", "completo"],
                              capture_output=True, text=True, timeout=300)
    r = correr({"origen": "hdfs", "ruta": str(tmp_path / "v.csv"), "formato": "csv", "separador": ","})
    linea = next(l for l in r.stdout.splitlines() if l.startswith("@@perfil@@ "))
    p = json.loads(linea[11:])
    assert p["filas"] == 50 and p["fuente"]["archivos"] == 1 and p["fuente"]["bytes"] > 0
    assert {c["nombre"]: c["rol"] for c in p["columnas"]}["c"] == "fecha"
    r = correr({"origen": "hdfs", "ruta": str(tmp_path / "nada"), "formato": "parquet"})
    assert r.returncode != 0
    err = json.loads(next(l for l in r.stdout.splitlines() if l.startswith("@@error@@ "))[10:])
    assert err["mensaje"].startswith("No existe")


# ------------------------------------------------------------------ limpieza

PASOS = [
    {"tipo": "regex", "columna": "precio", "patron": "[$]", "reemplazo": ""},
    {"tipo": "tipo", "columna": "precio", "a": "double"},
    {"tipo": "outliers", "columna": "precio", "metodo": "iqr", "factor": 3, "accion": "recortar"},
    {"tipo": "nulos", "columna": "precio", "estrategia": "mediana", "indicador": True},
    {"tipo": "texto", "columna": "categoria", "ops": ["recortar", "minusculas"]},
    {"tipo": "raras", "columna": "categoria", "min_pct": 0.05},
    {"tipo": "fecha", "columna": "fecha", "formato": "dd/MM/yyyy", "partes": ["mes", "dia_semana"]},
    {"tipo": "derivada", "nombre": "total", "expresion": "precio * cantidad"},
    {"tipo": "texto", "columna": "compra", "ops": ["sin_acentos", "minusculas"]},
    {"tipo": "duplicados", "columnas": ["id_venta"]},
    {"tipo": "filtro", "condicion": "cantidad > 0"},
    {"tipo": "mapeo", "columna": "categoria", "mapa": {"frecuente": "F"}, "resto": "conservar"},
]


def test_vista_previa_de_la_limpieza(spark):
    lim, errores, _, nuevas = lz.normalizar({"pasos": PASOS}, "compra", ventas(spark).columns)
    assert not errores, errores
    assert nuevas == {"precio_nulo": "numerica", "fecha_mes": "numerica", "fecha_dia_semana": "numerica", "total": "numerica"}
    v = lz.vista_previa(spark, ventas(spark), lim, "compra")
    p = {r["paso"]: r for r in v["pasos"]}
    assert all(r["ok"] for r in v["pasos"]), [(r["paso"], r["error"]) for r in v["pasos"] if not r["ok"]]
    # Solo de entrenamiento: duplicados (los 20 id repetidos), filtro y el objetivo
    assert p[9]["fase"] == "entrenamiento" and p[9]["afectadas"] == 20 and p[9]["filas_despues"] == 580
    # (de cada id repetido queda una fila cualquiera: cuántas tienen cantidad 0 depende de cuál)
    assert 110 <= p[10]["afectadas"] <= 124 and p[10]["filas_despues"] == 580 - p[10]["afectadas"]
    assert p[8]["fase"] == "entrenamiento" and p[8]["afectadas"] == 300     # "Sí" → "si"
    n = p[10]["filas_despues"]
    assert v["filas"] == {"leidas": 600, "entrenamiento": n}
    # Adentro del modelo, sobre lo que quedó
    assert p[0]["fase"] == "modelo" and p[0]["afectadas"] > 200
    assert p[2]["aprendido"]["alto"] < 999999 and p[2]["afectadas"] == 1           # el 999999
    assert 10 < p[3]["afectadas"] < 30 and 1000 < p[3]["aprendido"]["mediana"] < 2000   # los nulos (1 de cada 25)
    assert p[3]["ejemplos"]["columnas"] == ["precio (antes)", "precio (después)", "precio_nulo (después)"]
    assert set(p[5]["aprendido"]["conservar"]) == {"frecuente", "ocasional", "mayorista", "rara"}
    final = dict(zip(v["final"]["columnas"], zip(*v["final"]["filas"])))
    assert set(final["categoria"]) <= {"F", "ocasional", "mayorista", "rara", "(otra)"}
    assert all(isinstance(x, float) for x in final["precio"]) and set(final["compra"]) <= {"si", "no"}
    assert all(t is not None for t in final["total"])


def test_un_paso_que_falla_no_frena_los_demas(spark):
    lim, _, _, _ = lz.normalizar({"pasos": [{"tipo": "derivada", "nombre": "x", "expresion": "no_existe + 1"},
                                            {"tipo": "filtro", "condicion": "cantidad >"},
                                            {"tipo": "tipo", "columna": "cantidad", "a": "double"}]})
    v = lz.vista_previa(spark, ventas(spark), lim)
    p = {r["paso"]: r for r in v["pasos"]}
    assert not p[0]["ok"] and "no_existe" in p[0]["error"]["mensaje"]
    assert not p[1]["ok"] and "sintaxis" in p[1]["error"]["mensaje"]
    assert p[2]["ok"] and "x" not in v["final"]["columnas"]


def receta_spark(ruta: str, **kw) -> dict:
    r = {"datos": {"origen": "hdfs", "ruta": ruta, "formato": "parquet"}, "tarea": "clasificacion", "objetivo": "compra",
         "columnas": {"precio": "numerica", "precio_nulo": "numerica", "categoria": "categorica", "cantidad": "numerica",
                      "fecha_mes": "numerica", "fecha_dia_semana": "numerica", "total": "numerica", "id_venta": "id",
                      "fecha": "ignorar", "anio": "ignorar", "mes": "ignorar"},
         "modelo": {"id": "bosque_clf_spark", "params": {"numTrees": 10, "maxDepth": 4}},
         "validacion": {"particion": "aleatoria", "cv": "ninguna", "metrica": "exactitud"},
         "preproceso": {"outliers": "recortar_iqr"}, "limpieza": {"nombre": "ventas", "version": 2, "pasos": PASOS}}
    r.update(kw)
    return rec.validar(r)


def test_entrenar_con_la_limpieza_adentro_y_predecir_datos_crudos(spark, tmp_path):
    """El script generado corre de punta a punta y el modelo guardado limpia solo los datos nuevos (crudos, sin el objetivo)."""
    ruta = str(tmp_path / "ventas")
    ventas(spark).write.parquet(ruta)
    r = receta_spark(ruta)
    codigo = gen.generar(r, "exp-prueba", "hoy")
    (tmp_path / "entrenar.py").write_text(codigo)
    env = {**os.environ, "SANDBOX_ML_EXPERIMENTOS": str(tmp_path / "exps"), "SANDBOX_ML_EXP": str(tmp_path / "exps" / "exp-prueba"),
           "PYSPARK_SUBMIT_ARGS": " ".join(["--master", "local[2]", *CONF, "pyspark-shell"])}
    (tmp_path / "exps" / "exp-prueba").mkdir(parents=True)
    out = subprocess.run([sys.executable, "entrenar.py"], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=600)
    assert out.returncode == 0, out.stdout[-3000:] + out.stderr[-3000:]
    assert re.search(r"Limpieza de entrenamiento: 600 → 4[5-7][0-9] filas", out.stdout), out.stdout[-2000:]
    from pyspark.ml import PipelineModel
    modelo = PipelineModel.load("/user/root/ml/modelos/exp-prueba")
    assert type(modelo.stages[0]).__name__ == "Limpiar"
    nuevos = ventas(spark, 30).drop("compra")
    pred = modelo.transform(nuevos).select("precio", "categoria", "prediction").collect()
    assert len(pred) == 30 and all(isinstance(f["precio"], float) for f in pred)
    assert {f["categoria"] for f in pred} <= {"F", "ocasional", "mayorista", "rara", "(otra)"}


def test_scripts_de_limpieza_y_perfil_corren_solos(tmp_path, spark):
    ruta = str(tmp_path / "crudo")
    ventas(spark).write.option("header", True).option("compression", "gzip").csv(ruta)
    d, _ = fuentes.normalizar({"origen": "hdfs", "ruta": ruta, "formato": "csv"})
    lim, _, _, _ = lz.normalizar({"nombre": "ventas prueba", "version": 1, "pasos": PASOS}, "compra")
    (tmp_path / "limpieza.py").write_text(lz.script(d, lim, "compra", "hoy"))
    (tmp_path / "perfil.py").write_text(perfil_spark.script(d, "compra", "completo"))
    for archivo in ("limpieza.py", "perfil.py"):
        out = subprocess.run(["spark-submit", "--master", "local[2]", *CONF, archivo], cwd=tmp_path,
                             capture_output=True, text=True, timeout=600)
        assert out.returncode == 0, (archivo, out.stdout[-3000:], out.stderr[-3000:])
    assert 456 <= spark.read.parquet("/user/root/ml/limpios/ventas_prueba-v1").count() <= 470
    from pyspark.ml import PipelineModel
    lim_modelo = PipelineModel.load("/user/root/ml/limpios/ventas_prueba-v1_limpieza")
    assert "precio_nulo" in lim_modelo.transform(ventas(spark, 10)).columns
    perfil = json.loads((tmp_path / "perfil_crudo.json").read_text())
    assert perfil["filas"] == 600 and perfil["fuente"]["compresion"] == "gzip"
