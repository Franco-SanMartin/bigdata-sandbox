# Evaluación 7. Spark

[← 6. Sqoop](06-sqoop.md) · [Evaluación](README.md) · Teoría: [Spark](../teoria/07-spark.md) · Guía: [8. Spark](../../08-spark.md) · Siguiente: [8. ZooKeeper y HA →](08-zookeeper-ha.md)

## Opción múltiple

**1.** En un programa de Spark, ¿qué hace el **driver** y qué hacen los
**executors**?

- a) El driver guarda los datos y los executors los leen.
- b) El driver es tu programa: arma el plan y reparte las tareas; los
  executors (contenedores de YARN) procesan las particiones de los datos.
- c) Son dos nombres para lo mismo.
- d) El driver es el NameNode de Spark.

<details><summary>Respuesta</summary>

**b)** En la imagen el driver corre en el contenedor donde lanzaste
`spark-submit` (modo `client`) y hay 2 executors de 512 MB.

- a) Los datos están en HDFS; los executors los leen y procesan.
- c) Son papeles distintos.
- d) Spark no tiene NameNode: usa el de HDFS.

</details>

**2.** ¿Cuándo ejecuta Spark un `filter` o un `groupBy`?

- a) Apenas se escribe la línea.
- b) Recién cuando una **acción** (`show`, `count`, `write`, `collect`) pide
  un resultado; antes solo se arma el plan.
- c) Al final del programa, siempre.
- d) Nunca: `groupBy` es solo para SQL.

<details><summary>Respuesta</summary>

**b)** Como en Pig, la evaluación es diferida: así el optimizador (Catalyst)
ve el plan entero.

- a) Las transformaciones no ejecutan.
- c) Si nunca hay una acción, no se ejecuta nada.
- d) `groupBy` es una transformación de DataFrame.

</details>

**3.** ¿Qué hace más rápido a Spark que MapReduce en cálculos de varias
etapas?

- a) Que no usa YARN.
- b) Que planifica el cálculo entero como un DAG y mantiene en memoria lo
  intermedio, en vez de escribir en HDFS entre un trabajo y otro.
- c) Que solo funciona con datos chicos.
- d) Que está escrito en Python.

<details><summary>Respuesta</summary>

**b)** Con datos que se recorren muchas veces (aprendizaje automático,
consultas encadenadas), la diferencia es grande.

- a) En la imagen corre sobre YARN.
- c) Escala a datos enormes; si no entran en memoria, escribe a disco.
- d) Está escrito en Scala; PySpark es la interfaz de Python.

</details>

**4.** Un `groupBy("producto").agg(...)` seguido de `show()`. ¿Cuántos
**stages** tiene el job, como mínimo?

- a) Uno.
- b) Dos: uno que lee y hace sumas parciales por partición, y otro, después
  del shuffle, que junta las sumas de cada clave.
- c) Uno por producto.
- d) Uno por fila.

<details><summary>Respuesta</summary>

**b)** Los stages se cortan donde hay un shuffle. Se ven en
http://localhost:4040 mientras corre, y después en 18080.

- a) El shuffle obliga a cortar.
- c) y d) Los stages no dependen de las claves ni de las filas; las tasks
  dependen de las particiones.

</details>

**5.** En la imagen, `spark.sql.shuffle.partitions` vale 4. ¿Qué controla?

- a) La cantidad de executors.
- b) En cuántas particiones (y por lo tanto tasks) quedan los datos después de
  un shuffle; de fábrica es 200, demasiado para datos chicos.
- c) La memoria de cada executor.
- d) La cantidad de archivos que lee.

<details><summary>Respuesta</summary>

**b)** Con 200 particiones para 8 productos habría 200 tasks casi vacías.
Por eso `write.csv` deja hasta 4 archivos `part-*`.

- a) Los executors los fija `spark.executor.instances` (2).
- c) Eso es `spark.executor.memory` (512m).
- d) Las particiones de lectura dependen de los bloques de la entrada.

</details>

**6.** ¿Qué riesgo tiene `df.collect()` sobre un DataFrame grande?

