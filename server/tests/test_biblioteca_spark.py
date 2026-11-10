"""La predicción por lotes de la biblioteca, de punta a punta con Spark de verdad: un modelo de Spark MLlib y uno de
scikit-learn (repartido con mapInPandas) entrenados con el script del estudio, guardados en la biblioteca y usados
sobre datos nuevos: validación del esquema, deriva contra el entrenamiento, predicciones escritas y su resumen.

Necesitan pyspark (y Java): corren adentro de la imagen y se saltean solos en el CI del servidor.

    docker exec <contenedor> bash -c "cd /repo/server && python3 -m pytest -q tests/test_biblioteca_spark.py"
"""
import json
import os
import subprocess
import sys

import pytest

pytest.importorskip("pyspark")

from sandbox_ml import biblioteca as bib  # noqa: E402
from sandbox_ml import codigo as gen  # noqa: E402
from sandbox_ml import lote  # noqa: E402
from sandbox_ml import receta as rec  # noqa: E402

from test_estudio_modelos_spark import CONF, clientes, correr  # noqa: E402

COLUMNAS = {"id": "id", "antiguedad": "numerica", "visitas": "numerica", "ticket": "numerica", "plan": "categorica"}


@pytest.fixture(scope="module")
def spark():
    from pyspark.sql import SparkSession
    s = (SparkSession.builder.master("local[2]").appName("tests de la biblioteca")
         .config("spark.hadoop.fs.defaultFS", "file:///").config("spark.ui.enabled", "false")
         .config("spark.sql.shuffle.partitions", "4").getOrCreate())
    s.sparkContext.setLogLevel("ERROR")
    yield s
    s.stop()


@pytest.fixture(scope="module")
def datos(spark, tmp_path_factory):
    """El entrenamiento (parquet y csv), datos nuevos parecidos, datos nuevos corridos y datos sin una columna."""
    from pyspark.sql import functions as F
    base = tmp_path_factory.mktemp("lote")
    filas, esquema = clientes(n=1500, semilla=7)
    df = spark.createDataFrame(filas, esquema)
    df.write.parquet(str(base / "entrenamiento"))
    df.toPandas().to_csv(base / "entrenamiento.csv", index=False)
    nuevos, _ = clientes(n=800, semilla=99)
    n = spark.createDataFrame(nuevos, esquema).drop("clase").withColumn("sucursal", F.lit("centro"))
    # visitas llega como texto (con algunos valores que no son números): el lote la convierte y lo cuenta
    n.withColumn("visitas", F.when(F.col("id") % 100 == 0, F.lit("s/d")).otherwise(F.col("visitas").cast("string"))) \
        .write.parquet(str(base / "nuevos"))
    n.withColumn("antiguedad", F.col("antiguedad") + 40).write.parquet(str(base / "corridos"))
    n.drop("ticket").write.parquet(str(base / "incompletos"))
    return base


def correr_lote(codigo, tmp_path):
    (tmp_path / "lote.py").write_text(codigo)
    env = {**os.environ, "PYSPARK_SUBMIT_ARGS": " ".join(["--master", "local[2]", *CONF, "pyspark-shell"])}
    out = subprocess.run([sys.executable, "lote.py"], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=900)
    linea = next((l for l in reversed(out.stdout.splitlines()) if l.startswith(lote.PREDICCION)), None)
    return out, json.loads(linea[len(lote.PREDICCION):]) if linea else None


def guardar(nombre, exp_dir, tmp_path):
    base = tmp_path / "bib"
    x = bib.registrar(nombre, exp_dir, base=base)
    return x, base / nombre / f"v{x['version']}"


