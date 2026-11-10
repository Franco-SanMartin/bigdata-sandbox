"""Generador a escala: un trabajo de Spark que escribe en HDFS un dataset sintético del tamaño que se elija, con
señal (reglas conocidas: se sabe qué tiene que aprender el modelo) y, si se pide, suciedad (nulos, duplicados,
extremos y texto desprolijo). Sirve para probar el estudio con millones de filas, no con un CSV chico.

    spark-submit --master yarn /opt/sandbox/ml/sandbox_ml/generar.py clientes --filas 10000000 \\
        --salida /user/root/ml/generado/clientes_10m --formato parquet --suciedad 0.05 --particiones 16

Datasets:

    clientes        las columnas y las reglas de clientes_senal.csv (ejemplos/ml/generar_senal.py):
                    segmento → visitas y ticket; gasto_mes_siguiente = 5000 + 1500·visitas + 0,8·ticket
                    − 1500·reclamos + 50·antigüedad + ruido; vuelve = (visitas ≥ 4 y reclamos ≤ 1) o
                    antigüedad ≥ 36, con el 10 % dado vuelta. Más una fecha de alta (anio, mes) para particionar.
    calificaciones  usuario, item y nota de 1 a 5 que sale de 2 factores escondidos de cada usuario y cada item
                    (lo que ALS tiene que descubrir), con la mitad de los pares sin calificar.

La suciedad (de 0 a 0,5, la fracción de filas tocadas por cada problema) en clientes: nulos en edad y ticket,
segmento con mayúsculas y espacios, tickets extremos (×50) y filas repetidas. En calificaciones: notas fuera de
rango y pares repetidos.

Todo sale de spark.range(n) con rand(semilla): cada executor genera su parte y nada pasa por el driver. Con la misma
semilla, los mismos datos. Imprime '@@resultado@@ {json}' con lo escrito.
"""
from __future__ import annotations

import argparse
import json
import re
import time

RESULTADO = "@@resultado@@ "
DATASETS = ("clientes", "calificaciones")
FORMATOS = ("parquet", "orc", "csv", "json")
MAX_FILAS = 5_000_000_000
RUTA = re.compile(r"^/[A-Za-z0-9_./=-]+$")


def validar(dataset: str, filas: int, salida: str, formato: str, suciedad: float, particiones: int | None) -> list[str]:
    """Los errores del pedido (vacío si está bien): el servidor lo usa antes de lanzar el trabajo."""
    e = []
    if dataset not in DATASETS:
        e.append(f"El dataset es {' o '.join(DATASETS)}")
    if not isinstance(filas, int) or isinstance(filas, bool) or not 1000 <= filas <= MAX_FILAS:
        e.append(f"Las filas van de 1.000 a {MAX_FILAS:,}".replace(",", "."))
    if not isinstance(salida, str) or not RUTA.match(salida) or ".." in salida or salida.rstrip("/") in ("", "/user", "/user/root"):
        e.append("La salida es una carpeta de HDFS, por ejemplo /user/root/ml/generado/clientes_1m")
    if formato not in FORMATOS:
        e.append(f"El formato es {', '.join(FORMATOS)}")
    if not isinstance(suciedad, (int, float)) or isinstance(suciedad, bool) or not 0 <= suciedad <= 0.5:
        e.append("La suciedad va de 0 a 0,5 (la fracción de filas con cada problema)")
    if particiones is not None and (not isinstance(particiones, int) or not 1 <= particiones <= 2000):
        e.append("Las particiones (archivos que escribe) van de 1 a 2000")
    return e


