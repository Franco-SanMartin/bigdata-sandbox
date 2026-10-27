# 8. Spark

Procesamiento en memoria, con Python (PySpark). Corre sobre YARN como un
trabajo más, lee de HDFS y usa las mismas tablas que Hive.

[← 7. MySQL y Sqoop](07-mysql-sqoop.md) · [Índice](README.md) · Siguiente: [9. ZooKeeper y alta disponibilidad →](09-zookeeper-ha.md)

Todo va **adentro** del contenedor, parado en `/datos`, con `SERVICIOS=todo`
(el valor por defecto). Hace falta haber subido las ventas
([guía 3](03-hdfs.md#un-dataset-de-verdad-200000-ventas)) y, para la parte de
SQL, haber creado la tabla `ventas` en Hive ([guía 6](06-hive.md)).

## Cómo corre

- Un programa de Spark tiene un **driver** (tu programa) y **executors** (los
  que procesan los datos, en contenedores de YARN).
- Los datos se leen en un **DataFrame**: una tabla repartida entre los
  executors. Las transformaciones (`filter`, `groupBy`...) no hacen nada hasta
  una **acción** (`show`, `count`, `write`): ahí Spark arma el plan y lo
  ejecuta, guardando en memoria lo intermedio.
- Mientras corre: http://localhost:4040 (sus *jobs*, *stages* y *tasks*).
  Terminado: http://localhost:18080. En http://localhost:8088 aparece como
  `SPARK`.

## Ventas por producto

`ejemplos/ventas.py` hace el mismo cálculo de las guías 4 a 6 con DataFrames,
lo guarda en `/user/root/resultados/spark_por_producto` y, si existe la tabla
`ventas` de Hive, agrega las ventas por sucursal con SQL:

<!-- prueba: adentro | espera: 448780000 | espera: 179512 -->
```bash
spark-submit ejemplos/ventas.py
```

Entre los logs aparece la tabla:

```text
+----------+--------+---------+
|  producto|unidades|facturado|
+----------+--------+---------+
|     yerba|  179512|448780000|
|     termo|   11793|412755000|
|      mate|   48154|385232000|
...
```

Los mismos números que con MapReduce, Pig y Hive.

## Tu propio programa

Un programa de PySpark es un archivo `.py`. Guardá esto como
`datos/mi_spark.py` en tu compu y corrélo adentro con `spark-submit
mi_spark.py`:

<!-- prueba: adentro < spark-submit {} | espera: filas: 200000 | espera: Centro -->
```python
from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("mi prueba").getOrCreate()

ventas = spark.read.csv("hdfs:///user/root/ventas", header=True, inferSchema=True)
print("filas:", ventas.count())

# Ticket promedio por sucursal, solo las ventas de yerba
(ventas.filter(F.col("producto") == "yerba")
       .withColumn("importe", F.col("cantidad") * F.col("precio"))
       .groupBy("sucursal")
       .agg(F.count("*").alias("tickets"), F.round(F.avg("importe"), 0).alias("promedio"))
       .orderBy("sucursal")
       .show())

spark.stop()
```

`spark.stop()` al final libera la memoria de YARN para el próximo trabajo.

## SQL sobre las tablas de Hive

Spark y Hive comparten el metastore: la tabla `ventas` que creó Hive en la
guía 6 se consulta igual desde Spark, y lo que se cree en Spark se ve en Hive.

<!-- prueba: adentro < spark-submit {} | espera: ventas | espera: 448780000 -->
```python
from pyspark.sql import SparkSession

spark = SparkSession.builder.appName("sql sobre hive").getOrCreate()

spark.sql("SHOW TABLES").show()
spark.sql("""
    SELECT producto, SUM(cantidad) AS unidades, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
    FROM ventas
    GROUP BY producto
    ORDER BY facturado DESC
""").show()

spark.stop()
```

## La consola: pyspark

Para probar de a una línea:

<!-- prueba: no (abre una consola interactiva) -->
```bash
pyspark
```

Tarda unos segundos (pide lugar en YARN) y queda el prompt `>>>`, con la
variable `spark` ya creada: ahí se escriben las líneas del programa de arriba
(sin el `builder` ni el `stop`). Se sale con `exit()`. Mientras está abierta
ocupa memoria en YARN: si un trabajo queda en `ACCEPTED` sin avanzar, cerrá
las consolas de `pyspark` que no uses.

## Lo más usado

| Código | Qué hace |
|---|---|
| `spark.read.csv(ruta, header=True, inferSchema=True)` | Lee un CSV (o una carpeta) de HDFS |
| `df.show(n)`, `df.count()`, `df.printSchema()` | Mirar |
| `df.filter(F.col("x") > 3)` | Filtrar |
| `df.select("a", "b")`, `df.withColumn("c", expr)` | Elegir o calcular columnas |
| `df.groupBy("a").agg(F.sum("b"), F.avg("c"))` | Agrupar y resumir |
| `df.orderBy(F.desc("x"))` | Ordenar |
| `df.join(otro, "clave")` | Unir |
| `spark.sql("SELECT ...")` | SQL sobre las tablas de Hive |
| `df.write.mode("overwrite").csv(ruta, header=True)` | Guardar en HDFS |
| `df.write.saveAsTable("nombre")` | Guardar como tabla (se ve en Hive) |

## Para profundizar

- Teoría: [Spark](base/teoria/07-spark.md): el porqué y cómo funciona por dentro.
- Evaluación: [Spark](base/evaluacion/07-spark.md): preguntas y ejercicios con sus respuestas.
- Referencia: [Spark](base/referencia.md#spark): comandos, opciones y puertos.
