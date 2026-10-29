"""Deja en HDFS los datos de ejemplo de la etapa (b) del estudio (formatos, comprimidos y particiones).

    spark-submit --master local[2] /opt/sandbox/ml/preparar_demo_hdfs.py      # adentro del contenedor

Lee /datos/ventas_sucias.csv y /datos/clientes_senal.csv (POST /api/ml/sources/example los genera) y escribe:

    /user/root/ml/crudo/ventas_sucias.csv.gz     el CSV sucio, comprimido con gzip (un archivo)
    /user/root/ml/ventas/anio=2026/mes=1..6/     las mismas ventas en Parquet (snappy), particionadas por la
                                                 fecha (que viene en tres formatos: se lee con los tres)
    /user/root/ml/clientes_orc/                  clientes_senal en ORC
    /user/root/ml/clientes_json/                 clientes_senal en JSON lines comprimido con bz2
    /user/root/ml/clientes_avro/                 clientes_senal en Avro (con el módulo spark-avro)

Lo usan ui/scripts/estudio_demo.py (para la demo) y el humo de full (server/tests/humo/humo_full.py).
"""
import gzip
import shutil
import subprocess
import tempfile
from pathlib import Path

from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("estudio-ml: datos de ejemplo en HDFS").getOrCreate()
spark.sparkContext.setLogLevel("WARN")

subprocess.run(["hdfs", "dfs", "-mkdir", "-p", "/user/root/ml/crudo"], check=True)
with tempfile.TemporaryDirectory() as tmp:
    gz = Path(tmp) / "ventas_sucias.csv.gz"
    with open("/datos/ventas_sucias.csv", "rb") as f, gzip.open(gz, "wb") as g:
        shutil.copyfileobj(f, g)
    subprocess.run(["hdfs", "dfs", "-put", "-f", str(gz), "/user/root/ml/crudo/ventas_sucias.csv.gz"], check=True)

ventas = spark.read.csv("file:///datos/ventas_sucias.csv", header=True, inferSchema=False)
fecha = F.coalesce(F.to_date("fecha", "yyyyMMdd"), F.to_date("fecha", "dd/MM/yyyy"), F.to_date("fecha", "yyyy-MM-dd"))
(ventas.withColumn("anio", F.year(fecha)).withColumn("mes", F.month(fecha)).where("anio IS NOT NULL")
 .repartition("anio", "mes").write.mode("overwrite").partitionBy("anio", "mes").parquet("/user/root/ml/ventas"))

clientes = spark.read.csv("file:///datos/clientes_senal.csv", header=True, inferSchema=True)
clientes.coalesce(2).write.mode("overwrite").orc("/user/root/ml/clientes_orc")
clientes.coalesce(2).write.mode("overwrite").option("compression", "bzip2").json("/user/root/ml/clientes_json")
clientes.coalesce(2).write.mode("overwrite").format("avro").save("/user/root/ml/clientes_avro")
print("listo:", spark.read.parquet("/user/root/ml/ventas").count(), "ventas particionadas")
spark.stop()
