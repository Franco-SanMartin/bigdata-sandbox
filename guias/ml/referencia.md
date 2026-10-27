# Referencia de `ml`

Para consultar, no para leer de corrido: cada librería y herramienta que
agrega `ml`, para qué se usa en la industria, las funciones que usan los
ejemplos y cada script de `ejemplos/ml`.

[← Índice de ml](README.md)

## Las librerías

Todas con versión fija, en `conf/requirements-ml.txt`. Para ver las que tenés:

<!-- prueba: adentro | espera: pandas==2.3.3 | espera: scikit-learn==1.9.1 -->
```bash
pip freeze | grep -iE "^(numpy|pandas|pyarrow|scikit-learn|scipy|matplotlib|pymongo|jupyterlab)=="
```

### pandas 2.3.3

Tablas (DataFrames) en la memoria de una compu. Es la herramienta estándar
para explorar, limpiar y preparar datos en Python: la usan analistas,
científicos de datos e ingenieros de datos en casi cualquier empresa, para
datos que entran en una compu (de unas filas a unos pocos GB).

| Función | Para qué | Dónde se usa |
|---|---|---|
| `pd.read_csv(f, dtype=str)` | Leer un CSV; con `dtype=str`, todo como texto, sin adivinar tipos | `etl_pandas.py` |
| `pd.read_csv(f)` | Leer un CSV adivinando los tipos | `modelos_sklearn.py` |
| `df.isna().sum()`, `notna()` | Contar vacíos por columna | `etl_pandas.py`, `mongo_pandas.py` |
| `df.drop_duplicates(subset=...)` | Sacar filas repetidas por una clave | `etl_pandas.py` |
| `s.str.strip()`, `.str.lower()`, `.str.translate()` | Limpiar texto | `etl_pandas.py` |
| `s.str.fullmatch(regex)`, `s.str.replace(...)` | Detectar formatos y cambiar caracteres | `etl_pandas.py` |
| `pd.to_datetime(s, format=...)` | Texto a fecha, con un formato explícito | `etl_pandas.py` |
| `pd.to_numeric(s)` | Texto a número | `etl_pandas.py` |
| `df.fillna(valor)` | Completar vacíos | `etl_pandas.py` |
| `s.quantile([0.25, 0.75])` | Cuartiles (para el IQR) | `etl_pandas.py` |
| `df.groupby(c)[x].transform("median")` | La mediana del grupo al lado de cada fila | `etl_pandas.py` |
| `df.groupby(c).agg(nombre=(col, "sum"))` | Totales por grupo, con nombre | `etl_pandas.py`, `mongo_pandas.py` |
| `df.to_parquet(f)`, `pd.read_parquet(f)` | Guardar y leer Parquet (usa pyarrow) | `etl_pandas.py`, guía 3 |
| `pd.json_normalize(docs)` | Documentos (diccionarios anidados) a tabla | `mongo_pandas.py` |
| `pd.json_normalize(docs, record_path=..., meta=...)` | Una lista adentro de cada documento a otra tabla | `mongo_pandas.py` |
| `pd.crosstab(a, b)` | Tabla de doble entrada (cuántos de cada combinación) | `modelos_sklearn.py` |
| `df.memory_usage(deep=True)` | Cuánta memoria ocupa la tabla | `etl_pandas.py` |

### numpy 1.26.4

Arrays y cálculo numérico rápido: la base sobre la que están armados pandas,
scikit-learn y casi todo el Python científico. La 1.26 es la última 1.x, a
propósito: Spark 3.5 no anda con numpy 2.

Funciones de los ejemplos: `np.random.default_rng(42)` (generador de azar con
semilla), `.choice`, `.integers`, `.lognormal`, `.poisson`, `.normal`,
`.random` (en `generar_senal.py`), `np.select` (un "if" por elemento),
`np.where`, `np.log`, `np.column_stack`.

### scikit-learn 1.9.1

Machine learning clásico en una compu. Es la librería más usada para modelos
sobre datos tabulares (riesgo crediticio, abandono de clientes, precios,
segmentación), sobre todo para prototipos y para datos que entran en memoria.
Todos los modelos tienen la misma forma: `modelo.fit(X, y)` para entrenar,
`modelo.predict(X)` para predecir.

