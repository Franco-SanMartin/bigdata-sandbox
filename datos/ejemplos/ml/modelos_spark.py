"""Machine learning con Spark MLlib: los mismos modelos de modelos_sklearn.py, en el cluster.

Sobre clientes_senal.csv (generar_senal.py), donde las reglas son conocidas:
regresion lineal, arbol de decision, regresion logistica, red neuronal
(MultilayerPerceptron), validacion cruzada y KMeans, cada uno al lado de la
regla real, con lo que tarda en entrenar.

Uso (adentro del contenedor, parado en /datos):

    python3 ejemplos/ml/generar_senal.py      # una vez: crea clientes_senal.csv
    hdfs dfs -mkdir -p /user/root/ml
    hdfs dfs -put -f clientes_senal.csv /user/root/ml/
    spark-submit ejemplos/ml/modelos_spark.py      # -> metricas_spark.json

Lo que cambia respecto de scikit-learn:
  - MLlib quiere todas las columnas de entrada juntas en UNA columna de tipo
    vector ("features"): eso hace VectorAssembler.
  - Un modelo sin entrenar es un "Estimator": .fit(datos) lo entrena y
    devuelve un "Model", que con .transform(datos) agrega la columna
    "prediction". Todo, hasta el resultado, es un DataFrame.
  - El entrenamiento se reparte entre los executors. Con 20.000 filas
    scikit-learn es mucho mas rapido (no reparte nada): MLlib existe para
    cuando los datos no entran en una sola compu.
  - La memoria la usan los executors (procesos Java, 512 MB cada uno): se ve
    en http://localhost:4040 -> Executors, mientras corre.
"""
import json
import sys
import time

from pyspark.ml import Pipeline
from pyspark.ml.classification import (DecisionTreeClassifier, LogisticRegression,
                                       MultilayerPerceptronClassifier)
from pyspark.ml.clustering import KMeans
from pyspark.ml.evaluation import MulticlassClassificationEvaluator, RegressionEvaluator
from pyspark.ml.feature import StandardScaler, VectorAssembler
from pyspark.ml.regression import LinearRegression
from pyspark.ml.tuning import CrossValidator, ParamGridBuilder
from pyspark.sql import SparkSession, functions as F

entrada = sys.argv[1] if len(sys.argv) > 1 else "hdfs:///user/root/ml/clientes_senal.csv"
spark = SparkSession.builder.appName("modelos MLlib").getOrCreate()

# Las columnas que el modelo puede mirar (las mismas que en scikit-learn)
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
clientes = spark.read.csv(entrada, header=True, inferSchema=True)
datos = VectorAssembler(inputCols=ENTRADAS, outputCol="features").transform(clientes)
# cache(): se usan muchas veces; que queden en la memoria de los executors
ent, prueba = datos.randomSplit([0.8, 0.2], seed=42)
ent.cache()
prueba.cache()
print(f"{ent.count()} clientes para entrenar, {prueba.count()} para probar")
metricas = {"filas": clientes.count()}


def titulo(texto):
    print(f"\n{'=' * 78}\n{texto}\n{'=' * 78}")


def entrenar(estimador, df):
    """Entrena y devuelve el modelo y cuanto tardo (segundos)."""
    inicio = time.perf_counter()
    modelo = estimador.fit(df)
    return modelo, time.perf_counter() - inicio


# ---------------------------------------------------------------------------
# 1. REGRESION LINEAL
# ---------------------------------------------------------------------------
titulo("1. REGRESION LINEAL: cuanto va a gastar el mes que viene")
REGLA_GASTO = {"antiguedad_meses": 50, "visitas_mes": 1500, "ticket_promedio": 0.8,
               "reclamos": -1500, "edad": 0}
regresion, segundos = entrenar(LinearRegression(labelCol="gasto_mes_siguiente"), ent)
print(f"{'':20}{'aprendido':>12}{'regla real':>12}")
print(f"{'(constante)':20}{regresion.intercept:>12.1f}{5000:>12}")
for nombre, coef in zip(ENTRADAS, regresion.coefficients):
    print(f"{nombre:20}{coef:>12.2f}{REGLA_GASTO[nombre]:>12}")
predicciones = regresion.transform(prueba)
evaluar = RegressionEvaluator(labelCol="gasto_mes_siguiente")
r2 = evaluar.evaluate(predicciones, {evaluar.metricName: "r2"})
mae = evaluar.evaluate(predicciones, {evaluar.metricName: "mae"})
print(f"\nR² en prueba: {r2:.3f} | error medio: {mae:,.0f} pesos | entrenar: {segundos:.1f} s")
metricas["regresion"] = {"constante": regresion.intercept,
                         "coeficientes": dict(zip(ENTRADAS, regresion.coefficients.toArray().tolist())),
                         "r2": r2, "error_medio": mae, "segundos": segundos}