- a) Ninguno.
- b) Trae todas las filas a la memoria del driver (512 MB en la imagen), que
  puede quedarse sin memoria.
- c) Borra el DataFrame.
- d) Escribe en HDFS.

<details><summary>Respuesta</summary>

**b)** Para mirar se usa `show(n)` o `limit`; para guardar, `write`.

- a) El driver no está pensado para tener todos los datos.
- c) No borra nada.
- d) No escribe nada.

</details>

**7.** ¿Por qué Spark ve la tabla `ventas` que creó Hive?

- a) Porque Spark copia los datos de Hive.
- b) Porque los dos usan el mismo **metastore**: Spark lee de ahí el esquema
  y la carpeta de HDFS, y lee los archivos él mismo.
- c) Porque Spark le pide a HiveServer2 que ejecute la consulta.
- d) No la ve; hay que volver a crearla.

<details><summary>Respuesta</summary>

**b)** Está configurado con `spark.sql.catalogImplementation hive`. La
consulta la ejecuta Spark (aparece como `SPARK` en 8088), no Tez.

- a) No copia nada.
- c) Spark ejecuta con sus executors.
- d) La guía 8 la consulta sin crearla.

</details>

**8.** ¿Para qué sirve `spark.stop()` al final del programa?

- a) Para guardar los resultados.
- b) Para liberar los contenedores de YARN: si no, ocupan memoria y otros
  trabajos pueden quedar en `ACCEPTED`.
- c) Para apagar el cluster.
- d) Para borrar los DataFrames de HDFS.

<details><summary>Respuesta</summary>

**b)** Lo mismo pasa con una consola `pyspark` abierta: retiene sus
contenedores.

- a) Guardar es `write`.
- c) Solo termina tu aplicación.
- d) Los DataFrames no están en HDFS.

</details>

**9.** ¿Qué es `inferSchema=True` en `spark.read.csv`?

- a) Que Spark recorra los datos para deducir el tipo de cada columna
  (número, texto, fecha), en vez de leer todo como texto.
- b) Que Spark use el esquema del metastore.
- c) Que valide los datos contra un JSON Schema.
- d) Que saltee el encabezado.

<details><summary>Respuesta</summary>

**a)** Cuesta una pasada extra por los datos. En producción se suele dar el
esquema explícito.

- b) Para eso se lee la tabla (`spark.table("ventas")` o SQL).
- c) No tiene que ver con JSON Schema.
- d) Eso es `header=True`.

</details>

**10.** ¿Qué hace `df.cache()`?

- a) Guarda el DataFrame en HDFS para siempre.
- b) Le pide a Spark que, la primera vez que lo calcule, lo guarde en la
  memoria de los executors para reusarlo en las acciones siguientes.
- c) Ejecuta el DataFrame en ese momento.
- d) Lo borra de la memoria.

<details><summary>Respuesta</summary>

**b)** Conviene cuando un mismo DataFrame se usa varias veces. Si se pierde
una partición cacheada, Spark la recalcula desde su linaje.

- a) Es en memoria, y dura lo que la aplicación.
- c) `cache` también es diferido: se llena con la primera acción.
- d) Eso es `unpersist()`.

</details>

## Desarrollo

**1.** Explicá qué es un DataFrame y en qué se parece y se diferencia de una
tabla de Hive.

<details><summary>Respuesta modelo</summary>

Un DataFrame es una tabla (filas con columnas con nombre y tipo) repartida en
particiones entre los executors. Se parece a una tabla de Hive en que tiene
esquema y se puede consultar con SQL (`spark.sql`). Se diferencia en que vive
**dentro de una aplicación**: es un plan de cómo calcular los datos, que se
ejecuta con una acción, y desaparece con `spark.stop()` salvo que se guarde
(`write` o `saveAsTable`). Una tabla de Hive es una entrada permanente en el
metastore que apunta a archivos de HDFS.

</details>

**2.** ¿Qué es el **linaje** de un DataFrame y cómo permite que Spark tolere
fallas sin replicar los datos intermedios?

<details><summary>Respuesta modelo</summary>

