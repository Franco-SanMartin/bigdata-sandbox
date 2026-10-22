"""Entrena UN modelo con Spark MLlib sobre clientes_senal.csv en HDFS (lo corre POST /api/ml/train).

Es lo mismo que hace ejemplos/ml/modelos_spark.py, pero solo con el modelo que
pediste y con el porcentaje para entrenar que elegiste. Se lanza con
spark-submit, así que corre en YARN (executors en los NodeManagers):

    spark-submit entrenar_spark.py hdfs:///user/root/ml/clientes_senal.csv clasificacion arbol 80 '{}'

Imprime las mismas líneas que entrenar_sklearn.py: '== <mensaje>|<progreso>' y
al final '@@resultado@@ {json}'. La memoria no la mide el script (la usan los
executors, procesos Java): el servidor la saca de YARN.

Los hiperparámetros tienen los nombres de scikit-learn (los mismos que manda la
pantalla): max_depth (árbol, 3), hidden_layer_sizes ("16,8") y max_iter (500)
en la red neuronal, n_clusters (3) en KMeans. C de la logística se pasa como
regParam = 1/C (con C = 1, sin regularización, como modelos_spark.py). El último argumento (opcional) son las columnas de entrada
separadas por coma.
"""
import json
import sys
import time

ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
REGLA_GASTO = {"antiguedad_meses": "50", "visitas_mes": "1.500", "ticket_promedio": "0,8",
               "reclamos": "−1.500", "edad": "0 (no influye)"}
SEMILLA = 42


def paso(mensaje, progreso):
    print(f"== {mensaje}|{progreso}", flush=True)


def num(x, dec=0):
    s = f"{abs(x):,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("−" if x < 0 and float(f"{abs(x):.{dec}f}") != 0 else "") + s


