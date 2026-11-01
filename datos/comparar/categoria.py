"""Facturacion por categoria, en Spark (PySpark): un JOIN de las ventas con los
productos. La misma cuenta que el JOIN de tienda.hql (Hive) y que
categoria.pig (Pig), sobre las tablas que trajo Sqoop desde MariaDB.

Uso (adentro del contenedor, parado en /datos), despues de traer la base:

    bash ejemplos/sqoop.sh                    # o la etapa 1 del Pipeline
    spark-submit ejemplos/comparar/categoria.py

La tabla de productos es chica (8 filas): Spark la manda entera a cada
executor (un "broadcast join") y las ventas no viajan por el shuffle para
unirse. Se ve en el plan (explain) como BroadcastHashJoin.
"""
from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("ventas por categoria").getOrCreate()

# 1. Las dos tablas, como las dejo Sqoop (texto separado por comas, sin encabezado)
ventas = spark.read.csv("hdfs:///user/root/tienda/ventas", inferSchema=True) \
    .toDF("id", "fecha", "sucursal", "producto", "cantidad", "precio")
productos = spark.read.csv("hdfs:///user/root/tienda/productos", inferSchema=True) \
    .toDF("producto", "categoria", "precio_lista")

# 2. Unirlas por producto, agrupar por categoria y sumar
resumen = (
    ventas.join(productos, "producto")
    .groupBy("categoria")
    .agg(F.sum("cantidad").alias("unidades"),
         F.sum(F.col("cantidad").cast("long") * F.col("precio")).alias("facturado"))
    .orderBy(F.desc("facturado"))
)

resumen.explain()
resumen.show()

# 3. Guardar en HDFS (overwrite: si ya existia de una corrida anterior, se pisa)
resumen.write.mode("overwrite").csv("hdfs:///user/root/resultados/spark_por_categoria")

spark.stop()
