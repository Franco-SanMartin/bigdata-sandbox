# Evaluación 8. pandas contra Spark

[← 7. Evaluación de modelos](07-evaluacion.md) · [Índice de evaluación](README.md) · Teoría: [8. pandas contra Spark](../teoria/08-pandas-vs-spark.md) · Siguiente: [9. ML distribuido con MLlib →](09-ml-distribuido-mllib.md)

## Multiple choice

**1.** En Spark, ¿qué pasa cuando se ejecuta
`ventas = ventas.withColumn("importe", F.col("cantidad") * F.col("precio"))`?

- a) Calcula el importe de todas las filas en ese momento.
- b) No calcula nada: agrega un paso al plan. Se calcula recién con una
  acción (`count`, `show`, `write`).
- c) Modifica la tabla original en HDFS.
- d) Trae los datos al driver para calcular.

<details><summary>Respuesta</summary>

**b)**. Spark es perezoso (*lazy*): las transformaciones arman un plan; las
acciones lo ejecutan.

- a) No: eso es pandas.
- c) No: los DataFrames de Spark son inmutables, y el archivo en HDFS no se
  toca.
- d) No: los datos se quedan en los executors.

</details>

**2.** ¿Qué es un **shuffle** y por qué importa?

- a) Mezclar las filas al azar antes de entrenar.
- b) Mover filas por la red entre executors para que las de la misma clave
  queden juntas (en un `groupBy`, `join` u `orderBy`); es lo más caro de un
  trabajo distribuido.
- c) Ordenar las columnas alfabéticamente.
- d) Un tipo de archivo de Spark.

<details><summary>Respuesta</summary>

**b)**. En el plan aparece como `Exchange`. Menos shuffles, trabajo más
rápido.

- a) No: el nombre se presta, pero no es eso.
- c) No: no tiene que ver con columnas.
- d) No: no es un formato.

</details>

**3.** En pandas, la mediana por producto se pone al lado de cada fila con
`transform("median")`. ¿Cómo lo hace `etl_spark.py`?

- a) Con el mismo `transform`.
- b) Calcula una tabla chica de medianas con `groupBy().agg(F.median(...))`
  y la junta con las ventas con un `join`.
- c) Con un `for` que recorre las filas.
- d) Trae todo a pandas, calcula y vuelve.

<details><summary>Respuesta</summary>

**b)**. En Spark no hay "al lado de cada fila" sin juntar: la tabla de 8
medianas es chica y se junta.

- a) No: los DataFrames de Spark no tienen ese `transform`.
- c) No: recorrer filas una por una no escala; en Spark ni se hace así.
- d) No: eso no escalaría con datos grandes.

</details>

**4.** `etl_pandas.py` deja un archivo `ventas_limpias.parquet`; `etl_spark.py`
deja una **carpeta** en HDFS. ¿Por qué?

- a) Porque Spark guarda cada columna en un archivo.
- b) Porque cada executor escribe su partición en paralelo (un `part-...`
  cada uno), más un `_SUCCESS` que avisa que terminó.
- c) Porque HDFS no acepta archivos sueltos.
- d) Porque Spark guarda una copia de seguridad.

<details><summary>Respuesta</summary>

**b)**. Escribir en paralelo es la gracia. Quien lee la carpeta (Spark,
Hive, pandas con pyarrow) la trata como una sola tabla.

- a) No: Parquet es por columnas **adentro** de cada archivo.
- c) No: HDFS acepta archivos; en la guía 3 se sube un CSV suelto.
- d) No: las copias las hace HDFS por su cuenta (replicación), no Spark.

</details>

**5.** ¿Cuándo es razonable usar `toPandas()`?

- a) Siempre, para trabajar más cómodo.
- b) Cuando el resultado es chico (un resumen, unas columnas de una muestra):
  trae todo al driver.
- c) Nunca: es un error.
- d) Solo con datos de más de 1 TB.

<details><summary>Respuesta</summary>

**b)**. `modelos_spark.py` lo usa con dos columnas para calcular el Rand
ajustado. Con la tabla entera de un data lake, el driver se queda sin
memoria.

- a) No: con datos grandes no entra.
- c) No: es el puente entre los dos mundos.
- d) No: al revés, con datos grandes es cuando no hay que usarlo.

</details>

**6.** Con las 100.000 filas de las ventas, el ETL de pandas tarda un segundo
y el de Spark bastante más. ¿Por qué?

- a) Porque Spark está mal configurado en la imagen.
- b) Porque Spark tiene un costo fijo (pedir recursos a YARN, arrancar
  executors, mandar datos entre procesos) que con pocos datos domina.
- c) Porque Spark lee el CSV dos veces.
- d) Porque pandas usa la placa de video.

<details><summary>Respuesta</summary>

**b)**. El costo fijo no crece con los datos; con datos que no entran en una
compu, repartir gana.

- a) No: con pocos datos es lo esperable.
- c) No: el problema es el costo de arrancar y coordinar.
- d) No: pandas corre en el procesador.

</details>

**7.** ¿Cuál de estas situaciones pide Spark y no pandas?

- a) Explorar una planilla de 50.000 filas.
- b) Un gráfico de las ventas del mes.
- c) Un proceso diario sobre 2 TB de eventos guardados en HDFS.
- d) Un modelo sobre 20.000 clientes.

<details><summary>Respuesta</summary>

**c)**. No entra en una compu y ya está en HDFS: Spark lo procesa en
paralelo, cerca de los datos.

- a), b) y d) No: entran cómodos en la memoria; pandas y scikit-learn son
  más rápidos y más simples.

</details>

## Preguntas de desarrollo

**1.** Nombrá cuatro diferencias entre un DataFrame de pandas y uno de Spark.

<details><summary>Respuesta modelo</summary>