Es la cadena de transformaciones que lleva desde los datos de origen hasta el
DataFrame (leer, filtrar, calcular, agrupar). Spark lo conoce porque arma el
plan antes de ejecutar. Si un executor se cae y se pierden particiones que
estaban en memoria, Spark no necesita copias: vuelve a calcular solo esas
particiones aplicando el linaje desde la fuente (los bloques de HDFS, que sí
están replicados) o desde el último shuffle guardado. MapReduce, en cambio,
garantiza la tolerancia escribiendo en HDFS entre trabajos.

</details>

**3.** El mismo cálculo de ventas por producto se hizo con MapReduce, Pig,
Hive y Spark. ¿Cuál elegirías hoy para un proyecto nuevo y por qué?

<details><summary>Respuesta modelo</summary>

Para un proyecto nuevo, Spark: el mismo motor sirve para SQL
(`spark.sql`), para código paso a paso (DataFrames, en Python), para
aprendizaje automático y para datos en flujo, y es más rápido que MapReduce
en cálculos de varias etapas. Hive (con Tez) sigue siendo razonable si el
equipo trabaja solo con SQL y ya tiene el cluster. MapReduce a mano y Pig
quedan para mantener lo existente o para aprender cómo funciona por dentro.
Lo importante es que el resultado es el mismo en los cuatro: elegir es una
cuestión de productividad y rendimiento, no de qué se puede calcular.

</details>

## Ejercicios sobre la imagen

Los programas se guardan en tu carpeta `datos/` y se corren adentro con
`spark-submit archivo.py`. Suponen las ventas en `/user/root/ventas`.

### Ejercicio 1. El termo en cada sucursal

Con DataFrames, calculá para el **termo**, por sucursal, la cantidad de
ventas y la facturación, de mayor a menor facturación.

<details><summary>Solución</summary>

<!-- prueba: adentro < spark-submit {} | espera: 106155000 | espera: 101150000 -->
```python
from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("termo por sucursal").getOrCreate()

ventas = spark.read.csv("hdfs:///user/root/ventas", header=True, inferSchema=True)

(ventas.filter(F.col("producto") == "termo")
       .withColumn("importe", F.col("cantidad").cast("long") * F.col("precio"))
       .groupBy("sucursal")
       .agg(F.count("*").alias("tickets"), F.sum("importe").alias("facturado"))
       .orderBy(F.desc("facturado"))
       .show())

spark.stop()
```

| sucursal | tickets | facturado |
|---|---:|---:|
| Oeste | 1032 | 106155000 |
| Norte | 987 | 103320000 |
| Sur | 967 | 102130000 |
| Centro | 959 | 101150000 |

Suman 3945 ventas y 412.755.000, lo mismo que el termo en la guía.

</details>

**Rúbrica (8 puntos)**: filtro por producto (2), importe con tipo `long` (1),
`groupBy` con las dos agregaciones (3), orden y resultado exactos (2).

### Ejercicio 2. Facturación por mes, guardada en HDFS

Calculá la facturación por mes y guardala como CSV en
`/user/root/resultados/spark_por_mes`. Mostrala también por pantalla. ¿Cuántos
archivos `part-*` quedan en la carpeta, como máximo, y por qué?

<details><summary>Solución</summary>

<!-- prueba: adentro < spark-submit {} | espera: 330992000 | espera: 312655300 -->
```python
from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("ventas por mes").getOrCreate()

ventas = spark.read.csv("hdfs:///user/root/ventas", header=True, inferSchema=True)

por_mes = (
    ventas.withColumn("mes", F.date_format(F.col("fecha"), "yyyy-MM"))
    .withColumn("importe", F.col("cantidad").cast("long") * F.col("precio"))
    .groupBy("mes")
    .agg(F.count("*").alias("ventas"), F.sum("importe").alias("facturado"))
    .orderBy("mes")
)
por_mes.show()
por_mes.write.mode("overwrite").csv("hdfs:///user/root/resultados/spark_por_mes", header=True)

spark.stop()
```

