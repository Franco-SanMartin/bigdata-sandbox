"""Cada modelo de Spark MLlib del catálogo, de punta a punta: el script que genera el estudio corre con Spark de verdad y
deja el experimento con lo que muestra la pantalla de resultados (métricas de entrenamiento, validación y prueba,
curvas y umbrales contados en los executors, residuos, recomendaciones...).

Necesitan pyspark (y Java): corren adentro de la imagen (franki678/bigdata-sandbox:full) y se saltean solos en el CI
del servidor, que no tiene Spark.

    docker exec <contenedor> bash -c "cd /repo/server && python3 -m pytest -q tests/test_estudio_modelos_spark.py"
"""
import json
import math
import os
import random
import subprocess
import sys
from pathlib import Path

import pytest

pytest.importorskip("pyspark")

from sandbox_ml import catalogo as cat  # noqa: E402
from sandbox_ml import codigo as gen  # noqa: E402
from sandbox_ml import receta as rec  # noqa: E402

CONF = ["--conf", "spark.hadoop.fs.defaultFS=file:///", "--conf", "spark.ui.enabled=false",
        "--conf", "spark.sql.shuffle.partitions=4"]


@pytest.fixture(scope="module")
def spark():
    from pyspark.sql import SparkSession
    s = (SparkSession.builder.master("local[2]").appName("tests de modelos del estudio")
         .config("spark.hadoop.fs.defaultFS", "file:///").config("spark.ui.enabled", "false")
         .config("spark.sql.shuffle.partitions", "4").getOrCreate())
    s.sparkContext.setLogLevel("ERROR")
    yield s
    s.stop()


# ------------------------------------------------------------------ datos con señal (siempre los mismos)

def clientes(n=1500, clases=2, semilla=7):
    """Antigüedad, visitas, ticket y un plan: la clase sale de una combinación de ellas (con ruido)."""
    rnd = random.Random(semilla)
    filas = []
    for i in range(n):
        ant, vis, tic = rnd.uniform(1, 60), rnd.uniform(0, 20), rnd.uniform(500, 5000)
        plan = rnd.choice(["basico", "plus", "premium"])
        s = 0.05 * ant + 0.3 * vis - 0.0004 * tic + {"basico": -1, "plus": 0, "premium": 1}[plan] + rnd.gauss(0, 1)
        if clases == 2:
            y = "vuelve" if s > 2.2 else "no_vuelve"
        else:
            y = "baja" if s < 1.5 else "media" if s < 3.5 else "alta"
        filas.append((i, ant, vis, tic, plan, y))
    return filas, "id int, antiguedad double, visitas double, ticket double, plan string, clase string"


def montos(n=1500, semilla=11):
    rnd = random.Random(semilla)
    filas = []
    for i in range(n):
        a, b = rnd.uniform(0, 10), rnd.uniform(0, 5)
        zona = rnd.choice(["norte", "sur", "centro"])
        y = 20 + 3 * a - 2 * b + {"norte": 5, "sur": 0, "centro": 2}[zona] + rnd.gauss(0, 1.5)
        filas.append((i, a, b, zona, max(0.5, y)))
    return filas, "id int, a double, b double, zona string, monto double"


def grupos(n=900, semilla=3):
    rnd = random.Random(semilla)
    centros = [(0, 0), (8, 8), (0, 9)]
    filas = [(i, rnd.gauss(centros[i % 3][0], 1), rnd.gauss(centros[i % 3][1], 1)) for i in range(n)]
    return filas, "id int, x double, y double"


def calificaciones(usuarios=60, items=40, semilla=5):
    """Cada usuario y cada ítem con 2 factores: la nota es su producto (de 1 a 5), y falta la mitad."""
    rnd = random.Random(semilla)
    fu = [(rnd.uniform(0, 1), rnd.uniform(0, 1)) for _ in range(usuarios)]
    fi = [(rnd.uniform(0, 1), rnd.uniform(0, 1)) for _ in range(items)]
    filas = []
    for u in range(usuarios):
        for i in range(items):
            if rnd.random() < 0.5:
                nota = 1 + 4 * (fu[u][0] * fi[i][0] + fu[u][1] * fi[i][1]) / 2 + rnd.gauss(0, 0.2)
                filas.append((u, i, min(5.0, max(1.0, nota))))
    return filas, "usuario int, pelicula int, nota double"


