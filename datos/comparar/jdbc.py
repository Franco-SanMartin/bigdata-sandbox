"""Traer la tabla ventas de MariaDB a HDFS con Spark, por JDBC: lo mismo que
el `sqoop import` de sqoop.sh, pero como parte de un programa que despues
puede seguir procesando.

Uso (adentro del contenedor, parado en /datos):

    spark-submit --jars /opt/sqoop/lib/mysql-connector-java-5.1.49.jar \
        ejemplos/comparar/jdbc.py

Spark lee la tabla en 4 pedazos en paralelo (partitionColumn = id), como
`sqoop import -m 4`. El driver de MariaDB (el de MySQL) es el mismo jar que
usa Sqoop.
"""
from pyspark.sql import SparkSession

spark = SparkSession.builder.appName("ventas desde MariaDB").getOrCreate()

# 1. Leer la tabla en 4 pedazos, repartidos por id
ventas = (
    spark.read.format("jdbc")
    .option("url", "jdbc:mysql://localhost/tienda")
    .option("driver", "com.mysql.jdbc.Driver")
    .option("dbtable", "ventas")
    .option("user", "alumno")
    .option("password", "alumno")
    .option("partitionColumn", "id")
    .option("lowerBound", 1)
    .option("upperBound", 200000)
    .option("numPartitions", 4)
    .load()
)
print(f"{ventas.count()} filas, en {ventas.rdd.getNumPartitions()} pedazos")
ventas.show(5)

# 2. Guardarla en HDFS, en texto separado por comas como la deja Sqoop
ventas.write.mode("overwrite").csv("hdfs:///user/root/tienda/ventas_spark")

spark.stop()
