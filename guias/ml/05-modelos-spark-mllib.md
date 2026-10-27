# 5. Los mismos modelos con Spark MLlib

Entrenar en el cluster, con `pyspark.ml`, los mismos modelos de la guía 4
sobre los mismos clientes: regresión lineal, árbol, logística, red neuronal y
KMeans, más una validación cruzada que elige sola la profundidad del árbol.
Lo importante no es que den lo mismo (dan parecido) sino cómo se arma el
trabajo cuando los datos están repartidos.

[← 4. Modelos con scikit-learn](04-modelos-sklearn.md) · [Índice de ml](README.md) · Siguiente: [6. MongoDB + pandas →](06-mongodb-pandas.md)

## Antes de empezar

- La [guía 4](04-modelos-sklearn.md) hecha: hace falta `clientes_senal.csv`
  en `/datos` y conviene tener a mano los resultados de scikit-learn.
- `SERVICIOS=todo` (el valor por defecto): Spark corre sobre YARN.
- La carpeta `/user/root/ml` en HDFS (se crea en la [guía 3](03-etl-spark.md);
  si no la hiciste, el `mkdir` de abajo la crea).
- Teoría que acompaña: [ML distribuido con MLlib](teoria/09-ml-distribuido-mllib.md).

## Qué vamos a hacer y por qué

scikit-learn necesita todos los datos en la memoria de una compu. Spark MLlib
entrena repartiendo el trabajo entre los executors: cada uno calcula sobre sus
particiones y el driver junta los resultados parciales. Para que eso funcione
la API es distinta, y la distinción vale para cualquier librería de ML
distribuido:

| Idea | scikit-learn | Spark MLlib |
|---|---|---|
| Datos de entrada | Una tabla con una columna por variable (`X`) y la respuesta aparte (`y`) | Un DataFrame con **una** columna de tipo vector (`features`) y la respuesta como otra columna (`labelCol`) |
| Juntar las columnas | No hace falta | `VectorAssembler` |
| Modelo sin entrenar | `DecisionTreeClassifier(...)` | Un **Estimator**: `DecisionTreeClassifier(...)` |
| Entrenar | `modelo.fit(X, y)` modifica el modelo | `estimator.fit(df)` devuelve **otro** objeto, un **Model** |
| Predecir | `modelo.predict(X)` devuelve un array | `model.transform(df)` devuelve el DataFrame con una columna `prediction` más |
| Encadenar pasos | `make_pipeline(...)` | `Pipeline(stages=[...])` |
| Separar | `train_test_split(test_size=0.2)`: exacto | `randomSplit([0.8, 0.2], seed=42)`: **aproximado** (cada fila se sortea sola) |

## Subir los clientes a HDFS

<!-- prueba: adentro | espera: clientes_senal.csv -->
```bash
hdfs dfs -mkdir -p /user/root/ml
hdfs dfs -put -f clientes_senal.csv /user/root/ml/
hdfs dfs -ls /user/root/ml
```

## Correr los modelos en el cluster

<!-- prueba: adentro | espera: Elegida: profundidad | espera: Metricas: metricas_spark.json -->
```bash
spark-submit ejemplos/ml/modelos_spark.py 2> modelos_spark.log | tee modelos_spark.txt
```

Tarda bastante más que scikit-learn (un par de minutos, según la compu):
cada `fit` lanza varios jobs en YARN, y la validación cruzada entrena 9
árboles. Mientras corre, en http://localhost:4040:

- *Jobs*: los jobs de cada entrenamiento, uno detrás del otro.
- *Storage*: los datos de entrenamiento y de prueba que el script guardó en
  memoria con `cache()` (se usan muchas veces: así no se vuelven a leer de
  HDFS para cada modelo).
- *Executors*: los dos executors, con la memoria que usan (512 MB cada uno,
  lo que fija `conf/spark-defaults.conf`).

Deja `metricas_spark.json` en `/datos` (lo escribe el driver, que corre en el
contenedor), no en HDFS.

## Qué sale y cómo se compara con scikit-learn

La salida tiene las mismas partes que la de `modelos_sklearn.py`. Los números
exactos no son los mismos: el sorteo de entrenamiento y prueba es otro y los
algoritmos por dentro también. Lo que tiene que pasar (y la prueba de la
imagen lo comprueba antes de publicar cada versión):

**Separar.** La primera línea dice cuántos clientes quedaron para entrenar y
para probar: alrededor de 16.000 y 4.000, pero no exactos, porque
`randomSplit` sortea cada fila por separado.

**1. Regresión lineal.** La misma tabla de coeficientes aprendidos al lado de
la regla real. Tienen que quedar cerca de 50, 1500, 0,8, −1500 y 0, con la
constante cerca de 5000 y un R² mayor que 0,9 (da parecido al de
scikit-learn, 0,98). El modelo entrenado tiene `intercept` y `coefficients`
(en scikit-learn eran `intercept_` y `coef_`). Las métricas las calcula un
**evaluador**: `RegressionEvaluator` con `r2` y con `mae`.

**2. Clasificación.** Aciertos en prueba y segundos de entrenamiento de tres
modelos (MLlib no trae el "tonto"):

| Modelo | En MLlib | Qué tiene que dar |
|---|---|---|
| Árbol de decisión | `DecisionTreeClassifier(maxDepth=3)` | Entre 87 % y 93 %: el techo de ~90 % |
| Regresión logística | `Pipeline([StandardScaler, LogisticRegression])` | Menos que el árbol: la regla no es una recta |
| Red neuronal | `Pipeline([StandardScaler, MultilayerPerceptronClassifier(layers=[5, 16, 8, 2])])` | Entre 86 % y 93 % |