def main(argv):
    entrada, tarea, modelo_id = argv[1], argv[2], argv[3]
    pct = int(argv[4]) if len(argv) > 4 else 80
    params = json.loads(argv[5]) if len(argv) > 5 and argv[5] else {}
    entradas = [c for c in argv[6].split(",") if c] if len(argv) > 6 and argv[6] else ENTRADAS

    from pyspark.ml import Pipeline
    from pyspark.ml.classification import DecisionTreeClassifier, LogisticRegression, MultilayerPerceptronClassifier
    from pyspark.ml.clustering import KMeans
    from pyspark.ml.evaluation import MulticlassClassificationEvaluator, RegressionEvaluator
    from pyspark.ml.feature import StandardScaler, VectorAssembler
    from pyspark.ml.regression import LinearRegression
    from pyspark.sql import SparkSession, functions as F

    paso("Arrancando la sesión de Spark en YARN", 0.05)
    spark = SparkSession.builder.appName(f"entrenar_spark.py: {tarea} {modelo_id}").getOrCreate()
    paso("Leyendo clientes_senal.csv de HDFS", 0.2)
    clientes = spark.read.csv(entrada, header=True, inferSchema=True)
    datos = VectorAssembler(inputCols=entradas, outputCol="features").transform(clientes)
    nota = "Algunas filas de prueba (no las vio al entrenar): lo real y lo que predijo"
    res = {"metrics": {}, "learned": []}

    if tarea == "clustering":
        if modelo_id != "kmeans":
            raise SystemExit(f"{modelo_id} no sirve para agrupamiento")
        k = int(params.get("n_clusters", 3))
        para_grupos = clientes.withColumn("log_ticket", F.log("ticket_promedio"))
        columnas = ["log_ticket" if c == "ticket_promedio" else c for c in entradas]
        agrupar = Pipeline(stages=[
            VectorAssembler(inputCols=columnas, outputCol="crudas"),
            StandardScaler(inputCol="crudas", outputCol="escaladas", withMean=True),
            KMeans(featuresCol="escaladas", k=k, seed=SEMILLA),
        ])
        paso("Entrenando en los executors (KMeans)", 0.5)
        t0 = time.perf_counter()
        modelo = agrupar.fit(para_grupos)
        seg = time.perf_counter() - t0
        paso("Comparando con los segmentos reales", 0.8)
        tabla = modelo.transform(para_grupos).select("prediction", "segmento_real", *entradas).toPandas()
        from sklearn.metrics import adjusted_rand_score
        res["metrics"] = {"rand_ajustado": round(adjusted_rand_score(tabla["segmento_real"], tabla["prediction"]), 4)}
        filas = []
        for g, sub in tabla.groupby("prediction"):
            cuenta = sub["segmento_real"].value_counts()
            filas.append([f"grupo {g}", f"{num(int(cuenta.iloc[0]))} {cuenta.index[0]}",
                          " · ".join(f"{num(int(v))} {s}" for s, v in cuenta.iloc[1:].items()) or "—"])
        res["learned"].append({"title": "Grupos encontrados contra los segmentos reales", "rows": filas})
        total = len(tabla)
        res["trainRows"], res["testRows"] = total, 0
        res["predictions"] = {"columns": entradas + ["segmento_real", "grupo"],
                              "rows": [[int(r[c]) for c in entradas] + [str(r["segmento_real"]), int(r["prediction"])]
                                       for _, r in tabla.head(8).iterrows()],
                              "total": total,
                              "note": "Primeras filas del archivo con el grupo que les tocó (KMeans no ve segmento_real)"}
    else:
        ent, prueba = datos.randomSplit([pct / 100, 1 - pct / 100], seed=SEMILLA)
        ent.cache()
        prueba.cache()
        n_ent, n_prueba = ent.count(), prueba.count()
        res["trainRows"], res["testRows"] = n_ent, n_prueba
        paso(f"randomSplit: {num(n_ent)} / {num(n_prueba)}", 0.35)
        if tarea == "regresion":
            if modelo_id != "lineal":
                raise SystemExit(f"{modelo_id} no sirve para regresión")
            paso("Entrenando en los executors (Regresión lineal)", 0.5)
            t0 = time.perf_counter()
            m = LinearRegression(labelCol="gasto_mes_siguiente").fit(ent)
            seg = time.perf_counter() - t0
            paso(f"Probando con {num(n_prueba)} filas que no vio", 0.8)
            pred = m.transform(prueba)
            ev = RegressionEvaluator(labelCol="gasto_mes_siguiente")
            res["metrics"] = {"r2": round(ev.evaluate(pred, {ev.metricName: "r2"}), 4),
                              "error_medio": round(ev.evaluate(pred, {ev.metricName: "mae"}))}
            res["learned"].append({"title": "Coeficientes aprendidos contra la regla real",
                                   "rows": [["(constante)", num(m.intercept, 1), "5.000"]] +
                                           [[c, num(v, 2), REGLA_GASTO[c]] for c, v in zip(entradas, m.coefficients.toArray())]})
            filas = pred.select(*entradas, "gasto_mes_siguiente", "prediction").limit(8).collect()
            res["predictions"] = {"columns": entradas + ["real", "predicho", "diferencia"],
                                  "rows": [[int(r[c]) for c in entradas] +
                                           [int(r["gasto_mes_siguiente"]), round(r["prediction"]),
                                            round(r["prediction"]) - int(r["gasto_mes_siguiente"])]
                                           for r in filas],
                                  "total": n_prueba, "note": nota}
        elif tarea == "clasificacion":
            escalar = StandardScaler(inputCol="features", outputCol="escaladas", withMean=True)
            if modelo_id == "arbol":
                est = DecisionTreeClassifier(labelCol="vuelve", maxDepth=int(params.get("max_depth", 3)), seed=SEMILLA)
            elif modelo_id == "logistica":
                # C = 1 es el valor de siempre: sin regularización, como modelos_spark.py
                c = float(params.get("C", 1))
                est = Pipeline(stages=[escalar, LogisticRegression(featuresCol="escaladas", labelCol="vuelve",
                                                                   regParam=0.0 if c == 1 else 1 / c)])
            elif modelo_id == "mlp":
                capas = [int(x) for x in str(params.get("hidden_layer_sizes", "16,8")).split(",") if x.strip()]
                est = Pipeline(stages=[escalar, MultilayerPerceptronClassifier(
                    featuresCol="escaladas", labelCol="vuelve", layers=[len(entradas), *capas, 2],
                    maxIter=int(params.get("max_iter", 500)), seed=SEMILLA)])
            else:
                raise SystemExit(f"{modelo_id} no sirve para clasificación en Spark MLlib")
            paso("Entrenando en los executors", 0.5)
            t0 = time.perf_counter()
            m = est.fit(ent)
            seg = time.perf_counter() - t0
            paso(f"Probando con {num(n_prueba)} filas que no vio", 0.8)
            pred = m.transform(prueba)
            ev = MulticlassClassificationEvaluator(labelCol="vuelve", metricName="accuracy")
            res["metrics"] = {"aciertos": round(ev.evaluate(pred), 4)}
            mat = [[0, 0], [0, 0]]
            for r in pred.groupBy("vuelve", "prediction").count().collect():
                mat[int(r["vuelve"])][int(r["prediction"])] = int(r["count"])
            res["confusion"] = {"labels": ["no vuelve", "vuelve"], "matrix": mat}
            if modelo_id == "arbol":
                imp = sorted(zip(entradas, m.featureImportances.toArray()), key=lambda x: -x[1])
                res["learned"].append({"title": "Importancia de cada columna", "rows": [[c, num(v, 3)] for c, v in imp]})
            filas = pred.select(*entradas, "vuelve", "prediction").limit(8).collect()
            res["predictions"] = {"columns": entradas + ["real", "predicho"],
                                  "rows": [[int(r[c]) for c in entradas] + [int(r["vuelve"]), int(r["prediction"])]
                                           for r in filas],
                                  "total": n_prueba, "note": nota + " (1 = vuelve, 0 = no vuelve)"}
        else:
            raise SystemExit(f"No existe el problema {tarea}")

    res["seconds"] = round(seg, 3)
    paso("Listo", 1)
    print("@@resultado@@ " + json.dumps(res, ensure_ascii=False), flush=True)
    spark.stop()


if __name__ == "__main__":
    main(sys.argv)
