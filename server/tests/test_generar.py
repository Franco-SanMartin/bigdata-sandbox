"""El generador a escala (sandbox_ml/generar.py): lo que valida antes de lanzar el trabajo y, con Spark de verdad
(en la imagen), que los datos tengan la señal de las reglas: las proporciones de los segmentos, el 90 % de la regla
de "vuelve", los nulos de la suciedad y las calificaciones de 1 a 5 para ALS."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from sandbox_ml import generar


def test_valida_el_pedido():
    assert generar.validar("clientes", 1_000_000, "/user/root/ml/generado/c", "parquet", 0.05, None) == []
    assert generar.validar("calificaciones", 1000, "/user/root/ml/x", "csv", 0, 4) == []
    malos = [("otro", 1000, "/user/root/x", "parquet", 0, None), ("clientes", 10, "/user/root/x", "parquet", 0, None),
             ("clientes", 10**10, "/user/root/x", "parquet", 0, None), ("clientes", True, "/user/root/x", "parquet", 0, None),
             ("clientes", 1000, "relativa", "parquet", 0, None), ("clientes", 1000, "/user/root", "parquet", 0, None),
             ("clientes", 1000, "/a/../b", "parquet", 0, None), ("clientes", 1000, "/user/root/x", "xls", 0, None),
             ("clientes", 1000, "/user/root/x", "parquet", 0.9, None), ("clientes", 1000, "/user/root/x", "parquet", 0, 0)]
    for m in malos:
        assert generar.validar(*m), m


def test_la_ruta_del_servidor_valida(mundo):
    import asyncio

    from sandbox_server.errors import ApiError
    from sandbox_server.ml_estudio import Estudio
    e = Estudio(mundo.cl, mundo.runner, mundo.bus, mundo.hdfs, mundo.datos)
    with pytest.raises(ApiError) as err:
        asyncio.run(e.generar({"dataset": "clientes", "filas": 5, "salida": "/user/root/ml/x"}))
    assert err.value.code == "invalid" and "filas" in str(err.value)
    with pytest.raises(ApiError):
        asyncio.run(e.generar({"dataset": "clientes", "filas": 10000, "salida": "/user/root/ml/x", "recursos": {"executors": 999}}))


@pytest.fixture(scope="module")
def spark():
    pytest.importorskip("pyspark")
    from pyspark.sql import SparkSession
    s = (SparkSession.builder.master("local[2]").appName("tests del generador")
         .config("spark.hadoop.fs.defaultFS", "file:///").config("spark.ui.enabled", "false")
         .config("spark.sql.shuffle.partitions", "4").getOrCreate())
    s.sparkContext.setLogLevel("ERROR")
    yield s
    s.stop()


def correr(tmp_path, *args):
    env = {**os.environ, "PYSPARK_SUBMIT_ARGS": "--master local[2] --conf spark.hadoop.fs.defaultFS=file:/// "
                                                 "--conf spark.ui.enabled=false pyspark-shell"}
    out = subprocess.run([sys.executable, str(Path(generar.__file__)), *args], cwd=tmp_path, env=env,
                         capture_output=True, text=True, timeout=600)
    linea = next((l for l in out.stdout.splitlines() if l.startswith(generar.RESULTADO)), None)
    assert out.returncode == 0 and linea, out.stdout[-2000:] + out.stderr[-2000:]
    return json.loads(linea[len(generar.RESULTADO):])


def test_clientes_con_la_senal_de_las_reglas(spark, tmp_path):
    from pyspark.sql import functions as F
    salida = str(tmp_path / "clientes")
    r = correr(tmp_path, "clientes", "--filas", "60000", "--salida", salida, "--suciedad", "0.05", "--particionar")
    assert r["particionado"] and r["filas"] > 60000 and r["archivos"] >= 1        # las repetidas de la suciedad
    d = spark.read.parquet(salida)
    n = d.count()
    seg = {x["s"]: x["count"] / n for x in d.groupBy(F.trim(F.lower("segmento_real")).alias("s")).count().collect()}
    assert abs(seg["ocasional"] - 0.6) < 0.02 and abs(seg["frecuente"] - 0.3) < 0.02 and abs(seg["mayorista"] - 0.1) < 0.02, seg
    regla = ((F.col("visitas_mes") >= 4) & (F.col("reclamos") <= 1)) | (F.col("antiguedad_meses") >= 36)
    acierto = d.agg(F.avg(F.when(regla == (F.col("vuelve") == 1), 1).otherwise(0))).first()[0]
    assert 0.88 < acierto < 0.92, acierto                                           # el 10 % dado vuelta
    assert 0.03 < d.where("edad IS NULL").count() / n < 0.07
    assert d.where(F.col("segmento_real") != F.trim(F.lower("segmento_real"))).count() > 0   # texto desprolijo
    assert set(d.columns) >= {"anio", "mes", "gasto_mes_siguiente", "vuelve"}


def test_calificaciones_para_als(spark, tmp_path):
    from pyspark.sql import functions as F
    salida = str(tmp_path / "calif")
    r = correr(tmp_path, "calificaciones", "--filas", "20000", "--salida", salida, "--formato", "csv")
    assert r["filas"] == 20000 and r["columnas"] == ["usuario", "item", "nota"]
    d = spark.read.option("header", True).option("inferSchema", True).csv(salida)
    fila = d.agg(F.min("nota"), F.max("nota"), F.countDistinct("usuario"), F.countDistinct("item")).first()
    assert fila[0] >= 1 and fila[1] <= 5 and fila[2] > 20 and fila[3] >= 20