DATOS = {
    "binaria": (lambda: clientes(clases=2), "clasificacion", "clase",
                {"id": "id", "antiguedad": "numerica", "visitas": "numerica", "ticket": "numerica", "plan": "categorica"}),
    "multiclase": (lambda: clientes(clases=3), "clasificacion", "clase",
                   {"id": "id", "antiguedad": "numerica", "visitas": "numerica", "ticket": "numerica",
                    "plan": "categorica"}),
    "regresion": (montos, "regresion", "monto", {"id": "id", "a": "numerica", "b": "numerica", "zona": "categorica"}),
    "clustering": (grupos, "clustering", None, {"id": "id", "x": "numerica", "y": "numerica"}),
    "reduccion": (grupos, "reduccion", None, {"id": "id", "x": "numerica", "y": "numerica"}),
    "recomendacion": (calificaciones, "recomendacion", "nota", {"usuario": "usuario", "pelicula": "item"}),
}

# Cada modelo con los datos que le corresponden y parámetros chicos (que corra rápido)
MODELOS = {
    "lineal_spark": ("regresion", {}),
    "glm_spark": ("regresion", {"family": "gaussian"}),
    "arbol_reg_spark": ("regresion", {"maxDepth": 4}),
    "bosque_reg_spark": ("regresion", {"numTrees": 10, "maxDepth": 4}),
    "gbt_reg_spark": ("regresion", {"maxIter": 10, "maxDepth": 3}),
    "xgb_reg_spark": ("regresion", {"n_estimators": 30, "max_depth": 3}),
    "logistica_spark": ("binaria", {}),
    "arbol_clf_spark": ("binaria", {"maxDepth": 4}),
    "bosque_clf_spark": ("multiclase", {"numTrees": 10, "maxDepth": 4}),
    "gbt_clf_spark": ("binaria", {"maxIter": 10, "maxDepth": 3}),
    "xgb_clf_spark": ("binaria", {"n_estimators": 30, "max_depth": 3}),
    "naive_bayes_spark": ("binaria", {}),
    "svc_lineal_spark": ("binaria", {"maxIter": 20}),
    "mlp_spark": ("multiclase", {"maxIter": 50}),
    "kmeans_spark": ("clustering", {"k": 3}),
    "bisecting_spark": ("clustering", {"k": 3}),
    "gmm_spark": ("clustering", {"k": 3}),
    "pca_spark": ("reduccion", {"k": 2}),
    "als_spark": ("recomendacion", {"rank": 4, "maxIter": 8}),
}


def test_estan_todos_los_modelos_de_spark():
    """Si se suma un modelo al catálogo, tiene que sumarse acá (y correr de punta a punta)."""
    assert {m["id"] for m in cat.MODELOS.values() if m["motor"] == "spark"} == set(MODELOS)


def receta(mid, ruta, tipo, params, **kw):
    _, tarea, objetivo, columnas = DATOS[tipo]
    r = {"datos": {"origen": "hdfs", "ruta": ruta, "formato": "parquet"}, "tarea": tarea, "columnas": columnas,
         "modelo": {"id": mid, "params": params}}
    if objetivo:
        r["objetivo"] = objetivo
    r.update(kw)
    return rec.validar(r)


def correr(r, tmp_path, exp="exp"):
    """Corre el script como lo corre el servidor (python3 + PYSPARK_SUBMIT_ARGS) y devuelve experimento e informe."""
    (tmp_path / "entrenar.py").write_text(gen.generar(r, exp, "hoy"))
    dest = tmp_path / "exps" / exp
    dest.mkdir(parents=True)
    env = {**os.environ, "SANDBOX_ML_EXPERIMENTOS": str(tmp_path / "exps"), "SANDBOX_ML_EXP": str(dest),
           "PYSPARK_SUBMIT_ARGS": " ".join(["--master", "local[2]", *CONF, "pyspark-shell"])}
    out = subprocess.run([sys.executable, "entrenar.py"], cwd=tmp_path, env=env, capture_output=True, text=True,
                         timeout=900)
    assert out.returncode == 0, out.stdout[-4000:] + out.stderr[-4000:]
    exp_json = json.loads((dest / "experimento.json").read_text())
    informe = json.loads((dest / "informe.json").read_text()) if (dest / "informe.json").exists() else {}
    return exp_json, informe, out.stdout


@pytest.fixture(scope="module")
def rutas(spark, tmp_path_factory):
    base = tmp_path_factory.mktemp("datos")
    out = {}
    for tipo, (fabrica, *_resto) in DATOS.items():
        filas, esquema = fabrica()
        out[tipo] = str(base / tipo)
        spark.createDataFrame(filas, esquema).write.parquet(out[tipo])
    return out