| Clase o función | Qué es | En los ejemplos |
|---|---|---|
| `train_test_split(X, y, test_size=0.2, random_state=42)` | Separar entrenamiento y prueba | 80/20 |
| `LinearRegression` | Regresión lineal; `coef_` y `intercept_` | Predecir el gasto |
| `DummyClassifier(strategy="most_frequent")` | Modelo "tonto": siempre lo más común | La vara mínima |
| `DecisionTreeClassifier(max_depth=3)` | Árbol de decisión; `feature_importances_` | Predecir si vuelve |
| `export_text(arbol, feature_names=...)` | El árbol como texto | Leer las reglas |
| `LogisticRegression` | Regresión logística | Predecir si vuelve |
| `MLPClassifier(hidden_layer_sizes=(16, 8), early_stopping=True)` | Red neuronal (perceptrón multicapa) | Predecir si vuelve |
| `StandardScaler` | Escalar: media 0 y desvío 1 por columna | Antes de la logística, la red y KMeans |
| `make_pipeline(paso1, paso2)` | Encadenar pasos en un solo modelo | Escalar + modelo |
| `cross_val_score(modelo, X, y, cv=5)` | Validación cruzada en 5 partes | Todos los supervisados |
| `KMeans(n_clusters=3, n_init=10)` | Clustering | Segmentos de clientes |
| `r2_score`, `mean_absolute_error` | Métricas de regresión | Regresión |
| `accuracy_score` | Porcentaje de aciertos | Clasificación |
| `adjusted_rand_score` | Parecido entre dos agrupamientos (1 = iguales) | Grupos contra segmentos reales |
| `silhouette_score` | Qué tan separados quedan los grupos | Elegir k |
| `confusion_matrix`, `classification_report` | Aciertos y errores por clase, precision y recall | Guía 4 |

### scipy 1.17.1

Cálculo científico (álgebra lineal, optimización, estadística). Los ejemplos
no la importan: la necesita scikit-learn por dentro.

### matplotlib 3.11.2

Gráficos. Es la librería de gráficos más antigua y usada de Python; pandas la
usa cuando hacés `df.plot()`. En `modelos_sklearn.py`: `plt.figure`,
`plt.scatter`, `plt.yscale("log")`, `plt.xlabel`, `plt.title` y
`plt.savefig("clusters_sklearn.png")`. En JupyterLab los gráficos aparecen
debajo de la celda.

### pyarrow 25.0.0

El formato Arrow (tablas en memoria por columnas) y la lectura y escritura de
**Parquet**. pandas lo usa para `to_parquet` y `read_parquet`; Spark, para
pasar datos a pandas rápido (`toPandas()` con
`spark.sql.execution.arrow.pyspark.enabled`). Parquet es el formato estándar
de los data lakes: por columnas, comprimido y con los tipos adentro.

### pymongo 4.19.0

El driver oficial de MongoDB para Python: lo que usa cualquier aplicación o
proceso de datos en Python que lee o escribe en MongoDB. En `mongo_pandas.py`:
`MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=5000)`,
`cliente["tienda"]`, `db.pedidos.find()` (con filtro y proyección opcionales)
y `db.pedidos.aggregate([...])`. Los documentos llegan como diccionarios.

### JupyterLab 4.6.4

Notebooks en el navegador: código, resultados, tablas y gráficos en el mismo
documento (`.ipynb`). Es el entorno de trabajo habitual para explorar datos y
probar modelos; en la nube hay versiones administradas del mismo formato. En
la imagen:

| Qué | Cómo está |
|---|---|
| Puerto | 8888 (`EXPOSE 8888`) |
| Token y contraseña | Ninguno (`token = ""`, `hashed_password = ""`): por eso el puerto se publica con `127.0.0.1:` |
| Carpeta de inicio | `/datos` (`root_dir`) |
| Terminal | `/bin/bash`, como root |
| Avisos de versiones nuevas | Apagados |
| Configuración | `/etc/jupyter/jupyter_server_config.py` (en el repo, `conf/jupyter_server_config.py`) |
| Log | `/var/log/jupyter.log` |
| Se prende | Con `JUPYTER=si` (por defecto; en los nodos del aula, por defecto `no`) |