| pandas | Spark |
|---|---|
| Entero en la memoria de un proceso | Repartido en particiones entre executors |
| Cada operación se calcula ya | Perezoso: plan + acciones |
| Se puede modificar | Inmutable: cada paso devuelve otro |
| Tiene orden e índice | Sin orden: hay que pedir `orderBy` |
| Límite: la RAM | Escala agregando máquinas, con costo fijo |

Cualquier cuatro, explicadas.

</details>

**2.** Una empresa tiene 3 años de tickets (500 millones de filas) en HDFS y
quiere un modelo que prediga ventas por sucursal y día. Proponé qué haría
Spark y qué haría pandas o scikit-learn.

<details><summary>Respuesta modelo</summary>

Spark: leer los tickets de HDFS, limpiar (el mismo tipo de ETL que
`etl_spark.py`) y **agregar** por sucursal y día. El resultado tiene pocas
filas (sucursales × ~1.100 días), que entra cómodo en una compu. Ese
resultado se pasa a pandas (`toPandas` o escribiéndolo en Parquet y leyéndolo
con pandas), y con scikit-learn se arma y evalúa el modelo. Es el patrón "lo
pesado en Spark, el resultado chico a pandas". Si el proceso corre todos los
días, el ETL en Spark queda como trabajo programado.

</details>

## Ejercicios prácticos

### Ejercicio 1. El mismo número en los dos mundos

Hechas las guías [2](../02-datos-sucios-pandas.md) y
[3](../03-etl-spark.md). Calculá la cantidad de tickets y el facturado por
medio de pago:

1. Con pandas, desde `ventas_limpias.parquet`.
2. Con Spark, desde `hdfs:///user/root/ml/ventas_limpias`.

Comprobá que dan lo mismo y explicá qué pasa en cada caso cuando se escribe
la agrupación y cuando se muestra el resultado.

<details><summary>Solución</summary>

pandas:

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd

ventas = pd.read_parquet("ventas_limpias.parquet")
print(ventas.groupby("medio_pago")["importe"].agg(["count", "sum"]))
```

Spark:

<!-- prueba: no (celda de Jupyter: solución de ejercicio, usa el cluster) -->
```python
from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("ejercicio medios de pago").getOrCreate()
limpias = spark.read.parquet("hdfs:///user/root/ml/ventas_limpias")
por_medio = limpias.groupBy("medio_pago").agg(F.count("*").alias("tickets"),
                                              F.sum("importe").alias("facturado"))
por_medio.orderBy("medio_pago").show()
spark.stop()
```

Los dos tienen que dar:

| medio_pago | Tickets | Facturado |
|---|---:|---:|
| credito | 23.185 | 240.465.391 |
| debito | 23.010 | 241.682.974 |
| desconocido | 5.000 | 51.326.298 |
| efectivo | 23.023 | 235.164.334 |
| qr | 22.982 | 234.478.919 |

La suma es 1.003.117.916, el facturado total del resumen del ETL, y los
5.000 `desconocido` son los que venían sin medio de pago.

En pandas, el `groupby(...).agg(...)` calcula en el momento. En Spark, el
`groupBy(...).agg(...)` solo arma el plan; el `show()` es la acción que lanza
el job (se ve en http://localhost:4040), con un shuffle para juntar las filas
de cada medio de pago.

</details>

| Criterio | Puntos |
|---|---:|
| Agrupación correcta en pandas | 2 |
| Agrupación correcta en Spark, leyendo de HDFS | 3 |
| Los números coinciden (y con el total del ETL) | 2 |
| Explica lazy contra inmediato y la acción que dispara el cálculo | 3 |

### Ejercicio 2. Leer un plan

Hecha la guía 3. En un notebook, con `limpias` leído de HDFS como en el
ejercicio 1, mostrá el plan de:

1. `limpias.select("producto", "importe").filter(F.col("importe") > 10000)`
2. `limpias.groupBy("sucursal").agg(F.sum("importe"))`

Para cada uno: ¿hay `Exchange`? ¿Qué columnas lee del Parquet? ¿Por qué?

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio, usa el cluster) -->
```python
limpias.select("producto", "importe").filter(F.col("importe") > 10000).explain()
limpias.groupBy("sucursal").agg(F.sum("importe")).explain()
```

Lo que hay que encontrar en cada plan (los detalles exactos dependen de la
versión de Spark):

| | Plan 1 | Plan 2 |
|---|---|---|
| `Exchange` | No: cada partición se filtra sola, no hace falta mover filas | Sí: para sumar por sucursal, las filas de cada sucursal tienen que juntarse |
| Columnas leídas (`ReadSchema` del `FileScan parquet`) | Solo `producto` e `importe` | Solo `sucursal` e `importe` |
| Filtro | Aparece en `PushedFilters`: Parquet puede saltear bloques que no cumplen | No hay |

Lee solo las columnas que usa porque Parquet es por columnas y Spark mira el
plan entero antes de leer. El segundo plan agrega en dos etapas: una suma
parcial en cada partición, el `Exchange` y la suma final; así viaja una fila
por sucursal y partición, no todas.

</details>

| Criterio | Puntos |
|---|---:|
| Muestra los dos planes con `explain()` | 2 |
| Identifica el `Exchange` solo en el segundo, y por qué | 3 |
| Identifica las columnas leídas y lo relaciona con Parquet | 3 |
| Menciona el filtro empujado o la agregación en dos etapas | 2 |

[← 7. Evaluación de modelos](07-evaluacion.md) · [Índice de evaluación](README.md) · Teoría: [8. pandas contra Spark](../teoria/08-pandas-vs-spark.md) · Siguiente: [9. ML distribuido con MLlib →](09-ml-distribuido-mllib.md)