def finito(x):
    return isinstance(x, (int, float)) and math.isfinite(x)


@pytest.mark.parametrize("mid", sorted(MODELOS))
def test_cada_modelo_de_punta_a_punta(mid, rutas, tmp_path):
    tipo, params = MODELOS[mid]
    m = cat.MODELOS[mid]
    if cat.requisito_faltante(m):
        pytest.skip(cat.requisito_faltante(m))
    r = receta(mid, rutas[tipo], tipo, params)
    exp, inf, salida = correr(r, tmp_path)
    met = exp["metricas"]
    principal = exp["metrica"]
    assert principal in met, (principal, met)
    if tipo in ("regresion", "binaria", "multiclase", "recomendacion"):
        # Entrenamiento, validación y prueba separados: la métrica principal en las tres
        assert {"prueba", "validacion"} <= set(met[principal]), met[principal]
        assert finito(met[principal]["prueba"]) and finito(met[principal]["validacion"])
        assert exp["evaluacion"] and "prueba" in exp["evaluacion"]
    if tipo == "regresion":
        assert met["r2"]["prueba"] > 0.5, met["r2"]
        assert inf["calculado"] == "cluster"
        assert len(inf["error_por_rango"]) >= 5 and sum(x["filas"] for x in inf["error_por_rango"]) > 100
        assert sum(inf["histograma_residuos"]["cuentas"]) > 100 and inf["residuo"]
    if tipo == "binaria":
        assert inf["calculado"] == "cluster" and len(inf["confusion"]) == 2
        assert inf["roc"] and 0.5 < inf["roc"][0]["auc"] <= 1.0, inf["roc"][0].get("auc")
        assert inf["pr"] and inf["positiva"] == inf["clases"][1]
        if m.get("proba"):
            assert len(inf["umbrales"]) == 51 and inf["calibracion"]["predicha"]
        if m.get("proba") and m.get("extra") != "xgboost":
            # El umbral se elige en la validación (F1 por defecto en Spark) y queda guardado en el modelo
            u = exp["umbral"]
            assert u["criterio"] == "f1" and 0 < u["valor"] < 1 and 0 < u["nota"] <= 1, u
        else:
            assert not exp.get("umbral")
    if tipo == "multiclase":
        assert len(inf["confusion"]) == 3 and len(inf["reporte"]) == 3
        assert met["f1_ponderado"]["prueba"] > 0.4
    if tipo == "clustering":
        assert finito(met["silhouette"]["prueba"]) and met["silhouette"]["prueba"] > 0.4
    if tipo == "reduccion":
        assert 0.5 < met["varianza_acumulada"]["prueba"] <= 1.0001
    if tipo == "recomendacion":
        assert met["rmse"]["prueba"] < 1.0, met["rmse"]
        recs = inf["recomendaciones"]
        assert recs and len(recs[0]["items"]) > 0, recs[:1]
    if mid not in ("pca_spark",):
        assert exp["modelo"]["id"] == mid and exp["motor"] == "spark"


def test_busqueda_con_validacion_cruzada_y_recursos(rutas, tmp_path):
    """CrossValidator sobre el entrenamiento, el mejor elegido con la validación y los recursos de YARN en la receta."""
    r = receta("logistica_spark", rutas["binaria"], "binaria", {},
               busqueda={"tipo": "cv", "espacio": {"regParam": [0.0, 0.1], "elasticNetParam": [0.0, 0.5]}},
               validacion={"umbral": "youden"}, recursos={"executors": 1, "memoria_executor_mb": 768})
    assert r["recursos"]["executors"] == 1
    assert "--num-executors 1" in " ".join(rec.argumentos_spark(r["recursos"]))
    exp, inf, _ = correr(r, tmp_path)
    assert exp["busqueda"] and len(exp["busqueda"]["resultados"]) == 4, exp.get("busqueda")
    assert exp["umbral"]["criterio"] == "youden" and 0 < exp["umbral"]["valor"] < 1
    assert exp["recursos"]["executors"] == 1


def test_umbral_fijo_si_no_hay_validacion(rutas, tmp_path):
    r = receta("logistica_spark", rutas["binaria"], "binaria", {}, validacion={"validacion": 0.0, "umbral": "fijo"})
    exp, _, _ = correr(r, tmp_path)
    assert not exp.get("umbral")
    assert "validacion" not in exp["metricas"][exp["metrica"]]