def test_lote_con_un_modelo_de_spark(datos, tmp_path):
    r = rec.validar({"datos": {"origen": "hdfs", "ruta": str(datos / "entrenamiento"), "formato": "parquet"},
                     "tarea": "clasificacion", "objetivo": "clase", "columnas": COLUMNAS,
                     "modelo": {"id": "logistica_spark", "params": {}}})
    exp, _, _ = correr(r, tmp_path)
    assert (tmp_path / "exps" / "exp" / "referencia.json").is_file()
    assert [c["columna"] for c in exp["entrada"]] == ["antiguedad", "visitas", "ticket", "plan"]
    assert exp["entrada"][0]["tipo"] == "double" and exp["entrada"][3]["tipo"] == "string"
    x, dv = guardar("churn", tmp_path / "exps" / "exp", tmp_path)
    salida = {"tipo": "hdfs", "ruta": str(tmp_path / "pred"), "formato": "parquet", "modo": "overwrite"}
    codigo = lote.generar(x, dv, {"origen": "hdfs", "ruta": str(datos / "nuevos"), "formato": "parquet"}, salida,
                          nombre="churn")
    out, res = correr_lote(codigo, tmp_path)
    assert out.returncode == 0 and res, out.stdout[-3000:] + out.stderr[-3000:]
    assert res["filas"] == 800 and res["version"] == 1
    assert res["columnas"][:6] == ["id", "antiguedad", "visitas", "ticket", "plan", "sucursal"]
    assert {"prediccion", "prob_no_vuelve", "prob_vuelve"} <= set(res["columnas"])
    assert set(res["conteo"]) <= {"vuelve", "no_vuelve"} and sum(res["conteo"].values()) == 800
    # Esquema: visitas llegó como texto y 8 valores no se pudieron convertir; sucursal sobra (va a la salida igual)
    conv = {c["columna"]: c for c in res["esquema"]["convertidas"]}
    assert conv["visitas"]["de"] == "string" and conv["visitas"]["no_convertidos"] == 8
    assert "sucursal" in res["esquema"]["sobran"] and res["avisos"]
    # La salida lleva las columnas como llegaron (visitas sigue siendo texto)
    assert res["muestra"][0][2] is None or isinstance(res["muestra"][0][2], str)
    # Misma población: deriva estable
    assert res["deriva"]["nivel"] in ("estable", "moderada"), res["deriva"]
    # Corridos: la antigüedad cambió mucho
    codigo = lote.generar(x, dv, {"origen": "hdfs", "ruta": str(datos / "corridos"), "formato": "parquet"},
                          {**salida, "ruta": str(tmp_path / "pred2")}, nombre="churn")
    out, res = correr_lote(codigo, tmp_path)
    assert out.returncode == 0, out.stderr[-3000:]
    por = {c["columna"]: c for c in res["deriva"]["columnas"]}
    assert res["deriva"]["nivel"] == "fuerte" and por["antiguedad"]["nivel"] == "fuerte"
    assert por["ticket"]["nivel"] == "estable"
    # Falta una columna: para antes de predecir, con el nombre
    codigo = lote.generar(x, dv, {"origen": "hdfs", "ruta": str(datos / "incompletos"), "formato": "parquet"},
                          {**salida, "ruta": str(tmp_path / "pred3")}, nombre="churn")
    out, res = correr_lote(codigo, tmp_path)
    assert out.returncode != 0 and res is None
    error = next(l for l in out.stdout.splitlines() if l.startswith("@@error@@ "))
    assert "Faltan columnas que el modelo usa: ticket" in error


def test_lote_con_un_modelo_de_sklearn_repartido(datos, tmp_path):
    """El Pipeline de joblib viaja a los executors (addFile) y predice con mapInPandas; la salida va en CSV."""
    r = rec.validar({"datos": {"origen": "local", "ruta": str(datos / "entrenamiento.csv")}, "tarea": "clasificacion",
                     "objetivo": "clase", "columnas": COLUMNAS, "modelo": {"id": "bosque_clf", "params": {"n_estimators": 30}},
                     "validacion": {"k": 3}})
    (tmp_path / "entrenar.py").write_text(gen.generar(r, "exp", "hoy"))
    dest = tmp_path / "exps" / "exp"
    dest.mkdir(parents=True)
    env = {**os.environ, "SANDBOX_ML_EXPERIMENTOS": str(tmp_path / "exps"), "SANDBOX_ML_EXP": str(dest)}
    out = subprocess.run([sys.executable, "entrenar.py"], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=600)
    assert out.returncode == 0, out.stdout[-3000:] + out.stderr[-3000:]
    assert (dest / "referencia.json").is_file() and (dest / "modelo.joblib").is_file()
    x, dv = guardar("churn-sk", dest, tmp_path)
    salida = {"tipo": "hdfs", "ruta": str(tmp_path / "pred_sk"), "formato": "csv", "modo": "overwrite"}
    codigo = lote.generar(x, dv, {"origen": "hdfs", "ruta": str(datos / "nuevos"), "formato": "parquet"}, salida,
                          nombre="churn-sk")
    out, res = correr_lote(codigo, tmp_path)
    assert out.returncode == 0 and res, out.stdout[-3000:] + out.stderr[-3000:]
    assert res["filas"] == 800 and res["motor"] == "sklearn"
    assert "prediccion" in res["columnas"] and "prob_vuelve" in res["columnas"]
    assert set(res["conteo"]) <= {"vuelve", "no_vuelve"}
    assert res["deriva"]["nivel"] in ("estable", "moderada")
    assert list((tmp_path / "pred_sk").glob("part-*.csv"))
