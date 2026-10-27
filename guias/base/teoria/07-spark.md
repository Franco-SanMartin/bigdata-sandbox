# 7. Spark

Un motor de procesamiento distribuido que planifica el trabajo entero antes
de correrlo y guarda en **memoria** lo intermedio. Resuelve lo que MapReduce
hacía mal (cálculos de muchas etapas e iterativos) con una sola API para
batch, SQL, *machine learning* y streaming.

[← 6. Sqoop](06-sqoop.md) · [Teoría](README.md) · Siguiente: [8. ZooKeeper y HA →](08-zookeeper-ha.md)

## Por qué existe

MapReduce escribe en disco al final de cada etapa. Un algoritmo de *machine
learning* que recorre los mismos datos 20 veces son 20 trabajos que leen y
escriben HDFS. Spark (Universidad de Berkeley, 2009; Apache desde 2013) propuso
mantener los datos **en memoria** entre etapas y planificar el cálculo
completo como un grafo. Para cálculos iterativos, la diferencia es de un orden
de magnitud o más.

## Conceptos

| Concepto | Qué es |
|---|---|
| **Aplicación** | Un programa de Spark (un `spark-submit` o una consola `pyspark`), con su `SparkSession` |
| **Driver** | El proceso de tu programa: arma el plan, lo divide en tareas y las reparte. Con `deployMode client` (el de la imagen) corre en tu consola |
| **Executor** | Proceso trabajador, en un contenedor de YARN: corre tareas y guarda datos en memoria. Acá, 2 executors de 1 core y 512 MB |
| **Cluster manager** | Quien le da los executors: YARN (acá), Kubernetes o el propio de Spark (*standalone*) |
| **DataFrame** | Una tabla distribuida, con columnas con nombre y tipo, repartida en **particiones** entre los executors |
| **RDD** | La abstracción original de Spark: una colección distribuida e inmutable de objetos, sin esquema. Los DataFrames están construidos encima |
| **Partición** | Un pedazo de los datos; cada una la procesa una tarea |
| **Transformación** | Operación que define un DataFrame nuevo a partir de otro (`filter`, `select`, `groupBy`, `join`). No ejecuta nada |
| **Acción** | Operación que pide un resultado (`show`, `count`, `collect`, `write`). Dispara la ejecución |
| **Job / stage / task** | Cada acción es un **job**; el job se corta en **stages** donde hay un shuffle; cada stage son **tasks**, una por partición |
| **Shuffle** | Redistribuir los datos entre executors por clave (para un `groupBy` o un `join`) |
| **Linaje** (*lineage*) | La receta de cómo se calculó cada partición, que permite recalcularla si se pierde |

## Evaluación diferida y el plan

Las transformaciones solo **anotan** lo que hay que hacer. Recién con una
acción, Spark mira la receta completa, la optimiza y la ejecuta:

```text
  ventas = spark.read.csv(...)                 nada se lee todavía
  yerba  = ventas.filter(producto == "yerba")  nada
  res    = yerba.groupBy("sucursal").agg(...)  nada
  res.show()                                   ACCIÓN: ahora sí

        plan lógico  ->  optimizador Catalyst  ->  plan físico  ->  DAG de stages
        (lo que escribiste)  (empuja el filtro a la lectura,     (tareas por partición)
                              lee solo las columnas que usa,
                              elige cómo hacer cada JOIN)
```

Ventaja de esperar: el optimizador ve el cálculo entero. Por ejemplo, si al
final solo se usan `sucursal`, `producto`, `cantidad` y `precio`, no hace
falta cargar `fecha`, y el filtro de yerba se aplica mientras se lee, antes
de mandar nada por la red. Es la misma idea que el plan de Pig, pero con un
optimizador mucho más potente.

## Cómo corre en YARN

```text
  spark-submit ventas.py          (deployMode client)
     |
  [driver, en tu consola]  --- pide una aplicación --->  ResourceManager
     |                                                        |
     |                                  contenedor para el ApplicationMaster de Spark
     |                                  (en modo client solo pide executors)
     |                                                        |
     |<------ se registran -------  [executor 1]   [executor 2]   (contenedores de YARN)
     |
     |  el driver manda tareas a los executors; cada tarea procesa una partición
     |  y deja los datos del shuffle para la etapa siguiente
     v
  resultado: en la consola (show) o en HDFS (write)
```