def clientes(spark, filas: int, semilla: int, suciedad: float):
    from pyspark.sql import functions as F
    r = lambda k: F.rand(semilla * 1000 + k)       # noqa: E731  (cada columna con su propia semilla)
    n = lambda k: F.randn(semilla * 1000 + k)      # noqa: E731
    # Los números al azar que se usan en un CASE WHEN van primero a una columna: adentro del CASE, rand() solo se
    # evalúa en las filas que llegan a esa rama, su secuencia se corre y las proporciones dejan de ser las pedidas
    df = (spark.range(filas).withColumnRenamed("id", "cliente_id")
          .withColumn("_u", r(1)).withColumn("_v", r(2)).withColumn("_p", r(5)))
    u = F.col("_u")
    df = df.withColumn("segmento_real", F.when(u < 0.6, "ocasional").when(u < 0.9, "frecuente").otherwise("mayorista"))
    v = F.col("_v")
    df = df.withColumn("visitas_mes", F.when(F.col("segmento_real") == "ocasional", 1 + F.floor(v * 3))
                       .when(F.col("segmento_real") == "frecuente", 4 + F.floor(v * 7))
                       .otherwise(1 + F.floor(v * 6)).cast("int"))
    medio = F.when(F.col("segmento_real") == "ocasional", 6000).when(F.col("segmento_real") == "frecuente", 9000).otherwise(60000)
    df = df.withColumn("ticket_promedio", F.round(medio * F.exp(n(3) * 0.3)))
    df = df.withColumn("antiguedad_meses", (1 + F.floor(r(4) * 60)).cast("int"))
    # Poisson(0,6) por inversión de la acumulada, tope 5
    p = F.col("_p")
    acum = [0.5488, 0.8781, 0.9769, 0.9966, 0.9996]
    rec = F.lit(5)
    for k in range(4, -1, -1):
        rec = F.when(p < acum[k], k).otherwise(rec)
    df = df.withColumn("reclamos", rec.cast("int"))
    df = df.withColumn("edad", (18 + F.floor(r(6) * 63)).cast("int"))
    gasto = (5000 + 1500 * F.col("visitas_mes") + 0.8 * F.col("ticket_promedio") - 1500 * F.col("reclamos")
             + 50 * F.col("antiguedad_meses") + n(7) * 2000)
    df = df.withColumn("gasto_mes_siguiente", F.round(F.greatest(gasto, F.lit(0.0))))
    regla = ((F.col("visitas_mes") >= 4) & (F.col("reclamos") <= 1)) | (F.col("antiguedad_meses") >= 36)
    vuelta = r(8) < 0.1
    df = df.withColumn("vuelve", F.when(regla != vuelta, 1).otherwise(0))
    # Fecha de alta: hace antiguedad_meses meses desde 2026-11 (para particionar por anio y mes)
    meses = 2026 * 12 + 10 - F.col("antiguedad_meses")
    df = df.withColumn("anio", F.floor(meses / 12).cast("int")).withColumn("mes", (meses % 12 + 1).cast("int"))
    if suciedad > 0:
        s = float(suciedad)
        df = (df.withColumn("_t", r(12)).withColumn("edad", F.when(r(11) < s, None).otherwise(F.col("edad")))
              .withColumn("ticket_promedio", F.when(F.col("_t") < s / 2, None)
                          .when(F.col("_t") > 1 - s / 5, F.col("ticket_promedio") * 50).otherwise(F.col("ticket_promedio")))
              .withColumn("segmento_real", F.when(r(14) < s, F.concat(F.lit("  "), F.upper(F.col("segmento_real")), F.lit(" ")))
                          .otherwise(F.col("segmento_real"))))
        df = df.unionByName(df.where(r(15) < s / 5))      # filas repetidas tal cual
    return df.select("cliente_id", "antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad", "segmento_real",
                     "gasto_mes_siguiente", "vuelve", "anio", "mes")


