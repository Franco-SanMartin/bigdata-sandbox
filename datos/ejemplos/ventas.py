"""Ventas por producto, en Spark (PySpark).

Mismo calculo que ventas.pig (Pig), mapper.py/reducer.py (MapReduce) y
ventas.hql (Hive).

Uso (adentro del contenedor, parado en /datos):

    spark-submit ejemplos/ventas.py

Corre como aplicacion SPARK en YARN (http://localhost:8088) y al terminar
queda en el historial (http://localhost:18080).
"""
from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("ventas por producto").getOrCreate()

# 1. Leer el CSV directo de HDFS (todos los archivos de la carpeta)
ventas = spark.read.csv("hdfs:///user/root/ventas", header=True, inferSchema=True)
ventas.printSchema()

# 2. Mismo calculo, con la API de DataFrames
resumen = (
    ventas.withColumn("importe", F.col("cantidad").cast("long") * F.col("precio"))
    .groupBy("producto")
    .agg(F.sum("cantidad").alias("unidades"), F.sum("importe").alias("facturado"))
    .orderBy(F.desc("facturado"))
)
resumen.show()

# 3. Guardarlo en HDFS (pisa el de una corrida anterior)
resumen.write.mode("overwrite").csv("hdfs:///user/root/resultados/spark_por_producto", header=True)

# 4. Lo mismo en SQL, sobre la tabla de Hive (si ya corriste ventas.hql):
#    Spark y Hive comparten el metastore
if spark.catalog.tableExists("ventas"):
    spark.sql("""
        SELECT sucursal, COUNT(*) AS tickets, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
        FROM ventas GROUP BY sucursal ORDER BY facturado DESC
    """).show()

spark.stop()