### PySpark y Spark MLlib (vienen con Spark 3.5.9)

No están en `requirements-ml.txt`: vienen con Spark, que ya estaba en `base`.
Lo que agrega `ml` es el `PYTHONPATH`
(`/opt/spark/python:/opt/spark/python/lib/py4j-0.10.9.7-src.zip`), para que
`import pyspark` ande desde cualquier `python3` y desde JupyterLab, no solo con
`spark-submit`. Spark es el motor estándar para procesar datos que no entran
en una compu (ETL de data lakes, procesos diarios sobre HDFS o almacenamiento
en la nube), y MLlib, su librería de machine learning.

Funciones de `pyspark.sql` en `etl_spark.py`:

| Función | Equivale en pandas a |
|---|---|
| `spark.read.csv(f, header=True)` | `pd.read_csv(f, dtype=str)` |
| `spark.read.csv(f, header=True, inferSchema=True)` | `pd.read_csv(f)` |
| `df.rdd.getNumPartitions()` | (no existe: pandas no reparte) |
| `df.dropDuplicates([...])` | `drop_duplicates(subset=...)` |
| `df.withColumn(c, expr)` | `df[c] = ...` (pero devuelve otro DataFrame) |
| `F.trim`, `F.lower`, `F.translate` | `.str.strip()`, `.str.lower()`, `.str.translate()` |
| `col.rlike(regex)` | `.str.fullmatch(regex)` (con `^...$`) |
| `F.when(cond, a).when(...).otherwise(b)` | `np.select` / `CASE WHEN` |
| `F.to_date(c, "dd/MM/yyyy")` | `pd.to_datetime(s, format="%d/%m/%Y")` |
| `F.regexp_replace`, `.cast("double")` | `.str.replace`, `pd.to_numeric` |
| `df.fillna({"c": v})` | `fillna` |
| `df.approxQuantile(c, [0.25, 0.75], 0)` | `quantile` (el `0` = exacto) |
| `df.groupBy(c).agg(F.median(x))` + `join` | `groupby(c)[x].transform("median")` |
| `F.coalesce`, `F.floor` | `fillna`, `np.floor` |
| `df.write.mode("overwrite").parquet(f)` | `to_parquet(f)` |
| `df.count()`, `show()`, `first()`, `collect()` | Acciones: recién ahí calcula |
| `df.orderBy(c)` | `sort_values(c)` |
| `df.toPandas()` | Trae todo al driver como DataFrame de pandas |

Clases de `pyspark.ml` en `modelos_spark.py`:

| Clase | Tipo | Qué hace |
|---|---|---|
| `VectorAssembler(inputCols=..., outputCol="features")` | Transformer | Junta columnas en un vector |
| `StandardScaler(withMean=True)` | Estimator → Model | Escala |
| `LinearRegression(labelCol=...)` | Estimator → Model | Regresión lineal (`intercept`, `coefficients`) |
| `DecisionTreeClassifier(maxDepth=3)` | Estimator → Model | Árbol (`toDebugString`, `featureImportances`) |
| `LogisticRegression` | Estimator → Model | Regresión logística |
| `MultilayerPerceptronClassifier(layers=[5, 16, 8, 2], maxIter=200)` | Estimator → Model | Red neuronal |
| `KMeans(k=3)` | Estimator → Model | Clustering |
| `Pipeline(stages=[...])` | Estimator → PipelineModel | Encadena pasos |
| `RegressionEvaluator`, `MulticlassClassificationEvaluator` | Evaluator | Métricas (`r2`, `mae`, `accuracy`) |
| `ParamGridBuilder().addGrid(...)` | | Grilla de hiperparámetros |
| `CrossValidator(numFolds=3)` | Estimator → CrossValidatorModel | Validación cruzada; `bestModel`, `avgMetrics` |
| `df.randomSplit([0.8, 0.2], seed=42)` | | Separar entrenamiento y prueba |
| `df.cache()` | | Guardar en memoria lo que se usa muchas veces |

## Los scripts de `ejemplos/ml`

