# Evaluación 9. ML distribuido con Spark MLlib

[← 8. pandas contra Spark](08-pandas-vs-spark.md) · [Índice de evaluación](README.md) · Teoría: [9. ML distribuido con MLlib](../teoria/09-ml-distribuido-mllib.md)

## Multiple choice

**1.** ¿Qué hace `VectorAssembler(inputCols=ENTRADAS, outputCol="features")`?

- a) Entrena un modelo con las columnas de `ENTRADAS`.
- b) Junta las columnas de entrada en **una** columna de tipo vector, que es
  lo que esperan los modelos de MLlib.
- c) Escala las columnas.
- d) Separa los datos en entrenamiento y prueba.

<details><summary>Respuesta</summary>

**b)**. Es un Transformer: agrega la columna `features`, sin aprender nada.

- a) No: no entrena; prepara la entrada de los que entrenan.
- c) No: eso es `StandardScaler`.
- d) No: eso es `randomSplit`.

</details>

**2.** En MLlib, ¿cuál es la diferencia entre un **Estimator** y un
**Transformer**?

- a) Ninguna, son sinónimos.
- b) El Estimator aprende con `fit(df)` y devuelve un Model; el Transformer
  agrega columnas con `transform(df)`. Un Model es un Transformer.
- c) El Estimator es para regresión y el Transformer para clasificación.
- d) El Transformer es más rápido porque no usa el cluster.

<details><summary>Respuesta</summary>

**b)**. `DecisionTreeClassifier` es un Estimator; su `fit` devuelve un
`DecisionTreeClassificationModel`, que es un Transformer (agrega
`prediction`).

- a) No: uno aprende y el otro no.
- c) No: hay Estimators de los dos tipos (y de clustering).
- d) No: los dos corren sobre el cluster.

</details>

**3.** A diferencia de scikit-learn, en MLlib `fit` **no modifica** el
estimador. ¿Qué ventaja tiene?

- a) Ninguna, es una incomodidad.
- b) El mismo estimador se puede entrenar varias veces con datos distintos
  sin pisarse, que es lo que hace `CrossValidator` por dentro.
- c) Ocupa menos memoria.
- d) Hace que el modelo sea más preciso.

<details><summary>Respuesta</summary>

**b)**. Cada `fit` devuelve un Model nuevo; el estimador es solo la
"receta".

- a) No: tiene una ventaja concreta.
- c) No: no es por memoria.
- d) No: no cambia la precisión.

</details>

**4.** ¿Cómo entrena MLlib una regresión logística sobre datos repartidos?

- a) Junta todos los datos en el driver y entrena ahí.
- b) Cada executor calcula el gradiente con sus particiones; el driver los
  suma, actualiza los pesos y los manda de vuelta; se repite.
- c) Cada executor entrena su propio modelo y se queda con el mejor.
- d) Entrena sobre una muestra al azar que entre en una compu.

<details><summary>Respuesta</summary>

**b)**. Los datos no se mueven: viajan los gradientes y los pesos, que son
chicos.

- a) No: eso es lo que MLlib evita; no escalaría.
- c) No: el modelo es uno solo, entrenado con todas las filas.
- d) No: usa todas las filas.

</details>

**5.** ¿Para qué sirve un `Pipeline` de MLlib?

- a) Para correr varios scripts en orden.
- b) Para encadenar etapas (Transformers y Estimators) y tratarlas como un
  solo Estimator: `fit` entrena cada etapa en orden y devuelve un
  `PipelineModel`.
- c) Para mandar datos de Spark a pandas.
- d) Para repartir los datos entre executors.

<details><summary>Respuesta</summary>

**b)**. El clustering de `modelos_spark.py` es un Pipeline de
`VectorAssembler` → `StandardScaler` → `KMeans`. El escalador aprende solo
con lo que recibe el `fit`, y el modelo entero se puede guardar y aplicar.

- a) No: no orquesta scripts.
- c) No: eso es `toPandas`.
- d) No: eso lo hace Spark siempre, sin Pipeline.

</details>

**6.** `modelos_spark.py` hace `ent.cache()` y `prueba.cache()`. ¿Por qué?

- a) Porque sin `cache()` los modelos no se pueden entrenar.
- b) Porque se usan en varios entrenamientos y evaluaciones; sin `cache()`,
  Spark (perezoso) los volvería a leer de HDFS y armar cada vez.
- c) Para guardarlos en HDFS.
- d) Para que no se pierdan si se apaga el contenedor.

<details><summary>Respuesta</summary>

**b)**. `cache()` guarda las particiones en la memoria de los executors la
primera vez que se calculan.

- a) No: se entrenan igual, pero más lento.
- c) No: `cache()` es en memoria; guardar en HDFS es `write`.
- d) No: la memoria se pierde al apagar.

</details>

**7.** Con los 20.000 clientes, scikit-learn entrena en milisegundos lo que a
MLlib le lleva segundos. ¿Qué conclusión es correcta?