# ---------------------------------------------------------------------------
# 2. CLASIFICACION
# ---------------------------------------------------------------------------
titulo("2. CLASIFICACION: vuelve a comprar el mes que viene?")
aciertos = MulticlassClassificationEvaluator(labelCol="vuelve", metricName="accuracy")
# withMean: centrar en 0 (como StandardScaler de scikit-learn)
escalar = StandardScaler(inputCol="features", outputCol="escaladas", withMean=True)
modelos = {
    "arbol de decision": DecisionTreeClassifier(labelCol="vuelve", maxDepth=3, seed=42),
    "regresion logistica": Pipeline(stages=[
        escalar, LogisticRegression(featuresCol="escaladas", labelCol="vuelve")]),
    # layers: 5 entradas, 2 capas ocultas de 16 y 8, 2 salidas (vuelve o no)
    "red neuronal (MLP)": Pipeline(stages=[
        escalar, MultilayerPerceptronClassifier(featuresCol="escaladas", labelCol="vuelve",
                                                layers=[len(ENTRADAS), 16, 8, 2], maxIter=200, seed=42)]),
}
metricas["clasificacion"] = {}
entrenados = {}
print(f"{'modelo':30}{'aciertos':>10}{'entrenar':>12}")
for nombre, estimador in modelos.items():
    modelo, segundos = entrenar(estimador, ent)
    entrenados[nombre] = modelo
    a = aciertos.evaluate(modelo.transform(prueba))
    print(f"{nombre:30}{a:>10.1%}{segundos:>10.1f} s")
    metricas["clasificacion"][nombre] = {"aciertos": a, "segundos": segundos}
print("Techo: ~90% (el 10% de las respuestas se dio vuelta al azar).")

# El arbol, con los nombres de las columnas en lugar de "feature 0, 1..."
reglas = entrenados["arbol de decision"].toDebugString
for i, nombre in reversed(list(enumerate(ENTRADAS))):
    reglas = reglas.replace(f"feature {i} ", f"{nombre} ")
print("\nLo que aprendio el arbol (Predict: 1.0 = vuelve):")
print(reglas)
print("La regla real:  vuelve si (visitas_mes >= 4 y reclamos <= 1) o antiguedad_meses >= 36")

# Validacion cruzada para elegir la profundidad del arbol: 3 partes x 3
# profundidades = 9 entrenamientos, y se queda con la mejor
titulo("Validacion cruzada: que profundidad de arbol conviene")
arbol = DecisionTreeClassifier(labelCol="vuelve", seed=42)
grilla = ParamGridBuilder().addGrid(arbol.maxDepth, [2, 3, 5]).build()
validacion = CrossValidator(estimator=arbol, estimatorParamMaps=grilla, evaluator=aciertos,
                            numFolds=3, seed=42)
mejor, segundos = entrenar(validacion, datos)
for params, promedio in zip(grilla, mejor.avgMetrics):
    print(f"  profundidad {params[arbol.maxDepth]}: {promedio:.1%} de aciertos promedio")
print(f"Elegida: profundidad {mejor.bestModel.getMaxDepth()} ({segundos:.1f} s para los 9 entrenamientos)")
metricas["validacion_cruzada"] = {"profundidad_elegida": mejor.bestModel.getMaxDepth(),
                                  "aciertos": max(mejor.avgMetrics), "segundos": segundos}

# ---------------------------------------------------------------------------
# 3. CLUSTERING: KMeans sobre visitas y log(ticket), escalados
# ---------------------------------------------------------------------------
titulo("3. CLUSTERING (KMeans): grupos de clientes, sin decirle cuales son")
para_grupos = clientes.withColumn("log_ticket", F.log("ticket_promedio"))
agrupar = Pipeline(stages=[
    VectorAssembler(inputCols=["visitas_mes", "log_ticket"], outputCol="crudas"),
    StandardScaler(inputCol="crudas", outputCol="escaladas", withMean=True),
    KMeans(featuresCol="escaladas", k=3, seed=42),
])
modelo, segundos = entrenar(agrupar, para_grupos)
grupos = modelo.transform(para_grupos)
print("Cada grupo encontrado (filas) contra el segmento real (columnas):")
grupos.crosstab("prediction", "segmento_real").orderBy("prediction_segmento_real").show()
# Resultado chico (2 columnas): se puede pasar a pandas y usar scikit-learn
from sklearn.metrics import adjusted_rand_score  # noqa: E402

tabla = grupos.select("prediction", "segmento_real").toPandas()
ari = adjusted_rand_score(tabla["segmento_real"], tabla["prediction"])
print(f"Parecido con los segmentos reales (Rand ajustado, 1 = iguales): {ari:.2f} | entrenar: {segundos:.1f} s")
metricas["clustering"] = {"rand_ajustado": ari, "segundos": segundos}

with open("metricas_spark.json", "w") as f:
    json.dump(metricas, f, indent=2)
print("\nMetricas: metricas_spark.json")
spark.stop()
