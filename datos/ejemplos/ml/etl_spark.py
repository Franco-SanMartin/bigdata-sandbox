"""El MISMO ETL de etl_pandas.py, en Spark (PySpark): para comparar.

Hace los mismos pasos, en el mismo orden, y al final imprime el mismo
resumen: tienen que dar igual numero por numero.

Uso (adentro del contenedor, parado en /datos):

    python3 ejemplos/ml/generar_sucios.py      # una vez: crea ventas_sucias.csv
    hdfs dfs -mkdir -p /user/root/ml
    hdfs dfs -put -f ventas_sucias.csv /user/root/ml/
    spark-submit ejemplos/ml/etl_spark.py      # -> /user/root/ml/ventas_limpias (Parquet en HDFS)

Lo que cambia respecto de pandas, y conviene mirar:
  - Los datos no estan en la memoria de una compu: estan repartidos en
    particiones, que procesan varios executors (en un cluster real, en
    distintas maquinas). Por eso no hay "fila 0" ni un orden, salvo que se pida.
  - Nada se modifica: cada paso devuelve un DataFrame nuevo.
  - Spark es "perezoso" (lazy): cada paso solo agrega instrucciones a un plan.
    Se calcula recien cuando se pide un resultado (count, show, write). Cada
    count() de este script es un "job": se ven todos en http://localhost:4040
    mientras corre, o despues en http://localhost:18080.
  - Con 100.000 filas pandas es mas rapido (no tiene que repartir nada). Spark
    gana cuando los datos no entran en una sola compu.
"""
import sys
import time

from pyspark.sql import SparkSession, functions as F

entrada = sys.argv[1] if len(sys.argv) > 1 else "hdfs:///user/root/ml/ventas_sucias.csv"
salida = sys.argv[2] if len(sys.argv) > 2 else "hdfs:///user/root/ml/ventas_limpias"

spark = SparkSession.builder.appName("ETL ventas sucias").getOrCreate()
inicio = time.perf_counter()
cuenta = {}   # cuantas filas toco cada paso, para el resumen del final

# ---------------------------------------------------------------------------
# 1. EXTRAER: todo como texto (sin inferSchema, lo mismo que dtype=str en
#    pandas). Las celdas vacias quedan como null.
# ---------------------------------------------------------------------------
ventas = spark.read.csv(entrada, header=True)
cuenta["filas leidas"] = ventas.count()
print(f"Leidas {cuenta['filas leidas']} filas, en {ventas.rdd.getNumPartitions()} particion(es). Asi vienen:")
ventas.show(8, truncate=False)

# ---------------------------------------------------------------------------
# 2. DUPLICADOS: el mismo ticket cargado dos veces. Se queda uno.
# ---------------------------------------------------------------------------
ventas = ventas.dropDuplicates(["ticket"])
cuenta["duplicados eliminados"] = cuenta["filas leidas"] - ventas.count()

# ---------------------------------------------------------------------------
# 3. TEXTO: sin espacios de mas, en minusculas y sin tildes
# ---------------------------------------------------------------------------
for columna in ["sucursal", "producto", "medio_pago"]:
    ventas = ventas.withColumn(columna, F.translate(F.lower(F.trim(columna)), "áéíóú", "aeiou"))

# ---------------------------------------------------------------------------
# 4. FECHAS: detectar el formato con una expresion regular y convertir cada
#    una con el suyo (F.when es el "if" de Spark: CASE WHEN en SQL)
# ---------------------------------------------------------------------------
f = F.col("fecha")
iso = f.rlike(r"^\d{4}-\d{2}-\d{2}$")        # 2026-03-05
argentina = f.rlike(r"^\d{2}/\d{2}/\d{4}$")  # 05/03/2026
junta = f.rlike(r"^\d{8}$")                  # 20260305
formatos = ventas.agg(F.sum(argentina.cast("int")).alias("argentina"),
                      F.sum(junta.cast("int")).alias("junta")).first()
cuenta["fechas en formato dia/mes/año"] = formatos["argentina"]
cuenta["fechas en formato todo junto"] = formatos["junta"]
ventas = ventas.withColumn("fecha", F.when(iso, F.to_date(f, "yyyy-MM-dd"))
                                     .when(argentina, F.to_date(f, "dd/MM/yyyy"))
                                     .when(junta, F.to_date(f, "yyyyMMdd")))
cuenta["fechas que no se entienden (fuera)"] = ventas.filter(F.col("fecha").isNull()).count()
ventas = ventas.filter(F.col("fecha").isNotNull())