- a) MLlib es peor y no conviene nunca.
- b) Con datos que entran en una compu conviene scikit-learn; MLlib vale la
  pena cuando los datos no entran o ya están repartidos en el cluster.
- c) Hay que sumar executors hasta que MLlib sea más rápido.
- d) scikit-learn hace trampa usando menos datos.

<details><summary>Respuesta</summary>

**b)**. Cada iteración de MLlib es al menos un job con costo fijo; con pocos
datos ese costo domina.

- a) No: con datos grandes es la opción.
- c) No: más executors suman más coordinación; con pocos datos no ayuda.
- d) No: usa los mismos datos.

</details>

**8.** Un árbol de MLlib y uno de scikit-learn, con la misma profundidad y los
mismos datos, pueden dar cortes un poco distintos. ¿Por qué?

- a) Porque MLlib no prueba todos los cortes posibles: agrupa cada columna en
  un máximo de valores (`maxBins`, 32 por defecto) para que los conteos que
  viajan por la red sean chicos.
- b) Porque MLlib usa otra definición de árbol.
- c) Porque scikit-learn redondea.
- d) No pueden: dan siempre lo mismo.

<details><summary>Respuesta</summary>

**a)**. Es un compromiso para repartir el trabajo. Además, `randomSplit` no
separa los mismos clientes que `train_test_split`.

- b) No: es el mismo algoritmo, con esa aproximación.
- c) No: no redondea.
- d) No: por lo de arriba, pueden variar un poco.

</details>

## Preguntas de desarrollo

**1.** Explicá cómo se reparte el entrenamiento de KMeans en MLlib: qué hace
cada executor, qué hace el driver y qué viaja por la red.

<details><summary>Respuesta modelo</summary>

El driver tiene los k centros y los manda a los executors. Cada executor,
con sus particiones: asigna cada fila al centro más cercano y calcula, por
centro, la suma de sus filas y cuántas son. Eso viaja al driver: k sumas y k
conteos por executor, no las filas. El driver suma lo de todos, calcula los
promedios (los centros nuevos) y los vuelve a mandar. Se repite hasta que
los centros dejan de moverse. Los datos nunca salen de los executors.

</details>

**2.** Compará cómo se escribe un modelo con escalador y validación cruzada
en scikit-learn y en MLlib.

<details><summary>Respuesta modelo</summary>

| | scikit-learn | MLlib |
|---|---|---|
| Entradas | `X` (columnas de un DataFrame de pandas) | `VectorAssembler` → columna `features` |
| Escalador + modelo | `make_pipeline(StandardScaler(), LogisticRegression())` | `Pipeline(stages=[StandardScaler(...), LogisticRegression(featuresCol=...)])` |
| Grilla | `{"logisticregression__C": [...]}` | `ParamGridBuilder().addGrid(lr.regParam, [...]).build()` |
| Validación | `GridSearchCV(modelo, grilla, cv=5)` | `CrossValidator(estimator, estimatorParamMaps, evaluator, numFolds)` |
| Resultado | `best_params_`, `best_estimator_` | `bestModel`, `avgMetrics` |
| Predecir | `predict(X)` | `transform(df)` → columna `prediction` |

La idea es la misma; cambia que en MLlib todo es un DataFrame repartido y que
las métricas son Evaluators.

</details>

## Ejercicios prácticos

Antes: hecha la [guía 5](../05-modelos-spark-mllib.md) (tiene que estar
`clientes_senal.csv` en HDFS, en `/user/root/ml`). Los ejercicios usan el
cluster: cerrar otros notebooks con Spark antes de empezar, y terminar con
`spark.stop()`.

### Ejercicio 1. Validación cruzada sin tocar la prueba

`modelos_spark.py` corre `CrossValidator` sobre **todos** los clientes. Hacé
la versión de un trabajo real: separá entrenamiento y prueba con
`randomSplit([0.8, 0.2], seed=42)`, corré la validación cruzada (profundidades
2, 3 y 5, 3 partes) **solo sobre el entrenamiento**, y medí el modelo elegido
**una vez** en la prueba.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio, usa el cluster) -->
```python
from pyspark.ml.classification import DecisionTreeClassifier
from pyspark.ml.evaluation import MulticlassClassificationEvaluator
from pyspark.ml.feature import VectorAssembler
from pyspark.ml.tuning import CrossValidator, ParamGridBuilder
from pyspark.sql import SparkSession

spark = SparkSession.builder.appName("ejercicio validacion").getOrCreate()
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
clientes = spark.read.csv("hdfs:///user/root/ml/clientes_senal.csv", header=True, inferSchema=True)
datos = VectorAssembler(inputCols=ENTRADAS, outputCol="features").transform(clientes)
ent, prueba = datos.randomSplit([0.8, 0.2], seed=42)
ent.cache()

aciertos = MulticlassClassificationEvaluator(labelCol="vuelve", metricName="accuracy")
arbol = DecisionTreeClassifier(labelCol="vuelve", seed=42)
grilla = ParamGridBuilder().addGrid(arbol.maxDepth, [2, 3, 5]).build()
validacion = CrossValidator(estimator=arbol, estimatorParamMaps=grilla, evaluator=aciertos,
                            numFolds=3, seed=42)
mejor = validacion.fit(ent)
print(mejor.avgMetrics, mejor.bestModel.getMaxDepth())
print(aciertos.evaluate(mejor.bestModel.transform(prueba)))
spark.stop()
```