En la red, `layers` incluye la entrada y la salida: 5 columnas de entrada,
dos capas ocultas de 16 y 8 (las mismas de scikit-learn) y 2 salidas (vuelve
o no).

Después el árbol aprendido (`toDebugString`), con los nombres de las columnas
en lugar de `feature 0`, `feature 1`... Se lee igual que el de scikit-learn,
pero con `If (antiguedad_meses <= 35.5)` / `Else (antiguedad_meses > 35.5)` y
`Predict: 1.0` (vuelve) o `Predict: 0.0` en las hojas. A diferencia de
scikit-learn, MLlib **saca solo** las preguntas que terminan con la misma
clase en las dos ramas: el árbol queda más corto.

**Validación cruzada.** `CrossValidator` con una grilla de profundidades 2, 3
y 5 (`ParamGridBuilder`) y 3 partes: entrena 3 × 3 = 9 árboles, imprime el
promedio de aciertos de cada profundidad y termina con *Elegida: profundidad
N*. Tiene que elegir 3 o más: con 2 preguntas no alcanza para la regla. Como
la 3 y la 5 llegan las dos al techo, cuál gana depende del sorteo. Esta parte
usa **todos** los clientes (no solo los de entrenamiento): la validación
cruzada ya separa sola.

**3. Clustering.** Un `Pipeline` de tres pasos: `VectorAssembler` (visitas y
logaritmo del ticket) → `StandardScaler` → `KMeans(k=3)`. La tabla de grupos
contra segmentos sale de `crosstab`, y el Rand ajustado se calcula pasando las
dos columnas a pandas (`toPandas()`) para usar la función de scikit-learn: es
un resultado chico, entra en el driver. Tiene que dar más de 0,8, como en
scikit-learn.

Y al final, *Metricas: metricas_spark.json*.

## Comparar los dos JSON

Los dos scripts dejan sus métricas con la misma forma. En un notebook:

<!-- prueba: no (celda de JupyterLab) -->
```python
import json
import pandas as pd

sk = json.load(open("metricas_sklearn.json"))
ml = json.load(open("metricas_spark.json"))
pd.DataFrame({
    "scikit-learn": {n: m["aciertos"] for n, m in sk["clasificacion"].items()},
    "Spark MLlib": {n: m["aciertos"] for n, m in ml["clasificacion"].items()},
}).round(3)
```

Una fila por modelo y una columna por librería (el "tonto" queda sin valor en
la de Spark). Cambiá `"aciertos"` por `"segundos"` para comparar tiempos: con
20.000 filas Spark es **mucho** más lento, porque repartir tiene un costo fijo
(lanzar jobs, mandar datos entre procesos) que acá no se compensa. MLlib existe
para cuando los datos no entran en una compu.

## Paso a paso en un notebook

Las mismas piezas, de a una, para ver qué hay en cada DataFrame:

<!-- prueba: no (celda de JupyterLab) -->
```python
from pyspark.sql import SparkSession
from pyspark.ml.feature import VectorAssembler

spark = SparkSession.builder.appName("MLlib paso a paso").getOrCreate()
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
clientes = spark.read.csv("hdfs:///user/root/ml/clientes_senal.csv", header=True, inferSchema=True)
datos = VectorAssembler(inputCols=ENTRADAS, outputCol="features").transform(clientes)
datos.select("features", "vuelve").show(3, truncate=False)
```

`VectorAssembler` es un **Transformer**: no aprende nada, solo agrega la
columna `features`, con los cinco valores de cada cliente en un vector
(`[50.0,4.0,9131.0,1.0,76.0]` para el primero).

<!-- prueba: no (celda de JupyterLab) -->
```python
from pyspark.ml.classification import DecisionTreeClassifier

ent, prueba = datos.randomSplit([0.8, 0.2], seed=42)
estimador = DecisionTreeClassifier(labelCol="vuelve", maxDepth=3, seed=42)
modelo = estimador.fit(ent)
print(type(estimador).__name__, "->", type(modelo).__name__)
modelo.transform(prueba).select("features", "vuelve", "probability", "prediction").show(5, truncate=False)
```

`fit` devuelve un objeto nuevo (`DecisionTreeClassificationModel`), y
`transform` agrega tres columnas: `rawPrediction`, `probability` (la
probabilidad de cada clase) y `prediction`. Todo es un DataFrame, hasta el
resultado.

<!-- prueba: no (celda de JupyterLab) -->
```python
print(modelo.featureImportances)
spark.stop()
```

Las importancias, como un vector: el lugar 0 es `antiguedad_meses`, el 1
`visitas_mes`, y así. Tendrían que repetir lo de scikit-learn: antigüedad y
visitas arriba, reclamos después, ticket y edad casi en cero.

Cerrá la sesión con `spark.stop()` al terminar: mientras esté abierta, ocupa
lugar en YARN y otro trabajo puede quedar esperando (ver la
[guía 7](07-problemas.md)).

## Qué hiciste

- Entrenaste en el cluster regresión, árbol, logística, red neuronal y KMeans
  con `spark-submit ejemplos/ml/modelos_spark.py`, y llegaron a lo mismo que
  scikit-learn: la fórmula, la regla, el techo del 90 % y los segmentos.
- Usaste las piezas de MLlib: `VectorAssembler`, Estimator → `fit` → Model →
  `transform`, `Pipeline`, evaluadores y `CrossValidator`.
- Comparaste aciertos y tiempos de las dos librerías.

Siguiente: [6. MongoDB + pandas →](06-mongodb-pandas.md)