# ---------------------------------------------------------------------------
# 5. NUMEROS: "2.575,00" -> sin el punto, la coma pasa a punto -> numero
# ---------------------------------------------------------------------------
p = F.trim("precio")
con_coma = p.contains(",")
cuenta["precios con formato 2.575,00"] = ventas.filter(con_coma).count()
ventas = ventas.withColumn(
    "precio",
    F.when(con_coma, F.regexp_replace(F.regexp_replace(p, r"\.", ""), ",", ".")).otherwise(p).cast("double"))
ventas = ventas.withColumn("cantidad", F.col("cantidad").cast("int"))

# ---------------------------------------------------------------------------
# 6. NULOS: sin cantidad -> fuera; sin medio de pago -> "desconocido"
# ---------------------------------------------------------------------------
cuenta["sin cantidad (fuera)"] = ventas.filter(F.col("cantidad").isNull()).count()
ventas = ventas.filter(F.col("cantidad").isNotNull())
cuenta["sin medio de pago (-> desconocido)"] = ventas.filter(F.col("medio_pago").isNull()).count()
ventas = ventas.fillna({"medio_pago": "desconocido"})

# ---------------------------------------------------------------------------
# 7. OUTLIERS: lo que marcaria el IQR (approxQuantile con error 0 = exacto)
#    y despues la regla del negocio (1 a 20 unidades por ticket)
# ---------------------------------------------------------------------------
q1, q3 = ventas.approxQuantile("cantidad", [0.25, 0.75], 0)
iqr = q3 - q1
desde, hasta = q1 - 1.5 * iqr, q3 + 1.5 * iqr
marca = ventas.filter((F.col("cantidad") < desde) | (F.col("cantidad") > hasta)).count()
print(f"\nMetodo IQR sobre cantidad: rango aceptado {desde:g} a {hasta:g}, marca {marca} filas")
fuera = (F.col("cantidad") < 1) | (F.col("cantidad") > 20)
cuenta["cantidad imposible (fuera)"] = ventas.filter(fuera).count()
ventas = ventas.filter(~fuera)

# Precios: la mediana de cada producto, en una tabla chica que se junta (JOIN)
# con las ventas. Mas de 10 veces la mediana = precio sin la coma: /100
medianas = ventas.groupBy("producto").agg(F.median("precio").alias("mediana"))
ventas = ventas.join(medianas, "producto")
locos = F.col("precio") > 10 * F.col("mediana")
cuenta["precio sin la coma (/100)"] = ventas.filter(locos).count()
ventas = ventas.withColumn("precio", F.when(locos, F.col("precio") / 100).otherwise(F.col("precio")))
cuenta["sin precio (-> mediana del producto)"] = ventas.filter(F.col("precio").isNull()).count()
ventas = ventas.withColumn("precio", F.coalesce("precio", F.floor("mediana")).cast("long"))

# ---------------------------------------------------------------------------
# 8. CARGAR: columnas finales a Parquet, en HDFS (una carpeta con un archivo
#    por particion, como siempre en Hadoop)
# ---------------------------------------------------------------------------
ventas = (ventas.withColumn("ticket", F.col("ticket").cast("long"))
                .withColumn("importe", F.col("cantidad") * F.col("precio"))
                .select("ticket", "fecha", "sucursal", "producto", "cantidad", "precio",
                        "importe", "medio_pago"))
ventas.write.mode("overwrite").parquet(salida)

# De aca en mas se lee lo ya guardado (no se repite todo el plan)
limpias = spark.read.parquet(salida)
cuenta["filas limpias"] = limpias.count()
print("\nAsi quedan:")
limpias.orderBy("ticket").show(8, truncate=False)
limpias.printSchema()

# ---------------------------------------------------------------------------
# Resumen (el mismo de etl_pandas.py)
# ---------------------------------------------------------------------------
print("\n=== RESUMEN DEL ETL ===")
for paso, n in cuenta.items():
    print(f"  {paso:<40} {n:>9}")
print(f"  {'facturado total':<40} {limpias.agg(F.sum('importe')).first()[0]:>15}")
print("=== POR SUCURSAL ===")
por_sucursal = (limpias.groupBy("sucursal")
                .agg(F.count("*").alias("filas"), F.sum("importe").alias("facturado"))
                .orderBy("sucursal"))
for fila in por_sucursal.collect():
    print(f"  {fila['sucursal']:<10} {fila['filas']:>9} {fila['facturado']:>15}")
print(f"\nGuardado en {salida} ({time.perf_counter() - inicio:.1f} s en total)")

spark.stop()