- Un job con un `groupBy` tiene dos stages: el primero lee y hace la suma
  parcial en cada partición (como el combiner de MapReduce); el segundo, después
  del shuffle, junta las sumas de cada clave. Las particiones después del
  shuffle las fija `spark.sql.shuffle.partitions`: 200 de fábrica, 4 en esta
  imagen (200 tareas para 8 productos sería puro costo). Además, la ejecución
  adaptativa de Spark 3 puede juntar particiones que quedaron chicas.
- El driver es un punto delicado: si un programa hace `collect()` de un
  DataFrame grande, trae **todo** a la memoria del driver (acá, 512 MB) y se
  cae. Para mirar, `show(n)` o `limit`.
- `spark.yarn.archive` evita subir los jars de Spark en cada aplicación: ya
  están en HDFS, en `/apps/spark/spark-libs.jar`.

## Memoria, caché y tolerancia a fallas

- Spark mantiene en memoria lo que hace falta entre etapas y, si se le pide
  (`df.cache()`), un DataFrame que se va a usar varias veces. Si no entra,
  lo vuelca a disco: "en memoria" es una preferencia, no un requisito.
- No replica los datos intermedios como HDFS. Si se pierde un executor, usa
  el **linaje** para **recalcular** solo las particiones perdidas, desde la
  fuente o desde el último shuffle guardado.

## Spark y Hive

Con `catalogImplementation=hive`, Spark usa el **metastore de Hive** como
catálogo: `spark.sql("SELECT ... FROM ventas")` lee la tabla externa que creó
Hive, y `df.write.saveAsTable(...)` crea una tabla que Hive también ve. Lo que
se comparte es el **catálogo** y los **archivos**, no el motor: la consulta la
ejecuta Spark con sus executors, no Tez.

## Ventajas y limitaciones

**Ventajas**

- Mucho más rápido que MapReduce en cálculos de varias etapas o iterativos.
- Una sola API para batch, SQL (Spark SQL), *machine learning* (MLlib),
  grafos y streaming (Structured Streaming), en Python, Scala, Java, R y SQL.
- Optimizador de consultas (Catalyst) y ejecución adaptativa.
- Corre en YARN, Kubernetes o en la nube, y lee HDFS, S3, JDBC, Hive,
  Parquet, ORC, JSON...

**Limitaciones**

- Consume mucha memoria: en esta imagen hay que achicar todo (512 MB por
  proceso) para que entre en una notebook.
- Muchos parámetros de rendimiento (memoria, particiones, shuffle) que hay que
  entender para usarlo bien a escala.
- Arrancar una aplicación tarda segundos (pedir contenedores): no es una base
  de datos para consultas puntuales.
- Su streaming trabaja en micro-lotes de fábrica. Para latencias de
  milisegundos, Flink.
- Para datos que entran en una máquina (unos GB), pandas, Polars o DuckDB
  son más simples y suelen ser más rápidos.

## En la guía 8 lo ves cuando...

- **[Cómo corre](../../08-spark.md#cómo-corre)**: mientras un programa
  corre, http://localhost:4040 muestra sus *jobs*, *stages* y *tasks*. En
  http://localhost:8088 aparece como `SPARK`; terminado, queda en el History
  Server (http://localhost:18080).
- **[Ventas por producto](../../08-spark.md#ventas-por-producto)**: el mismo
  resultado de MapReduce, Pig y Hive con `groupBy().agg()`.
- **[Tu propio programa](../../08-spark.md#tu-propio-programa)**: `filter`,
  `withColumn` y `groupBy` no hacen nada hasta el `show()`, y `count()` es
  otra acción, otro job. `spark.stop()` devuelve los contenedores a YARN.
- **[SQL sobre las tablas de Hive](../../08-spark.md#sql-sobre-las-tablas-de-hive)**:
  `spark.sql` sobre la tabla `ventas` de la guía 6, por el metastore
  compartido.
- **[La consola: pyspark](../../08-spark.md#la-consola-pyspark)**: una
  consola abierta retiene sus executors; otro trabajo puede quedar en
  `ACCEPTED`.

Para repasar: [evaluación de Spark](../evaluacion/07-spark.md). Comandos y
configuración: [referencia de Spark](../referencia.md#spark).