Todos se corren **adentro del contenedor, parados en `/datos`** (la terminal
de JupyterLab ya arranca ahí; con `docker exec -it bigdata bash`, también).
Están en `/datos/ejemplos/ml` (en tu compu, `datos/ejemplos/ml`); el original
de cada uno queda en `/opt/sandbox/ejemplos/ml`.

| Script | Entrada | Salida | Necesita |
|---|---|---|---|
| `generar_sucios.py` | (nada) | `ventas_sucias.csv` | Solo Python |
| `etl_pandas.py` | `ventas_sucias.csv` | `ventas_limpias.parquet` | pandas |
| `etl_spark.py` | HDFS `/user/root/ml/ventas_sucias.csv` | HDFS `/user/root/ml/ventas_limpias/` | YARN y Spark |
| `generar_senal.py` | (nada) | `clientes_senal.csv` | numpy y pandas |
| `modelos_sklearn.py` | `clientes_senal.csv` | `metricas_sklearn.json`, `clusters_sklearn.png` | scikit-learn |
| `modelos_spark.py` | HDFS `/user/root/ml/clientes_senal.csv` | `metricas_spark.json` (en `/datos`) | YARN y Spark |
| `mongo_pandas.py` | MongoDB, base `tienda` | (solo pantalla) | `MONGODB=si` |

### `generar_sucios.py`

Arma un CSV de ventas con errores **conocidos**, para practicar limpieza. Usa
solo la librería estándar de Python y una semilla fija: el archivo sale igual
siempre.

- **Uso**: `python3 ejemplos/ml/generar_sucios.py [filas] [archivo]`. Por
  defecto, 100.000 tickets en `ventas_sucias.csv` (103.000 filas, con los
  duplicados).
- **Columnas**: `ticket, fecha, sucursal, producto, cantidad, precio, medio_pago`.
- **Errores que mete**: tres formatos de fecha, espacios, mayúsculas y
  tildes, precios con `2.575,00`, cantidades vacías, multiplicadas por 100 o
  negativas, precios vacíos o sin la coma decimal, medios de pago vacíos y
  tickets duplicados.
- **Imprime**: cuántos errores de cada tipo metió y cuántos tickets tendrían
  que quedar después de limpiar (97.200).
- Guía: [2](02-datos-sucios-pandas.md).

### `etl_pandas.py`

Limpia `ventas_sucias.csv` en 8 pasos (leer como texto, duplicados, texto,
fechas, números, nulos, outliers, cargar).

- **Uso**: `python3 ejemplos/ml/etl_pandas.py [entrada] [salida]`. Por
  defecto, `ventas_sucias.csv` → `ventas_limpias.parquet`.
- **Imprime**: lo que hace cada paso, el rango del método IQR, la memoria que
  ocupa la tabla, cuánto tardó y el bloque `=== RESUMEN DEL ETL ===` (cuántas
  filas tocó cada arreglo, filas limpias, facturado total y por sucursal).
- **Columnas de salida**: `ticket, fecha, sucursal, producto, cantidad,
  precio, importe, medio_pago`.
- Guía: [2](02-datos-sucios-pandas.md).

### `etl_spark.py`

El mismo ETL, en PySpark, con el mismo resumen al final (tienen que dar
igual, número por número).

- **Antes**: `hdfs dfs -mkdir -p /user/root/ml` y `hdfs dfs -put -f
  ventas_sucias.csv /user/root/ml/`.
- **Uso**: `spark-submit ejemplos/ml/etl_spark.py [entrada] [salida]`. Por
  defecto, `hdfs:///user/root/ml/ventas_sucias.csv` →
  `hdfs:///user/root/ml/ventas_limpias`.
- **Imprime**: filas leídas y particiones, las primeras filas antes y
  después, el esquema, el rango del IQR y el resumen.
- **Mirar**: http://localhost:4040 mientras corre y http://localhost:18080
  después.
- Guía: [3](03-etl-spark.md).

### `generar_senal.py`

Arma clientes con reglas conocidas y ruido, para machine learning. Semilla
fija (`np.random.default_rng(42)`).