def calificaciones(spark, filas: int, semilla: int, suciedad: float):
    """Una grilla de usuarios × items con la mitad calificada: nota = 1 + 4·(u1·i1 + u2·i2)/2 + ruido."""
    from pyspark.sql import functions as F
    items = max(20, min(5000, int((filas * 2) ** 0.5 / 4)))
    usuarios = max(20, (filas * 2) // items)
    u = spark.range(usuarios).withColumnRenamed("id", "usuario") \
        .withColumn("u1", F.rand(semilla + 1)).withColumn("u2", F.rand(semilla + 2))
    i = spark.range(items).withColumnRenamed("id", "item") \
        .withColumn("i1", F.rand(semilla + 3)).withColumn("i2", F.rand(semilla + 4))
    df = u.crossJoin(F.broadcast(i)).where(F.rand(semilla + 5) < 0.5)
    nota = 1 + 4 * (F.col("u1") * F.col("i1") + F.col("u2") * F.col("i2")) / 2 + F.randn(semilla + 6) * 0.2
    df = df.withColumn("nota", F.round(F.least(F.lit(5.0), F.greatest(F.lit(1.0), nota)), 1))
    if suciedad > 0:
        df = df.withColumn("nota", F.when(F.rand(semilla + 7) < suciedad / 5, F.col("nota") * 10).otherwise(F.col("nota")))
        df = df.unionByName(df.where(F.rand(semilla + 8) < suciedad / 5))
    return df.select("usuario", "item", "nota").limit(filas)


def main(argv: list[str] | None = None) -> None:
    from pyspark.sql import SparkSession
    a = argparse.ArgumentParser(description="Dataset sintético con señal (y suciedad) escrito en HDFS por Spark")
    a.add_argument("dataset", choices=DATASETS)
    a.add_argument("--filas", type=int, default=1_000_000)
    a.add_argument("--salida", required=True)
    a.add_argument("--formato", choices=FORMATOS, default="parquet")
    a.add_argument("--suciedad", type=float, default=0.0)
    a.add_argument("--particiones", type=int, default=None, help="cuántos archivos escribe (por defecto, según las filas)")
    a.add_argument("--particionar", action="store_true", help="clientes: carpetas anio=/mes=")
    a.add_argument("--semilla", type=int, default=42)
    o = a.parse_args(argv)
    errores = validar(o.dataset, o.filas, o.salida, o.formato, o.suciedad, o.particiones)
    if errores:
        print("@@error@@ " + json.dumps({"mensaje": "; ".join(errores)}, ensure_ascii=False), flush=True)
        raise SystemExit(2)
    t0 = time.perf_counter()
    spark = SparkSession.builder.appName(f"estudio-ml: generar {o.dataset} ({o.filas:,} filas)").getOrCreate()
    print("Aplicación de YARN:", spark.sparkContext.applicationId, flush=True)
    print("[ 10%] Generando en los executors", flush=True)
    df = (clientes if o.dataset == "clientes" else calificaciones)(spark, o.filas, o.semilla, o.suciedad)
    partes = o.particiones or max(1, min(2000, o.filas // 2_000_000 + 1))
    df = df.repartition(partes)
    print(f"[ 40%] Escribiendo {o.formato} en {o.salida} ({partes} archivos)", flush=True)
    w = df.write.mode("overwrite").format(o.formato)
    if o.formato == "csv":
        w = w.option("header", True)
    if o.particionar and o.dataset == "clientes":
        w = w.partitionBy("anio", "mes")
    w.save(o.salida)
    print("[ 85%] Contando lo escrito", flush=True)
    lector = spark.read.option("header", True).option("inferSchema", True) if o.formato == "csv" else spark.read
    escrito = lector.format(o.formato).load(o.salida)
    filas = escrito.count()
    jvm = spark._jvm
    fs = jvm.org.apache.hadoop.fs.FileSystem.get(spark._jsc.hadoopConfiguration())
    resumen = fs.getContentSummary(jvm.org.apache.hadoop.fs.Path(o.salida))
    res = {"dataset": o.dataset, "salida": o.salida, "formato": o.formato, "filas": filas, "pedidas": o.filas,
           "suciedad": o.suciedad, "archivos": int(resumen.getFileCount()), "bytes": int(resumen.getLength()),
           "columnas": escrito.columns, "particionado": bool(o.particionar and o.dataset == "clientes"),
           "segundos": round(time.perf_counter() - t0, 1), "app_id": spark.sparkContext.applicationId,
           "muestra": [[v if isinstance(v, (int, float, str, bool)) or v is None else str(v) for v in f]
                       for f in escrito.limit(10).collect()]}
    print(f"{filas:,} filas en hdfs://{o.salida} ({res['bytes'] / 1e6:,.1f} MB en {res['archivos']} archivos, {res['segundos']} s)",
          flush=True)
    print(RESULTADO + json.dumps(res, ensure_ascii=False), flush=True)
    spark.stop()
    print("[100%] Listo", flush=True)


if __name__ == "__main__":
    main()