Qué tiene que salir (Spark separa al azar fila por fila: los números exactos
pueden variar un poco):

| Qué | Valor esperado |
|---|---|
| Promedio con profundidad 2 | Claramente más bajo que con 3 y 5 (en scikit-learn, ~0,88) |
| Promedio con 3 y con 5 | Muy parecidos, cerca de 0,90 |
| Profundidad elegida | 3 o 5 (las dos llegan al techo) |
| Aciertos en la prueba | Entre 0,87 y 0,93, como el árbol de la guía 5 |

El número que se informa es el de la prueba: no se usó para elegir.

</details>

| Criterio | Puntos |
|---|---:|
| Separa antes y pasa solo `ent` al `fit` del `CrossValidator` | 4 |
| Grilla y evaluador bien armados | 2 |
| Mide `bestModel` una sola vez en `prueba` | 2 |
| Explica por qué así el resultado es honesto | 2 |

### Ejercicio 2. Un Pipeline completo, guardado y vuelto a cargar

Armá un `Pipeline` con `VectorAssembler` → `StandardScaler` →
`LogisticRegression` que prediga `vuelve`, entrenalo con el 80 % de los
clientes, medí los aciertos en el 20 % restante, guardalo en HDFS en
`/user/root/ml/modelo_logistica` y volvé a cargarlo para predecir el cliente
de 40 meses, 1 visita, ticket 5.000, 0 reclamos y 30 años.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio, usa el cluster) -->
```python
from pyspark.ml import Pipeline, PipelineModel
from pyspark.ml.classification import LogisticRegression
from pyspark.ml.evaluation import MulticlassClassificationEvaluator
from pyspark.ml.feature import StandardScaler, VectorAssembler
from pyspark.sql import SparkSession

spark = SparkSession.builder.appName("ejercicio pipeline").getOrCreate()
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
clientes = spark.read.csv("hdfs:///user/root/ml/clientes_senal.csv", header=True, inferSchema=True)
ent, prueba = clientes.randomSplit([0.8, 0.2], seed=42)

pipeline = Pipeline(stages=[
    VectorAssembler(inputCols=ENTRADAS, outputCol="crudas"),
    StandardScaler(inputCol="crudas", outputCol="features", withMean=True),
    LogisticRegression(labelCol="vuelve"),
])
modelo = pipeline.fit(ent)
aciertos = MulticlassClassificationEvaluator(labelCol="vuelve", metricName="accuracy")
print(aciertos.evaluate(modelo.transform(prueba)))

modelo.write().overwrite().save("hdfs:///user/root/ml/modelo_logistica")
cargado = PipelineModel.load("hdfs:///user/root/ml/modelo_logistica")
nuevo = spark.createDataFrame([(40, 1, 5000, 0, 30)], ENTRADAS)
cargado.transform(nuevo).select("probability", "prediction").show(truncate=False)
spark.stop()
```

Qué tiene que salir:

- Aciertos cerca de 0,8, por debajo del árbol: la misma limitación de la
  logística que en scikit-learn (81,7 %), por la frontera recta.
- Para el cliente nuevo, una probabilidad de volver cerca de 0,5 (en
  scikit-learn da 0,56; acá cambia un poco porque `randomSplit` separa otros
  clientes): la logística duda con un cliente que, por la regla, vuelve
  seguro.
- En HDFS queda una carpeta con `metadata` y `stages`, que tiene una
  subcarpeta por etapa: el modelo entero
  (ensamblador, escalador con sus promedios y desvíos, y logística) se aplica
  con un solo `transform`, sin repetir la preparación a mano.

Como el Pipeline arranca en el `VectorAssembler`, `transform` acepta las
columnas sueltas: el cliente nuevo no necesita la columna `features`.

</details>

| Criterio | Puntos |
|---|---:|
| Pipeline de tres etapas con las columnas bien conectadas | 3 |
| Entrena con `ent` y mide con `prueba` | 2 |
| Guarda y carga con `PipelineModel.load` | 2 |
| Predice el cliente nuevo con el modelo cargado y explica por qué la logística duda | 3 |

[← 8. pandas contra Spark](08-pandas-vs-spark.md) · [Índice de evaluación](README.md) · Teoría: [9. ML distribuido con MLlib](../teoria/09-ml-distribuido-mllib.md)
