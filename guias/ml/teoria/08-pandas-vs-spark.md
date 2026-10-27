# 8. pandas contra Spark

[← 7. Evaluación](07-evaluacion.md) · [Índice de teoría](README.md) · Siguiente: [9. ML distribuido con MLlib →](09-ml-distribuido-mllib.md)

## Lo mismo, de dos formas

`etl_pandas.py` y `etl_spark.py` hacen los mismos 8 pasos sobre el mismo
archivo y dan el mismo resumen, número por número (la prueba de la imagen lo
comprueba con `diff`). Lo que cambia es **dónde** están los datos y **cómo**
se calcula.

## pandas: una tabla en la memoria de una compu

Un DataFrame de pandas está entero en la memoria RAM del proceso de Python.
Cada operación se hace **ya**, sobre toda la tabla, con código muy optimizado
(numpy, en C). Consecuencias:

- **Rápido** para datos chicos y medianos: el ETL de 100.000 filas tarda un
  segundo.
- **Interactivo**: escribís `ventas.head()` y ves la tabla. Ideal para
  explorar.
- **Con orden**: hay fila 0, fila 1; un índice.
- **Se puede modificar**: `ventas["fecha"] = ...` cambia la tabla.
- **Límite**: la RAM. La tabla limpia ocupa ~20 MB en pandas contra ~1 MB en
  Parquet: en memoria, los datos ocupan varias veces más que en disco. Y
  muchas operaciones hacen copias. Una tabla de decenas de GB no entra en una
  compu común.

## Spark: una tabla repartida en un cluster

Un DataFrame de Spark está partido en **particiones**, repartidas entre los
**executors** (procesos Java, cada uno con su memoria; en un cluster real, en
distintas máquinas). El **driver** (tu script o tu notebook) no tiene los
datos: tiene un **plan**.

- **Perezoso** (*lazy*): `withColumn`, `filter`, `join` no calculan nada,
  agregan pasos al plan. Se calcula recién con una **acción**: `count`,
  `show`, `collect`, `write`. Cada acción lanza un **job** (se ven en
  http://localhost:4040).
- **Optimiza antes de calcular**: como tiene el plan entero, lo reordena
  (filtrar antes de juntar, leer solo las columnas que se usan de un
  Parquet). `explain()` muestra el plan.
- **Inmutable**: cada paso devuelve un DataFrame nuevo (`ventas =
  ventas.withColumn(...)`).
- **Sin orden**: las filas están en particiones; si querés un orden, `orderBy`.
- **Escala agregando máquinas**: si los datos crecen 10 veces, se agregan
  executors.
- **Costo fijo**: pedir recursos a YARN, arrancar executors, mandar código y
  datos entre procesos. Con 100.000 filas, ese costo domina: el ETL de Spark
  tarda bastante más que el de pandas.

## Las diferencias en el código del ETL

| Operación | pandas | Spark | Por qué cambia |
|---|---|---|---|
| Mediana por producto al lado de cada fila | `groupby("producto")["precio"].transform("median")` | `groupBy("producto").agg(F.median("precio"))` + `join` | En Spark no hay "al lado de cada fila": se calcula una tabla chica y se junta |
| Cuartiles | `quantile([0.25, 0.75])` | `approxQuantile(..., 0)` | Calcular un cuantil exacto obliga a ordenar todo; Spark ofrece uno aproximado (el `0` pide error 0: exacto) |
| Guardar | Un archivo `.parquet` | Una carpeta con un `part-...` por partición y `_SUCCESS` | Cada executor escribe lo suyo, en paralelo |
| Contar cada arreglo | Gratis (la tabla ya está calculada) | Un `count()` = un job | Lazy: contar obliga a calcular |
| Seguir después de guardar | Con la misma tabla | Se vuelve a leer el Parquet | Si no, cada acción recalcularía el plan desde el CSV |

## Los datos que viajan

- **Shuffle** (redistribución): para agrupar por sucursal, todas las filas de
  "centro" tienen que terminar en el mismo executor. Spark las manda por la
  red de un executor a otro. Es lo más caro de un trabajo distribuido;
  aparece en el plan como `Exchange`. Los `groupBy`, `join`, `orderBy` y
  `dropDuplicates` lo provocan.
- **`collect()` y `toPandas()`** traen **todo** al driver. Con un resultado
  chico (un total por sucursal, dos columnas para el Rand ajustado en
  `modelos_spark.py`) está bien; con la tabla entera de un data lake, el
  driver se queda sin memoria.

La regla: **lo pesado en Spark, el resultado chico a pandas**.

## Cuándo conviene cada uno

| Situación | Conviene |
|---|---|
| Datos que entran cómodos en la RAM de una compu (hasta unos pocos GB) | pandas |
| Explorar, probar, graficar | pandas (o Spark para reducir y después pandas) |
| Datos que no entran en una compu | Spark |
| Los datos ya están en HDFS, Hive o un data lake | Spark (lee en paralelo, cerca de los datos) |
| Un proceso que corre todos los días sobre datos que crecen | Spark |
| Pocos datos, pero un cálculo pesado que se puede partir (muchas combinaciones de hiperparámetros) | Spark puede ayudar |

En la industria se usan los dos, juntos: Spark para el ETL grande sobre el
data lake y para dejar tablas resumidas, pandas para el análisis y los
modelos sobre esas tablas. Hay también herramientas intermedias (Spark tiene
una API con la sintaxis de pandas, `pyspark.pandas`), que la imagen no usa.

## Para repasar

- pandas: en memoria, inmediato, con orden, modificable; límite = la RAM.
- Spark: repartido, perezoso (plan + acciones), inmutable, sin orden; escala
  con máquinas, pero tiene un costo fijo.
- El shuffle es lo caro; `collect`/`toPandas` solo para resultados chicos.
- Mismo resultado, distinto costo: se elige por el tamaño de los datos y dónde
  están.

[← 7. Evaluación](07-evaluacion.md) · [Índice de teoría](README.md) · Siguiente: [9. ML distribuido con MLlib →](09-ml-distribuido-mllib.md)