| mes | ventas | facturado |
|---|---:|---:|
| 2026-01 | 34778 | 330992000 |
| 2026-02 | 30876 | 294766600 |
| 2026-03 | 34039 | 328358900 |
| 2026-04 | 32950 | 317441300 |
| 2026-05 | 34163 | 329053100 |
| 2026-06 | 33194 | 312655300 |

- `date_format` sirve tanto si `inferSchema` leyó la fecha como fecha como si
  la dejó como texto.
- Quedan como máximo 4 archivos `part-*` (más `_SUCCESS`): después del
  shuffle hay `spark.sql.shuffle.partitions` = 4 particiones, y cada una se
  escribe en su archivo. Se mira con `hdfs dfs -ls
  /user/root/resultados/spark_por_mes`.

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| Extrae el mes correctamente | 3 |
| Agrupa y suma con tipo `long` | 2 |
| Guarda en HDFS con `mode("overwrite")` | 2 |
| Resultado exacto | 2 |
| Explica la cantidad de archivos por las particiones del shuffle | 1 |

### Ejercicio 3. De Spark a Hive

Guardá desde Spark una tabla `ventas_por_sucursal` (sucursal, tickets,
facturado) y consultala desde Hive con beeline.

<details><summary>Solución</summary>

<!-- prueba: no (solución de ejercicio: saveAsTable no se usa en las guías probadas) -->
```python
from pyspark.sql import SparkSession

spark = SparkSession.builder.appName("tabla para hive").getOrCreate()

(spark.sql("""
    SELECT sucursal, COUNT(*) AS tickets, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
    FROM ventas
    GROUP BY sucursal
""").write.mode("overwrite").saveAsTable("ventas_por_sucursal"))

spark.stop()
```

<!-- prueba: no (solución de ejercicio: depende de la tabla creada con saveAsTable) -->
```bash
beeline -u jdbc:hive2://localhost:10000 -e "SELECT * FROM ventas_por_sucursal ORDER BY facturado DESC;"
hdfs dfs -ls /user/hive/warehouse
```

| sucursal | tickets | facturado |
|---|---:|---:|
| Oeste | 50155 | 480328000 |
| Norte | 50062 | 480187600 |
| Sur | 49932 | 476986200 |
| Centro | 49851 | 475765400 |

- La tabla queda en el metastore compartido y sus archivos en
  `/user/hive/warehouse/ventas_por_sucursal`, en el formato de fábrica de
  Spark (Parquet), no en texto.
- Desde Hive se consulta como cualquier otra tabla: la consulta la corre Tez.

</details>

**Rúbrica (8 puntos)**: consulta o DataFrame correcto (2), `saveAsTable`
(2), la consulta desde beeline (2), explica que comparten el metastore (2).

### Ejercicio 4. Mirar el plan

Corré de nuevo el ejercicio 1 y, mientras corre, mirá http://localhost:4040
(o, terminado, la aplicación en http://localhost:18080). ¿Cuántos jobs hubo?
En el job del `show`, ¿cuántos stages y cuántas tasks tiene el stage
posterior al shuffle?

<details><summary>Solución</summary>

- Hay más de un job: leer con `inferSchema=True` dispara jobs propios (Spark
  tiene que recorrer el archivo para deducir los tipos), además del job del
  `show`. El número exacto depende de la versión; lo que se evalúa es que lo
  explique.
- El job del `show` tiene al menos **dos stages**, separados por el shuffle
  del `groupBy`. El primero tiene una task por partición de entrada (los
  bloques del archivo); el posterior al shuffle trabaja con las particiones
  de `spark.sql.shuffle.partitions` (hasta 4: la ejecución adaptativa, activa
  de fábrica en Spark 3.5, puede juntarlas en menos si son chicas).
- La pestaña **SQL** muestra el plan físico: la lectura del CSV, el filtro,
  un `HashAggregate` parcial, el `Exchange` (el shuffle) y el `HashAggregate`
  final.

</details>

**Rúbrica (6 puntos)**: encuentra la aplicación en 4040 o 18080 (1), explica
los jobs extra de `inferSchema` (2), identifica el shuffle como corte entre
stages (2), relaciona las tasks con las particiones (1).