- **Uso**: `python3 ejemplos/ml/generar_senal.py [filas] [archivo]`. Por
  defecto, 20.000 en `clientes_senal.csv`.
- **Columnas**: `antiguedad_meses, visitas_mes, ticket_promedio, reclamos,
  edad, segmento_real, gasto_mes_siguiente, vuelve`.
- **Reglas**: las del docstring del script (y de la [guía 4](04-modelos-sklearn.md)).
- **Imprime**: *Listo: N clientes en archivo*, las 5 primeras filas, cuántos
  hay por segmento, el porcentaje que vuelve y el de respuestas dadas vuelta.

### `modelos_sklearn.py`

Regresión lineal, cuatro clasificadores (tonto, árbol, logística, red) y
KMeans con scikit-learn, cada uno al lado de la regla real.

- **Uso**: `python3 ejemplos/ml/modelos_sklearn.py [archivo]`. Por defecto,
  `clientes_senal.csv`.
- **Imprime**: coeficientes aprendidos contra la regla, R², error medio y
  validación cruzada; tabla de aciertos, validación cruzada, tiempo y memoria
  de cada clasificador; el árbol como texto y la importancia de cada columna;
  Rand ajustado sin escalar y escalado, la tabla de grupos contra segmentos y
  el silhouette de k = 2 a 5.
- **Deja**: `metricas_sklearn.json` (las métricas, para comparar) y
  `clusters_sklearn.png` (el gráfico de los grupos).
- **Mide** el tiempo con `time.perf_counter()` y la memoria pico de Python con
  `tracemalloc` (que hace el entrenamiento un poco más lento).
- Guía: [4](04-modelos-sklearn.md).

### `modelos_spark.py`

Los mismos modelos con Spark MLlib, más una validación cruzada que elige la
profundidad del árbol.

- **Antes**: `hdfs dfs -put -f clientes_senal.csv /user/root/ml/`.
- **Uso**: `spark-submit ejemplos/ml/modelos_spark.py [entrada]`. Por
  defecto, `hdfs:///user/root/ml/clientes_senal.csv`.
- **Imprime**: lo mismo que el de scikit-learn (sin el "tonto" ni la memoria),
  el árbol con `toDebugString`, el promedio de aciertos de cada profundidad y
  la elegida.
- **Deja**: `metricas_spark.json` en `/datos`, con la misma forma que el de
  scikit-learn más `validacion_cruzada`.
- Guía: [5](05-modelos-spark-mllib.md).

### `mongo_pandas.py`

Lee los pedidos de MongoDB y los aplana con `json_normalize`.

- **Antes**: contenedor con `-e MONGODB=si` (la base `tienda` se carga sola).
- **Uso**: `python3 ejemplos/ml/mongo_pandas.py` (sin argumentos; se conecta a
  `localhost:27017`).
- **Imprime**: cuántos pedidos leyó y uno de ejemplo, las columnas de la
  tabla y cuántos pedidos tienen cada campo, unidades y facturado por
  producto, y si MongoDB (`$unwind` + `$group`) calcula lo mismo.
- Guía: [6](06-mongodb-pandas.md).

## La prueba de la imagen

Antes de publicar cada versión, `pruebas/probar_ml.sh` corre todos estos
scripts en una imagen recién armada y comprueba, entre otras cosas, que:

- `generar_sucios.py` y `generar_senal.py` dan exactamente los mismos
  archivos de siempre (por su suma md5);
- el resumen del ETL de pandas y el de Spark son idénticos, y cada arreglo
  coincide con los errores que metió el generador;
- en los dos juegos de modelos, los coeficientes quedan cerca de la regla, el
  R² pasa 0,9, el árbol queda entre 87 % y 93 %, la red entre 86 % y 93 %, la
  logística por debajo del árbol y KMeans por encima de 0,8 de Rand ajustado;
- el árbol de scikit-learn encuentra los cortes `visitas_mes <= 3.50` y
  `antiguedad_meses <= 35.50`;
- JupyterLab responde en el 8888 sin contraseña y un notebook corre;
- pandas y MongoDB dan lo mismo.

Si alguno de los números de las guías no te da, esa lista dice qué es lo que
la imagen garantiza.

[← Índice de ml](README.md)
