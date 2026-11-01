import{b as v,j as e,au as H,E,aY as G,A as Y,e as Q}from"./ui-CIKop561.js";import{u as V,g as X,n as b,w as P,s as T,i as N,A as J,t as I}from"./index-Cnn2s0Kr.js";import{C as k,a as $}from"./Comando-DHBEt9NM.js";import{P as K}from"./PageHeader-Di6iC9vP.js";import{G as W}from"./Gated-B7nwdYg8.js";import{E as U}from"./Trace-BZ4tbc5u.js";import{c as R,R as F,C as x}from"./ecosistema-VCggkRQG.js";import{a as h,l as Z,v as ee,c as ae,u as ne,V as A,e as C,o as se,f as oe,s as re,D as O,M as _,b as L}from"./comparar-C0Q4rp1P.js";import"./graficos-U6iFCXIg.js";import"./HelpTip-CXFzHfIx.js";import"./capabilities-D6kFB0We.js";const te=`-- Lo que trajo Sqoop desde MySQL, consultado en Hive.
-- Lo corre ejemplos/sqoop.sh despues de importar; a mano:
--   beeline -u jdbc:hive2://localhost:10000 -f ejemplos/tienda.hql
--
-- Sqoop dejo cada tabla como archivos de texto separados por comas en
-- /user/root/tienda/<tabla>. Las tablas EXTERNAS de Hive las leen en su lugar.

CREATE EXTERNAL TABLE IF NOT EXISTS tienda_ventas (
  id       INT,
  fecha    STRING,
  sucursal STRING,
  producto STRING,
  cantidad INT,
  precio   INT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '/user/root/tienda/ventas';

CREATE EXTERNAL TABLE IF NOT EXISTS tienda_productos (
  producto  STRING,
  categoria STRING,
  precio    INT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '/user/root/tienda/productos';

-- JOIN entre las dos tablas importadas: facturacion por categoria
SELECT p.categoria,
       SUM(v.cantidad)                           AS unidades,
       SUM(CAST(v.cantidad AS BIGINT) * v.precio) AS facturado
FROM tienda_ventas v
JOIN tienda_productos p ON v.producto = p.producto
GROUP BY p.categoria
ORDER BY facturado DESC;

-- El mismo resultado, a archivo en HDFS: es lo que 'sqoop export' devuelve a MySQL
INSERT OVERWRITE DIRECTORY '/user/root/resultados/hive_por_categoria'
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
SELECT p.categoria,
       SUM(v.cantidad)                           AS unidades,
       SUM(CAST(v.cantidad AS BIGINT) * v.precio) AS facturado
FROM tienda_ventas v
JOIN tienda_productos p ON v.producto = p.producto
GROUP BY p.categoria;
`,ie=`#!/usr/bin/env bash
# Sqoop de punta a punta: MySQL -> HDFS -> Hive -> MySQL.
#
# Uso (adentro del contenedor, parado en /datos):
#   bash ejemplos/sqoop.sh
# o copiar los comandos de a uno, para ver que hace cada paso.
#
# La base de ejemplo es "tienda" (ejemplos/tienda.sql), en el MySQL que corre
# adentro del contenedor. Usuario alumno, clave alumno.
#
# Sqoop no es un servicio: cada import/export es un trabajo MapReduce que solo
# tiene mappers (http://localhost:8088). Antes de copiar una tabla genera una
# clase Java para leerla (queda un <tabla>.java en la carpeta: se puede borrar).
set -e

echo; echo "=== 1. Mirar la base de datos desde Sqoop ==="
sqoop list-databases --connect jdbc:mysql://localhost --username alumno --password alumno

sqoop list-tables --connect jdbc:mysql://localhost/tienda --username alumno --password alumno

# eval: corre SQL en MySQL y muestra el resultado (no usa Hadoop)
sqoop eval --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \\
  --query "SELECT * FROM productos"

echo; echo "=== 2. Importar: MySQL -> HDFS ==="
# Tabla chica: 1 mapper (-m 1) -> 1 archivo. --delete-target-dir: si la
# carpeta ya existe la pisa (sino falla, igual que MapReduce)
sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \\
  --table productos \\
  --target-dir /user/root/tienda/productos --delete-target-dir \\
  -m 1

# Tabla grande: 4 mappers en paralelo. Sqoop parte la tabla en 4 rangos de la
# clave primaria (id) y cada mapper copia uno -> 4 archivos part-m-0000N
sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \\
  --table ventas \\
  --target-dir /user/root/tienda/ventas --delete-target-dir \\
  -m 4

hdfs dfs -ls /user/root/tienda/ventas
hdfs dfs -cat /user/root/tienda/ventas/part-m-00000 | head -5

echo; echo "=== 3. Procesar en Hive: JOIN ventas + productos ==="
if ! netstat -tln 2>/dev/null | grep -q ':10000 '; then
  echo "Hive no esta prendido: los pasos 3 y 4 lo necesitan. Hive corre con"
  echo "SERVICIOS=todo (el valor por defecto); si recien prendiste el contenedor,"
  echo "espera a que diga 'Cluster LISTO' (docker logs bigdata)."
  exit 0
fi
beeline -u jdbc:hive2://localhost:10000 -f ejemplos/tienda.hql

echo; echo "=== 4. Exportar: HDFS -> MySQL ==="
# La tabla destino tiene que existir; se vacia para poder repetir el ejemplo
sqoop eval --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \\
  --query "TRUNCATE TABLE resumen_categoria"

sqoop export --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \\
  --table resumen_categoria \\
  --export-dir /user/root/resultados/hive_por_categoria \\
  -m 1

sqoop eval --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \\
  --query "SELECT * FROM resumen_categoria ORDER BY facturado DESC"
`,le=`"""ETL de ventas sucias con pandas + numpy: de ventas_sucias.csv a una tabla limpia.

ETL = Extraer (leer los datos como vienen), Transformar (limpiarlos) y
Cargar (guardarlos listos para analizar). Este script hace la limpieza paso
a paso y cuenta lo que arregla en cada uno, para comparar con lo que el
generador dice que metio. etl_spark.py hace EXACTAMENTE lo mismo con Spark:
tienen que dar el mismo resumen.

Uso (adentro del contenedor, parado en /datos):

    python3 ejemplos/ml/generar_sucios.py    # una vez: crea ventas_sucias.csv
    python3 ejemplos/ml/etl_pandas.py        # -> ventas_limpias.parquet

pandas trabaja con TODA la tabla en la memoria de una sola compu: rapido y
comodo mientras los datos entren en la RAM (hasta unos pocos GB). Cuando no
entran, se usa Spark, que reparte el trabajo entre varias maquinas.
"""
import sys
import time

import numpy as np
import pandas as pd

entrada = sys.argv[1] if len(sys.argv) > 1 else "ventas_sucias.csv"
salida = sys.argv[2] if len(sys.argv) > 2 else "ventas_limpias.parquet"
inicio = time.perf_counter()
cuenta = {}   # cuantas filas toco cada paso, para el resumen del final

# ---------------------------------------------------------------------------
# 1. EXTRAER: leer todo como texto (dtype=str). Si pandas adivinara los tipos,
#    "2.575,00" o "05/03/2026" quedarian mal sin avisar. Las celdas vacias
#    quedan como NaN (el "nulo" de pandas).
# ---------------------------------------------------------------------------
ventas = pd.read_csv(entrada, dtype=str)
cuenta["filas leidas"] = len(ventas)
print(f"Leidas {len(ventas)} filas. Asi vienen:")
print(ventas.head(8).to_string(index=False))

# ---------------------------------------------------------------------------
# 2. DUPLICADOS: el mismo ticket cargado dos veces. Se queda uno.
# ---------------------------------------------------------------------------
antes = len(ventas)
ventas = ventas.drop_duplicates(subset="ticket")
cuenta["duplicados eliminados"] = antes - len(ventas)

# ---------------------------------------------------------------------------
# 3. TEXTO: sin espacios de mas, en minusculas y sin tildes, para que
#    "  YERBA", "Yerba" y "yerba" sean el mismo producto.
# ---------------------------------------------------------------------------
SIN_TILDES = str.maketrans("áéíóú", "aeiou")
for columna in ["sucursal", "producto", "medio_pago"]:
    ventas[columna] = ventas[columna].str.strip().str.lower().str.translate(SIN_TILDES)

# ---------------------------------------------------------------------------
# 4. FECHAS: hay tres formatos. Primero se detecta cual es cada una (con una
#    expresion regular) y despues se convierte con su formato. Nunca dejar que
#    el programa "adivine": 05/03/2026 puede ser 5 de marzo o 3 de mayo.
# ---------------------------------------------------------------------------
f = ventas["fecha"]
iso = f.str.fullmatch(r"\\d{4}-\\d{2}-\\d{2}", na=False)        # 2026-03-05
argentina = f.str.fullmatch(r"\\d{2}/\\d{2}/\\d{4}", na=False)  # 05/03/2026
junta = f.str.fullmatch(r"\\d{8}", na=False)                  # 20260305
ventas["fecha"] = (pd.to_datetime(f.where(iso), format="%Y-%m-%d")
                   .fillna(pd.to_datetime(f.where(argentina), format="%d/%m/%Y"))
                   .fillna(pd.to_datetime(f.where(junta), format="%Y%m%d")))
cuenta["fechas en formato dia/mes/año"] = int(argentina.sum())
cuenta["fechas en formato todo junto"] = int(junta.sum())
sin_fecha = ventas["fecha"].isna()
cuenta["fechas que no se entienden (fuera)"] = int(sin_fecha.sum())
ventas = ventas[~sin_fecha]

# ---------------------------------------------------------------------------
# 5. NUMEROS: el precio a veces viene como "2.575,00" (punto de miles y coma
#    decimal). Se saca el punto, la coma pasa a punto y recien ahi es numero.
# ---------------------------------------------------------------------------
p = ventas["precio"].str.strip()
con_coma = p.str.contains(",", na=False)
cuenta["precios con formato 2.575,00"] = int(con_coma.sum())
p = p.where(~con_coma, p.str.replace(".", "", regex=False).str.replace(",", ".", regex=False))
ventas["precio"] = pd.to_numeric(p)
ventas["cantidad"] = pd.to_numeric(ventas["cantidad"])

# ---------------------------------------------------------------------------
# 6. NULOS: que hacer con cada celda vacia depende de que dato falta.
#    - Sin cantidad no hay venta que contar: la fila se descarta.
#    - Sin medio de pago la venta vale igual: se marca "desconocido".
#    - Sin precio: se completa con la mediana del producto (mas abajo).
# ---------------------------------------------------------------------------
sin_cantidad = ventas["cantidad"].isna()
cuenta["sin cantidad (fuera)"] = int(sin_cantidad.sum())
ventas = ventas[~sin_cantidad]
cuenta["sin medio de pago (-> desconocido)"] = int(ventas["medio_pago"].isna().sum())
ventas["medio_pago"] = ventas["medio_pago"].fillna("desconocido")

# ---------------------------------------------------------------------------
# 7. OUTLIERS (valores imposibles). Antes de borrar nada, mirar que encontraria
#    un metodo estadistico: el rango intercuartil (IQR), que marca lo que esta
#    muy lejos del 50% central de los datos.
# ---------------------------------------------------------------------------
q1, q3 = ventas["cantidad"].quantile([0.25, 0.75])
iqr = q3 - q1
fuera_iqr = (ventas["cantidad"] < q1 - 1.5 * iqr) | (ventas["cantidad"] > q3 + 1.5 * iqr)
print(f"\\nMetodo IQR sobre cantidad: rango aceptado {q1 - 1.5 * iqr:g} a {q3 + 1.5 * iqr:g},"
      f" marca {int(fuera_iqr.sum())} filas")
# El IQR deja pasar cantidad -1 (esta "cerca" de los datos), que es imposible.
# Por eso se usa una regla del negocio: en un mostrador se venden de 1 a 20
# unidades por ticket.
fuera = (ventas["cantidad"] < 1) | (ventas["cantidad"] > 20)
cuenta["cantidad imposible (fuera)"] = int(fuera.sum())
ventas = ventas[~fuera]
ventas["cantidad"] = ventas["cantidad"].astype("int64")

# Precios: la mediana de cada producto (el valor del medio: no la mueven unos
# pocos valores locos, el promedio si). Un precio de mas de 10 veces la
# mediana es un precio cargado sin la coma decimal: se divide por 100.
mediana = ventas.groupby("producto")["precio"].transform("median")
locos = ventas["precio"] > 10 * mediana
cuenta["precio sin la coma (/100)"] = int(locos.sum())
ventas.loc[locos, "precio"] = ventas.loc[locos, "precio"] / 100
sin_precio = ventas["precio"].isna()
cuenta["sin precio (-> mediana del producto)"] = int(sin_precio.sum())
ventas["precio"] = ventas["precio"].fillna(np.floor(mediana)).astype("int64")

# ---------------------------------------------------------------------------
# 8. CARGAR: columnas finales, con sus tipos, a Parquet (formato por columnas,
#    comprimido y con los tipos adentro: el que lo lee no tiene que adivinar)
# ---------------------------------------------------------------------------
ventas["ticket"] = ventas["ticket"].astype("int64")
ventas["importe"] = ventas["cantidad"] * ventas["precio"]
ventas = ventas[["ticket", "fecha", "sucursal", "producto", "cantidad", "precio", "importe", "medio_pago"]]
ventas = ventas.sort_values("ticket")
ventas.to_parquet(salida, index=False)
cuenta["filas limpias"] = len(ventas)

print("\\nAsi quedan:")
print(ventas.head(8).to_string(index=False))
print("\\nTipos de cada columna:")
print(ventas.dtypes.to_string())
mb = ventas.memory_usage(deep=True).sum() / 1024 ** 2
print(f"\\nMemoria que ocupa la tabla en pandas: {mb:.1f} MB")

# ---------------------------------------------------------------------------
# Resumen (etl_spark.py imprime el mismo, para comparar)
# ---------------------------------------------------------------------------
print("\\n=== RESUMEN DEL ETL ===")
for paso, n in cuenta.items():
    print(f"  {paso:<40} {n:>9}")
print(f"  {'facturado total':<40} {ventas['importe'].sum():>15}")
print("=== POR SUCURSAL ===")
por_sucursal = ventas.groupby("sucursal").agg(filas=("ticket", "size"), facturado=("importe", "sum"))
for sucursal, fila in por_sucursal.sort_index().iterrows():
    print(f"  {sucursal:<10} {fila['filas']:>9} {fila['facturado']:>15}")
print(f"\\nGuardado en {salida} ({time.perf_counter() - inicio:.1f} s en total)")
`,ce=`"""El MISMO ETL de etl_pandas.py, en Spark (PySpark): para comparar.

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
iso = f.rlike(r"^\\d{4}-\\d{2}-\\d{2}$")        # 2026-03-05
argentina = f.rlike(r"^\\d{2}/\\d{2}/\\d{4}$")  # 05/03/2026
junta = f.rlike(r"^\\d{8}$")                  # 20260305
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
    F.when(con_coma, F.regexp_replace(F.regexp_replace(p, r"\\.", ""), ",", ".")).otherwise(p).cast("double"))
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
print(f"\\nMetodo IQR sobre cantidad: rango aceptado {desde:g} a {hasta:g}, marca {marca} filas")
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
print("\\nAsi quedan:")
limpias.orderBy("ticket").show(8, truncate=False)
limpias.printSchema()

# ---------------------------------------------------------------------------
# Resumen (el mismo de etl_pandas.py)
# ---------------------------------------------------------------------------
print("\\n=== RESUMEN DEL ETL ===")
for paso, n in cuenta.items():
    print(f"  {paso:<40} {n:>9}")
print(f"  {'facturado total':<40} {limpias.agg(F.sum('importe')).first()[0]:>15}")
print("=== POR SUCURSAL ===")
por_sucursal = (limpias.groupBy("sucursal")
                .agg(F.count("*").alias("filas"), F.sum("importe").alias("facturado"))
                .orderBy("sucursal"))
for fila in por_sucursal.collect():
    print(f"  {fila['sucursal']:<10} {fila['filas']:>9} {fila['facturado']:>15}")
print(f"\\nGuardado en {salida} ({time.perf_counter() - inicio:.1f} s en total)")

spark.stop()
`,de=`"""Machine learning con scikit-learn: lo que aprende cada modelo, al lado de la regla real.

Sobre clientes_senal.csv (generar_senal.py), donde las reglas son conocidas:
  1. Regresion lineal (supervisado): predecir cuanto va a gastar un cliente.
     Muestra los coeficientes aprendidos al lado de los de la formula real.
  2. Clasificacion (supervisado): predecir si vuelve a comprar, con un arbol
     de decision, regresion logistica y una red neuronal (MLPClassifier).
     Muestra las reglas del arbol al lado de la regla real.
  3. Clustering (NO supervisado): KMeans encuentra grupos de clientes sin que
     nadie le diga cuales son. Se comparan con los segmentos reales.
De cada modelo: aciertos en datos que no vio, validacion cruzada, cuanto
tarda en entrenar y cuanta memoria usa.

Uso (adentro del contenedor, parado en /datos):

    python3 ejemplos/ml/generar_senal.py      # una vez: crea clientes_senal.csv
    python3 ejemplos/ml/modelos_sklearn.py    # -> metricas_sklearn.json y clusters_sklearn.png

scikit-learn trabaja en la memoria de una sola compu (como pandas). El mismo
trabajo con Spark MLlib, que reparte entre varias: modelos_spark.py.
"""
import json
import sys
import time
import tracemalloc

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import accuracy_score, adjusted_rand_score, mean_absolute_error, r2_score, silhouette_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier, export_text

archivo = sys.argv[1] if len(sys.argv) > 1 else "clientes_senal.csv"
clientes = pd.read_csv(archivo)
# Las columnas que el modelo puede mirar. NO van segmento_real, gasto ni
# vuelve: son las respuestas.
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
X = clientes[ENTRADAS]
metricas = {"filas": len(clientes)}


def titulo(texto):
    print(f"\\n{'=' * 78}\\n{texto}\\n{'=' * 78}")


def entrenar(modelo, X, y):
    """Entrena el modelo y devuelve cuanto tardo (segundos) y la memoria pico
    que uso Python para entrenarlo (MB). Medir la memoria lo hace un poco mas lento."""
    tracemalloc.start()
    inicio = time.perf_counter()
    modelo.fit(X, y)
    segundos = time.perf_counter() - inicio
    pico = tracemalloc.get_traced_memory()[1] / 1024 ** 2
    tracemalloc.stop()
    return segundos, pico


# ---------------------------------------------------------------------------
# 0. Separar: el 80% para entrenar y el 20% para PROBAR. Un modelo se evalua
#    con datos que no vio, como un examen con ejercicios nuevos. random_state
#    fija el sorteo: siempre los mismos clientes en cada parte.
# ---------------------------------------------------------------------------
X_ent, X_prueba, c_ent, c_prueba = train_test_split(X, clientes, test_size=0.2, random_state=42)
print(f"{len(X_ent)} clientes para entrenar, {len(X_prueba)} para probar")

# ---------------------------------------------------------------------------
# 1. REGRESION LINEAL: gasto = a + b1*x1 + b2*x2 + ...  El modelo busca los
#    numeros a, b1, b2... que mejor ajustan. Como los datos salieron de una
#    formula lineal, tendria que encontrarla (salvo el ruido).
# ---------------------------------------------------------------------------
titulo("1. REGRESION LINEAL: cuanto va a gastar el mes que viene")
REGLA_GASTO = {"antiguedad_meses": 50, "visitas_mes": 1500, "ticket_promedio": 0.8,
               "reclamos": -1500, "edad": 0}
regresion = LinearRegression()
segundos, mb = entrenar(regresion, X_ent, c_ent["gasto_mes_siguiente"])
print(f"{'':20}{'aprendido':>12}{'regla real':>12}")
print(f"{'(constante)':20}{regresion.intercept_:>12.1f}{5000:>12}")
for nombre, coef in zip(ENTRADAS, regresion.coef_):
    print(f"{nombre:20}{coef:>12.2f}{REGLA_GASTO[nombre]:>12}")
prediccion = regresion.predict(X_prueba)
r2 = r2_score(c_prueba["gasto_mes_siguiente"], prediccion)
mae = mean_absolute_error(c_prueba["gasto_mes_siguiente"], prediccion)
cv = cross_val_score(LinearRegression(), X, clientes["gasto_mes_siguiente"], cv=5, scoring="r2")
print(f"\\nR² en prueba: {r2:.3f} (1 = perfecto) | error medio: {mae:,.0f} pesos")
print(f"Validacion cruzada (5 partes): R² {cv.mean():.3f} ± {cv.std():.3f}")
print(f"Entrenar: {segundos * 1000:.0f} ms, {mb:.1f} MB")
print("El error no baja de ~1.600 pesos: es el ruido de la formula (desvio 2.000),\\n"
      "que no depende de nada que el modelo pueda ver. Y 'edad' queda cerca de 0.")
metricas["regresion"] = {"constante": regresion.intercept_,
                         "coeficientes": dict(zip(ENTRADAS, regresion.coef_)),
                         "r2": r2, "error_medio": mae, "segundos": segundos}

# ---------------------------------------------------------------------------
# 2. CLASIFICACION: vuelve a comprar (1) o no (0). La regla real es:
#    (visitas >= 4 y reclamos <= 1) o antiguedad >= 36, con 10% de ruido.
# ---------------------------------------------------------------------------
titulo("2. CLASIFICACION: vuelve a comprar el mes que viene?")
modelos = {
    # Siempre dice lo mismo (lo mas comun): cualquier modelo tiene que ganarle
    "tonto (siempre lo mas comun)": DummyClassifier(strategy="most_frequent"),
    # Preguntas de si/no, en forma de arbol: se puede leer lo que aprendio
    "arbol de decision": DecisionTreeClassifier(max_depth=3, random_state=42),
    # Una formula lineal + una curva que la pasa a probabilidad. StandardScaler
    # pone cada columna en la misma escala (sin eso, ticket_promedio, que vale
    # miles, pesaria mas que reclamos, que vale 0 a 5)
    "regresion logistica": make_pipeline(StandardScaler(), LogisticRegression()),
    # Red neuronal: 2 capas ocultas de 16 y 8 neuronas. early_stopping: deja de
    # entrenar cuando ya no mejora con datos que aparta para controlar
    "red neuronal (MLP)": make_pipeline(
        StandardScaler(),
        MLPClassifier(hidden_layer_sizes=(16, 8), max_iter=500, early_stopping=True, random_state=42)),
}
metricas["clasificacion"] = {}
print(f"{'modelo':30}{'aciertos':>10}{'valid. cruzada':>18}{'entrenar':>11}{'memoria':>10}")
for nombre, modelo in modelos.items():
    segundos, mb = entrenar(modelo, X_ent, c_ent["vuelve"])
    aciertos = accuracy_score(c_prueba["vuelve"], modelo.predict(X_prueba))
    # Validacion cruzada: parte los datos en 5, entrena 5 veces (cada vez deja
    # una parte afuera para probar) y promedia. Mas confiable que una sola prueba.
    cv = cross_val_score(modelo, X, clientes["vuelve"], cv=5)
    print(f"{nombre:30}{aciertos:>10.1%}{cv.mean():>11.1%} ± {cv.std():.1%}"
          f"{segundos * 1000:>9.0f} ms{mb:>7.1f} MB")
    metricas["clasificacion"][nombre] = {"aciertos": aciertos, "validacion_cruzada": cv.mean(),
                                         "segundos": segundos, "memoria_mb": mb}
print("Techo: ~90%. El 10% de las respuestas se dio vuelta al azar y ningun modelo\\n"
      "puede adivinarlas. La regresion logistica queda abajo porque la regla real\\n"
      "no es una recta: es un 'o' de dos condiciones. El arbol y la red si pueden.")

arbol = modelos["arbol de decision"]
print("\\nLo que aprendio el arbol (cada linea es una pregunta; class 1 = vuelve):")
print(export_text(arbol, feature_names=ENTRADAS))
print("La regla real:  vuelve si (visitas_mes >= 4 y reclamos <= 1) o antiguedad_meses >= 36")
print("  (visitas_mes <= 3.5 es lo mismo que < 4: el arbol corta entre dos valores)\\n"
      "Si una pregunta termina con la misma clase en las dos ramas, no cambia nada:\\n"
      "el arbol la agrego por el ruido (Spark MLlib las saca solo).")
print("\\nImportancia de cada columna para el arbol (suma 1):")
for nombre, importancia in sorted(zip(ENTRADAS, arbol.feature_importances_), key=lambda x: -x[1]):
    print(f"  {nombre:20}{importancia:.3f}")

# ---------------------------------------------------------------------------
# 3. NO SUPERVISADO: KMeans busca k grupos de puntos cercanos entre si. Nadie
#    le dice cuales son los segmentos: segmento_real solo se usa al final,
#    para ver si los encontro.
# ---------------------------------------------------------------------------
titulo("3. CLUSTERING (KMeans): grupos de clientes, sin decirle cuales son")
datos = clientes[["visitas_mes", "ticket_promedio"]]
# Sin escalar: el ticket (miles de pesos) tapa a las visitas (1 a 10)
sin_escalar = KMeans(n_clusters=3, n_init=10, random_state=42).fit_predict(datos)
# Escalado (y el ticket en logaritmo: 6.000 vs 9.000 pesa como 60.000 vs 90.000)
escalados = StandardScaler().fit_transform(np.column_stack([datos["visitas_mes"],
                                                            np.log(datos["ticket_promedio"])]))
kmeans = KMeans(n_clusters=3, n_init=10, random_state=42)
segundos, mb = entrenar(kmeans, escalados, None)
grupos = kmeans.labels_
# Indice de Rand ajustado: 1 = los mismos grupos que los reales, 0 = al azar
ari_sin = adjusted_rand_score(clientes["segmento_real"], sin_escalar)
ari = adjusted_rand_score(clientes["segmento_real"], grupos)
print(f"Parecido con los segmentos reales (Rand ajustado, 1 = iguales):"
      f" sin escalar {ari_sin:.2f}, escalado {ari:.2f}")
print("\\nCada grupo encontrado (filas) contra el segmento real (columnas):")
print(pd.crosstab(grupos, clientes["segmento_real"], rownames=["grupo"], colnames=["segmento real"]))
print("Los frecuentes que compran 4 veces por mes quedan con los ocasionales (3 por\\n"
      "mes): estan mas cerca de ellos. En datos reales los grupos tambien se tocan.")
print(f"Entrenar: {segundos * 1000:.0f} ms, {mb:.1f} MB")

# En la vida real no se sabe cuantos grupos hay: el "silhouette" mide que tan
# separados quedan (de -1 a 1, mas es mejor). Se calcula sobre 5.000 clientes:
# con todos compararia cada par (20.000 x 20.000 distancias).
print("\\nCuantos grupos elegir si no se supiera (silhouette, mas alto es mejor):")
for k in range(2, 6):
    etiquetas = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(escalados)
    s = silhouette_score(escalados, etiquetas, sample_size=5000, random_state=42)
    print(f"  k={k}: {s:.3f}")

plt.figure(figsize=(7, 5))
plt.scatter(datos["visitas_mes"] + np.random.default_rng(0).uniform(-0.3, 0.3, len(datos)),
            datos["ticket_promedio"], c=grupos, s=4, cmap="viridis")
plt.yscale("log")
plt.xlabel("visitas por mes")
plt.ylabel("ticket promedio (pesos, escala logaritmica)")
plt.title("Grupos que encontro KMeans")
plt.savefig("clusters_sklearn.png", dpi=100, bbox_inches="tight")
print("\\nGrafico: clusters_sklearn.png")

metricas["clustering"] = {"rand_ajustado": ari, "rand_ajustado_sin_escalar": ari_sin,
                          "segundos": segundos}
with open("metricas_sklearn.json", "w") as f:
    json.dump(metricas, f, indent=2)
print("Metricas: metricas_sklearn.json")
`,pe=`"""Machine learning con Spark MLlib: los mismos modelos de modelos_sklearn.py, en el cluster.

Sobre clientes_senal.csv (generar_senal.py), donde las reglas son conocidas:
regresion lineal, arbol de decision, regresion logistica, red neuronal
(MultilayerPerceptron), validacion cruzada y KMeans, cada uno al lado de la
regla real, con lo que tarda en entrenar.

Uso (adentro del contenedor, parado en /datos):

    python3 ejemplos/ml/generar_senal.py      # una vez: crea clientes_senal.csv
    hdfs dfs -mkdir -p /user/root/ml
    hdfs dfs -put -f clientes_senal.csv /user/root/ml/
    spark-submit ejemplos/ml/modelos_spark.py      # -> metricas_spark.json

Lo que cambia respecto de scikit-learn:
  - MLlib quiere todas las columnas de entrada juntas en UNA columna de tipo
    vector ("features"): eso hace VectorAssembler.
  - Un modelo sin entrenar es un "Estimator": .fit(datos) lo entrena y
    devuelve un "Model", que con .transform(datos) agrega la columna
    "prediction". Todo, hasta el resultado, es un DataFrame.
  - El entrenamiento se reparte entre los executors. Con 20.000 filas
    scikit-learn es mucho mas rapido (no reparte nada): MLlib existe para
    cuando los datos no entran en una sola compu.
  - La memoria la usan los executors (procesos Java, 512 MB cada uno): se ve
    en http://localhost:4040 -> Executors, mientras corre.
"""
import json
import sys
import time

from pyspark.ml import Pipeline
from pyspark.ml.classification import (DecisionTreeClassifier, LogisticRegression,
                                       MultilayerPerceptronClassifier)
from pyspark.ml.clustering import KMeans
from pyspark.ml.evaluation import MulticlassClassificationEvaluator, RegressionEvaluator
from pyspark.ml.feature import StandardScaler, VectorAssembler
from pyspark.ml.regression import LinearRegression
from pyspark.ml.tuning import CrossValidator, ParamGridBuilder
from pyspark.sql import SparkSession, functions as F

entrada = sys.argv[1] if len(sys.argv) > 1 else "hdfs:///user/root/ml/clientes_senal.csv"
spark = SparkSession.builder.appName("modelos MLlib").getOrCreate()

# Las columnas que el modelo puede mirar (las mismas que en scikit-learn)
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
clientes = spark.read.csv(entrada, header=True, inferSchema=True)
datos = VectorAssembler(inputCols=ENTRADAS, outputCol="features").transform(clientes)
# cache(): se usan muchas veces; que queden en la memoria de los executors
ent, prueba = datos.randomSplit([0.8, 0.2], seed=42)
ent.cache()
prueba.cache()
print(f"{ent.count()} clientes para entrenar, {prueba.count()} para probar")
metricas = {"filas": clientes.count()}


def titulo(texto):
    print(f"\\n{'=' * 78}\\n{texto}\\n{'=' * 78}")


def entrenar(estimador, df):
    """Entrena y devuelve el modelo y cuanto tardo (segundos)."""
    inicio = time.perf_counter()
    modelo = estimador.fit(df)
    return modelo, time.perf_counter() - inicio


# ---------------------------------------------------------------------------
# 1. REGRESION LINEAL
# ---------------------------------------------------------------------------
titulo("1. REGRESION LINEAL: cuanto va a gastar el mes que viene")
REGLA_GASTO = {"antiguedad_meses": 50, "visitas_mes": 1500, "ticket_promedio": 0.8,
               "reclamos": -1500, "edad": 0}
regresion, segundos = entrenar(LinearRegression(labelCol="gasto_mes_siguiente"), ent)
print(f"{'':20}{'aprendido':>12}{'regla real':>12}")
print(f"{'(constante)':20}{regresion.intercept:>12.1f}{5000:>12}")
for nombre, coef in zip(ENTRADAS, regresion.coefficients):
    print(f"{nombre:20}{coef:>12.2f}{REGLA_GASTO[nombre]:>12}")
predicciones = regresion.transform(prueba)
evaluar = RegressionEvaluator(labelCol="gasto_mes_siguiente")
r2 = evaluar.evaluate(predicciones, {evaluar.metricName: "r2"})
mae = evaluar.evaluate(predicciones, {evaluar.metricName: "mae"})
print(f"\\nR² en prueba: {r2:.3f} | error medio: {mae:,.0f} pesos | entrenar: {segundos:.1f} s")
metricas["regresion"] = {"constante": regresion.intercept,
                         "coeficientes": dict(zip(ENTRADAS, regresion.coefficients.toArray().tolist())),
                         "r2": r2, "error_medio": mae, "segundos": segundos}

# ---------------------------------------------------------------------------
# 2. CLASIFICACION
# ---------------------------------------------------------------------------
titulo("2. CLASIFICACION: vuelve a comprar el mes que viene?")
aciertos = MulticlassClassificationEvaluator(labelCol="vuelve", metricName="accuracy")
# withMean: centrar en 0 (como StandardScaler de scikit-learn)
escalar = StandardScaler(inputCol="features", outputCol="escaladas", withMean=True)
modelos = {
    "arbol de decision": DecisionTreeClassifier(labelCol="vuelve", maxDepth=3, seed=42),
    "regresion logistica": Pipeline(stages=[
        escalar, LogisticRegression(featuresCol="escaladas", labelCol="vuelve")]),
    # layers: 5 entradas, 2 capas ocultas de 16 y 8, 2 salidas (vuelve o no)
    "red neuronal (MLP)": Pipeline(stages=[
        escalar, MultilayerPerceptronClassifier(featuresCol="escaladas", labelCol="vuelve",
                                                layers=[len(ENTRADAS), 16, 8, 2], maxIter=200, seed=42)]),
}
metricas["clasificacion"] = {}
entrenados = {}
print(f"{'modelo':30}{'aciertos':>10}{'entrenar':>12}")
for nombre, estimador in modelos.items():
    modelo, segundos = entrenar(estimador, ent)
    entrenados[nombre] = modelo
    a = aciertos.evaluate(modelo.transform(prueba))
    print(f"{nombre:30}{a:>10.1%}{segundos:>10.1f} s")
    metricas["clasificacion"][nombre] = {"aciertos": a, "segundos": segundos}
print("Techo: ~90% (el 10% de las respuestas se dio vuelta al azar).")

# El arbol, con los nombres de las columnas en lugar de "feature 0, 1..."
reglas = entrenados["arbol de decision"].toDebugString
for i, nombre in reversed(list(enumerate(ENTRADAS))):
    reglas = reglas.replace(f"feature {i} ", f"{nombre} ")
print("\\nLo que aprendio el arbol (Predict: 1.0 = vuelve):")
print(reglas)
print("La regla real:  vuelve si (visitas_mes >= 4 y reclamos <= 1) o antiguedad_meses >= 36")

# Validacion cruzada para elegir la profundidad del arbol: 3 partes x 3
# profundidades = 9 entrenamientos, y se queda con la mejor
titulo("Validacion cruzada: que profundidad de arbol conviene")
arbol = DecisionTreeClassifier(labelCol="vuelve", seed=42)
grilla = ParamGridBuilder().addGrid(arbol.maxDepth, [2, 3, 5]).build()
validacion = CrossValidator(estimator=arbol, estimatorParamMaps=grilla, evaluator=aciertos,
                            numFolds=3, seed=42)
mejor, segundos = entrenar(validacion, datos)
for params, promedio in zip(grilla, mejor.avgMetrics):
    print(f"  profundidad {params[arbol.maxDepth]}: {promedio:.1%} de aciertos promedio")
print(f"Elegida: profundidad {mejor.bestModel.getMaxDepth()} ({segundos:.1f} s para los 9 entrenamientos)")
metricas["validacion_cruzada"] = {"profundidad_elegida": mejor.bestModel.getMaxDepth(),
                                  "aciertos": max(mejor.avgMetrics), "segundos": segundos}

# ---------------------------------------------------------------------------
# 3. CLUSTERING: KMeans sobre visitas y log(ticket), escalados
# ---------------------------------------------------------------------------
titulo("3. CLUSTERING (KMeans): grupos de clientes, sin decirle cuales son")
para_grupos = clientes.withColumn("log_ticket", F.log("ticket_promedio"))
agrupar = Pipeline(stages=[
    VectorAssembler(inputCols=["visitas_mes", "log_ticket"], outputCol="crudas"),
    StandardScaler(inputCol="crudas", outputCol="escaladas", withMean=True),
    KMeans(featuresCol="escaladas", k=3, seed=42),
])
modelo, segundos = entrenar(agrupar, para_grupos)
grupos = modelo.transform(para_grupos)
print("Cada grupo encontrado (filas) contra el segmento real (columnas):")
grupos.crosstab("prediction", "segmento_real").orderBy("prediction_segmento_real").show()
# Resultado chico (2 columnas): se puede pasar a pandas y usar scikit-learn
from sklearn.metrics import adjusted_rand_score  # noqa: E402

tabla = grupos.select("prediction", "segmento_real").toPandas()
ari = adjusted_rand_score(tabla["segmento_real"], tabla["prediction"])
print(f"Parecido con los segmentos reales (Rand ajustado, 1 = iguales): {ari:.2f} | entrenar: {segundos:.1f} s")
metricas["clustering"] = {"rand_ajustado": ari, "segundos": segundos}

with open("metricas_spark.json", "w") as f:
    json.dump(metricas, f, indent=2)
print("\\nMetricas: metricas_spark.json")
spark.stop()
`,ue=`-- Facturacion por categoria, en Pig Latin: un JOIN de las ventas con los
-- productos. La misma cuenta que el JOIN de tienda.hql (Hive) y que
-- categoria.py (Spark), sobre las tablas que trajo Sqoop desde MariaDB.
--
-- Uso (adentro del contenedor, parado en /datos), despues de traer la base:
--   bash ejemplos/sqoop.sh                  # o la etapa 1 del Pipeline
--   pig ejemplos/comparar/categoria.pig
--
-- Pig hace un JOIN "del lado del reduce": las ventas y los productos viajan
-- por el shuffle agrupados por producto. Con 'replicated' (al final del JOIN)
-- mandaria la tabla chica a cada mapper y se ahorraria ese shuffle.

%default salida '/user/root/resultados/pig_por_categoria'

-- 1. Las dos tablas, como las dejo Sqoop (texto separado por comas, sin encabezado)
ventas = LOAD '/user/root/tienda/ventas' USING PigStorage(',')
         AS (id:int, fecha:chararray, sucursal:chararray, producto:chararray,
             cantidad:int, precio:int);
productos = LOAD '/user/root/tienda/productos' USING PigStorage(',')
            AS (producto:chararray, categoria:chararray, precio:int);

-- 2. Unirlas por producto
unidas = JOIN ventas BY producto, productos BY producto;

-- 3. La categoria y el importe de cada venta
lineas = FOREACH unidas GENERATE productos::categoria AS categoria,
         ventas::cantidad AS cantidad,
         (long)ventas::cantidad * ventas::precio AS importe;

-- 4. Agrupar por categoria y sumar
por_categoria = GROUP lineas BY categoria;
resumen = FOREACH por_categoria GENERATE
              group                 AS categoria,
              SUM(lineas.cantidad)  AS unidades,
              SUM(lineas.importe)   AS facturado;
ordenado = ORDER resumen BY facturado DESC;

-- 5. Guardar en HDFS (si ya existia de una corrida anterior, se borra antes)
fs -rm -r -f $salida;
STORE ordenado INTO '$salida' USING PigStorage(',');
`,me=`"""Facturacion por categoria, en Spark (PySpark): un JOIN de las ventas con los
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
ventas = spark.read.csv("hdfs:///user/root/tienda/ventas", inferSchema=True) \\
    .toDF("id", "fecha", "sucursal", "producto", "cantidad", "precio")
productos = spark.read.csv("hdfs:///user/root/tienda/productos", inferSchema=True) \\
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
`,fe=`"""Traer la tabla ventas de MariaDB a HDFS con Spark, por JDBC: lo mismo que
el \`sqoop import\` de sqoop.sh, pero como parte de un programa que despues
puede seguir procesando.

Uso (adentro del contenedor, parado en /datos):

    spark-submit --jars /opt/sqoop/lib/mysql-connector-java-5.1.49.jar \\
        ejemplos/comparar/jdbc.py

Spark lee la tabla en 4 pedazos en paralelo (partitionColumn = id), como
\`sqoop import -m 4\`. El driver de MariaDB (el de MySQL) es el mismo jar que
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
`;function D(a,n,i,r,s){const o=n.replace(/\r\n/g,`
`).split(`
`),c=Math.max(0,o.findIndex(m=>r.test(m))-1),l=o.findIndex((m,f)=>f>c&&s.test(m)),p=o.slice(c,l<0?o.length:l+1).join(`
`).trim();return{nombre:a,texto:n.replace(/\r\n/g,`
`).trim(),nucleo:p,lineas:Z(p,i)}}const w="SELECT sucursal, COUNT(*) AS tickets, SUM(CAST(cantidad AS BIGINT) * precio) AS facturado FROM ventas GROUP BY sucursal ORDER BY facturado DESC",ve={texto:"Las tablas de la base tienda tienen que estar en HDFS: las trae Sqoop (la etapa 1 del Pipeline, o el script).",cmd:"bash ejemplos/sqoop.sh",ir:{page:"pipeline",label:"Ir al Pipeline"}},z=[{id:"join",titulo:"Unir dos tablas",corto:"Facturación por categoría: las ventas unidas con los productos",mirar:"Cuántos shuffles hay y cuánto viaja por la red. Pig une del lado del reduce: las ventas viajan agrupadas por producto. Hive y Spark ven que productos es chica (8 filas) y la mandan entera a cada tarea (map join, broadcast join): las ventas no se mueven para unirse.",antes:ve,variantes:[{nombre:"HiveQL",motor:"tez",donde:"en el cluster",archivos:[h("tienda.hql",te,"--",/^SELECT p\.categoria/,/^ORDER BY facturado DESC;/)],cmd:"beeline -u jdbc:hive2://localhost:10000 -f ejemplos/tienda.hql",nota:"Un JOIN de SQL; Hive lo convierte en un map join porque productos entra en memoria."},{nombre:"Pig Latin",motor:"mr",donde:"en el cluster",archivos:[h("categoria.pig",ue,"--",/^ventas = LOAD/,/^STORE /)],cmd:"pig ejemplos/comparar/categoria.pig",nota:"JOIN del lado del reduce. Con USING 'replicated' sería un map join, como el de Hive."},{nombre:"PySpark",motor:"spark",donde:"en el cluster",archivos:[h("categoria.py",me,"#",/^from pyspark/,/^resumen\.write/)],cmd:"spark-submit ejemplos/comparar/categoria.py",nota:"explain() muestra BroadcastHashJoin: productos viaja a cada executor."}]},{id:"sql",titulo:"SQL sobre la misma tabla",corto:"Ventas por sucursal: la misma consulta en Hive y en Spark SQL",mirar:"Mismo SQL y misma tabla del Metastore; cambia el motor. Hive la corre en Tez, Spark SQL en sus executors. Con datos chicos casi todo es arrancar: Hive abre una sesión de Tez en YARN y Spark arranca su aplicación entera. Y ojo: en un :full real Spark devuelve una fila de más (sucursal 1 NULL), porque no aplica skip.header.line.count de la tabla y cuenta el encabezado del CSV como una venta.",antes:{texto:"La tabla ventas tiene que existir en el Metastore (Tablas o Lenguajes la crean).",ir:{page:"tablas",label:"Ir a Tablas"}},ir:{page:"lenguajes",arg:"hive",label:"Correrla en Lenguajes (Hive)"},variantes:[{nombre:"Hive (Tez)",motor:"tez",donde:"en el cluster",archivos:[h("ventas.hql",ee,"--",/^SELECT sucursal,/,/^ORDER BY facturado DESC;/)],cmd:`beeline -u jdbc:hive2://localhost:10000 -e "${w}"`,nota:"beeline le manda el SQL a HiveServer2, que arma un DAG de Tez."},{nombre:"Spark SQL",motor:"spark",donde:"en el cluster",archivos:[D("ventas.py",ae,"#",/spark\.sql\("""/,/"""\)\.show\(\)/)],cmd:`spark-sql -e "${w}"`,nota:"Lee la tabla por el nombre (Spark usa el mismo Metastore que Hive), pero no saltea el encabezado: suma la fila sucursal 1 NULL."}]},{id:"etl",titulo:"Limpiar los datos (ETL)",corto:"Ventas sucias: duplicados, fechas y nombres mal escritos",mirar:"Una máquina contra el cluster. pandas tiene toda la tabla en memoria y es más rápido mientras entre; Spark reparte en particiones y gana cuando los datos no entran en una compu. Los pasos son los mismos.",antes:{texto:"Los datos sucios se generan una vez (y para Spark se suben a HDFS).",cmd:`python3 ejemplos/ml/generar_sucios.py
hdfs dfs -mkdir -p /user/root/ml
hdfs dfs -put -f ventas_sucias.csv /user/root/ml/`},ir:{page:"pipeline",label:"Correrlo en el Pipeline (etapa ETL)"},variantes:[{nombre:"pandas",motor:"uno",donde:"en una sola máquina",archivos:[h("etl_pandas.py",le,"#",/^ventas = pd\.read_csv/,/\.to_parquet\(salida/)],cmd:"python3 ejemplos/ml/etl_pandas.py",nota:"Toda la tabla en la RAM de una compu, sin YARN."},{nombre:"PySpark",motor:"spark",donde:"en el cluster",archivos:[h("etl_spark.py",ce,"#",/^ventas = spark\.read\.csv/,/\.parquet\(salida\)/)],cmd:"spark-submit ejemplos/ml/etl_spark.py",nota:"Cada count() es un trabajo de Spark: se ven en :4040 mientras corre."}]},{id:"traer",titulo:"Traer una tabla de MariaDB",corto:"La tabla ventas de la base tienda, a HDFS",mirar:"Sqoop es un comando: trae la tabla y termina. Spark lee por JDBC adentro de un programa, que después puede seguir procesando sin escribir en el medio. Los dos la leen en 4 pedazos en paralelo.",ir:{page:"pipeline",label:"Sqoop en el Pipeline (etapa 1)"},variantes:[{nombre:"Sqoop",motor:"mr",donde:"en el cluster",archivos:[D("sqoop.sh",ie,"#",/--table ventas/,/-m 4\s*$/)],cmd:`sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \\
  --table ventas --target-dir /user/root/tienda/ventas --delete-target-dir -m 4`,nota:"Un trabajo de MapReduce sin reduce: cada map lee un rango de id."},{nombre:"Spark (JDBC)",motor:"spark",donde:"en el cluster",archivos:[h("jdbc.py",fe,"#",/^from pyspark/,/^ventas\.write/)],cmd:`spark-submit --jars /opt/sqoop/lib/mysql-connector-java-5.1.49.jar \\
  ejemplos/comparar/jdbc.py`,nota:"El mismo driver de MySQL que usa Sqoop, pasado con --jars."}]},{id:"modelo",titulo:"Entrenar un modelo",corto:"Regresión, clasificación y clustering de clientes",mirar:"scikit-learn entrena en una máquina con todo en memoria (y tiene más modelos); MLlib reparte los datos entre los executors y entrena con todo lo que hay en HDFS. Los resultados se parecen; el costo no.",antes:{texto:"Los clientes se generan una vez (y para Spark se suben a HDFS).",cmd:`python3 ejemplos/ml/generar_senal.py
hdfs dfs -mkdir -p /user/root/ml
hdfs dfs -put -f clientes_senal.csv /user/root/ml/`},ir:{page:"ml",label:"Entrenar en Machine Learning"},variantes:[{nombre:"scikit-learn",motor:"uno",donde:"en una sola máquina",archivos:[h("modelos_sklearn.py",de,"#",/^import json/)],cmd:"python3 ejemplos/ml/modelos_sklearn.py",nota:"Deja metricas_sklearn.json para comparar con el de Spark."},{nombre:"Spark MLlib",motor:"spark",donde:"en el cluster",archivos:[h("modelos_spark.py",pe,"#",/^import json/)],cmd:"spark-submit ejemplos/ml/modelos_spark.py",nota:"Deja metricas_spark.json: mismas métricas, otro motor."}]}],ge=[{id:"formatos",titulo:"CSV contra Parquet",corto:"La misma tabla en tres formatos: lo que ocupa y lo que tarda",ir:{page:"formatos",label:"Ir a Formatos"}}],M=a=>({__html:a}),he={streaming:"mapreduce",pig:"pig",hive:"tez",pyspark:"spark"},be={ACCEPTED:"en la cola",RUNNING:"corriendo",FINISHED:"terminó",FAILED:"falló",KILLED:"la cortaron"},q=a=>new RegExp(`^(?:${a.trim().split(/\s+/).join("|")})$`),je={py:q("import from for in if not is None print and or as return def"),sql:q("CREATE EXTERNAL TABLE IF NOT EXISTS ROW FORMAT DELIMITED FIELDS TERMINATED BY STORED AS LOCATION TBLPROPERTIES SELECT SUM CAST FROM GROUP ORDER DESC STRING INT BIGINT TEXTFILE JOIN ON COUNT"),pig:q("LOAD USING AS FILTER BY FOREACH GENERATE GROUP SUM ORDER DESC STORE INTO fs JOIN"),sh:q("sqoop import export hdfs dfs bash")},Se=a=>a.endsWith(".py")?"py":a.endsWith(".pig")?"pig":a.endsWith(".sh")?"sh":"sql";function ye({l:a,lang:n}){const i=n==="py"||n==="sh"?"#":"--",r=a.indexOf(i),s=r<0?a:a.slice(0,r),o=r<0?"":a.slice(r),c=s.split(/("[^"]*"|'[^']*'|\b\w+\b)/);return e.jsxs(e.Fragment,{children:[c.map((l,p)=>/^["']/.test(l)?e.jsx("span",{className:"cp-tx",children:l},p):je[n].test(l)?e.jsx("span",{className:"cp-kw",children:l},p):e.jsx(v.Fragment,{children:l},p)),o&&e.jsx("span",{className:"cp-com",children:o}),`
`]})}function B({archivos:a}){const[n,i]=v.useState(0),[r,s]=v.useState(!1),o=a[n],c=r?o.texto:o.nucleo;return e.jsxs("div",{className:"cp-src",children:[e.jsxs("div",{className:"cp-src-h",children:[e.jsx("div",{role:"tablist","aria-label":"Archivos",children:a.map((l,p)=>e.jsx("button",{type:"button",role:"tab","aria-selected":p===n,onClick:()=>i(p),className:"mono",children:l.nombre},l.nombre))}),e.jsx("button",{type:"button",className:"cp-src-t","aria-pressed":r,onClick:()=>s(l=>!l),children:r?"Solo la cuenta":"Archivo entero"})]}),e.jsx("pre",{className:"cp-pre mono",tabIndex:0,"aria-label":`${o.nombre}${r?"":", lo que hace la cuenta"}`,children:c.split(`
`).map((l,p)=>e.jsx(ye,{l,lang:Se(o.nombre)},p))}),e.jsxs("div",{className:"cp-src-f",children:[e.jsxs("span",{children:["datos/ejemplos/",o.nombre]}),e.jsx($,{texto:c})]})]})}function _e({vivos:a,ult:n}){const i=[{m:"MAPREDUCE",filas:"2 / span 2"},{m:"TEZ",filas:"4"},{m:"SPARK",filas:"5"}],r=(s,o)=>e.jsx("span",{className:"cp-fl-cap",style:{gridColumn:s,gridRow:1},children:o});return e.jsxs("section",{className:"cp-flujo","aria-label":"El recorrido de los datos en las cuatro versiones",children:[r(1,"Almacenamiento"),r(3,"Lenguaje · cómo lo pedís"),r(5,"Motor · quién hace la cuenta"),r(7,"Resultado, otra vez en HDFS"),e.jsxs("div",{className:"cp-fl-dato","data-capa":"datos",style:{gridRow:"2 / span 4"},children:[e.jsx("span",{className:"cp-fl-k",children:"El dato, una sola vez"}),e.jsx("b",{className:"mono",children:O.carpeta}),e.jsx("small",{children:"HDFS guarda ventas.csv en bloques. Ninguna versión lo copia: las cuatro leen de acá."}),e.jsxs("button",{type:"button",className:"btn btn-sm",onClick:()=>b("hdfs",O.carpeta.slice(1)),children:[e.jsx(G,{size:13}),"Ver en HDFS"]})]}),A.map((s,o)=>{const c=n[s.id],l=c&&R(c)||void 0;return e.jsxs(v.Fragment,{children:[e.jsx("i",{className:"cp-fl-w",style:{gridRow:o+2,gridColumn:2},"data-run":l,"aria-hidden":"true"}),e.jsxs("a",{className:"cp-fl-l","data-capa":"lenguajes",href:"#comparar",onClick:p=>{p.preventDefault(),document.getElementById(`cp-${s.id}`)?.scrollIntoView({behavior:"smooth",block:"start"})},style:{gridRow:o+2},children:[e.jsx("b",{children:s.nombre}),e.jsx("small",{className:"mono",children:s.archivos.map(p=>p.nombre).join(" + ")})]}),e.jsx("i",{className:"cp-fl-w",style:{gridRow:o+2,gridColumn:4},"data-run":l,"aria-hidden":"true"}),e.jsx("i",{className:"cp-fl-w",style:{gridRow:o+2,gridColumn:6},"data-run":l,"aria-hidden":"true"}),e.jsx("span",{className:"cp-fl-out mono","data-capa":"datos",style:{gridRow:o+2},children:s.salida.replace("/user/root/","")})]},s.id)}),i.map(({m:s,filas:o})=>e.jsxs("div",{className:"cp-fl-m","data-motor":_[s].eng,"data-run":a.has(s)||void 0,style:{gridRow:o},children:[e.jsx("b",{children:_[s].nombre}),e.jsx("small",{children:a.has(s)?"corriendo ahora":e.jsxs(e.Fragment,{children:["en YARN: ",e.jsx("span",{className:"mono",children:s})]})})]},s))]})}function S({valor:a,max:n,children:i}){return e.jsxs("div",{className:"cp-bar",children:[e.jsx("span",{className:"cp-bar-t",children:i}),e.jsx("span",{className:"cp-bar-0","aria-hidden":"true",children:e.jsx("i",{style:{width:`${n?Math.max(4,a/n*100):0}%`}})})]})}function xe({v:a,app:n}){const i=n?.stages.length?n.stages.map(s=>({t:s.name,n:s.tasks.length,st:s.state,disco:!1})):null,r=i??a.fases.map(s=>({t:s.t,n:0,st:void 0,disco:!!s.disco}));return e.jsxs("div",{className:"cp-fases","aria-label":`Fases de ${_[a.motor].nombre}`,children:[e.jsx("ol",{children:r.map((s,o)=>e.jsxs("li",{"data-disco":s.disco||void 0,"data-st":s.st,children:[s.t,s.n>0&&e.jsxs("small",{className:"num",children:["×",s.n]})]},o))}),e.jsxs("p",{children:[i?"Las fases de la última corrida, como las contó YARN. ":"",a.faseNota]})]})}function qe({v:a,mov:n,max:i}){return e.jsxs("div",{className:"cp-mov","aria-label":"Lo que movió la última corrida",children:[e.jsxs("span",{className:"cp-mov-h",children:["Lo que movió",n.trabajos>1?` · ${n.trabajos} trabajos`:""]}),n.leido!=null&&e.jsxs(S,{valor:n.leido,max:i.leido,children:[e.jsx("b",{className:"num",children:L(n.leido)})," leídos de HDFS"]}),n.shuffle!=null&&e.jsxs(S,{valor:n.shuffle,max:i.shuffle,children:[e.jsx("b",{className:"num",children:L(n.shuffle)})," por el shuffle, de una fase a otra"]}),n.discoLocal!=null&&e.jsxs(S,{valor:n.discoLocal,max:i.discoLocal,children:[e.jsx("b",{className:"num",children:L(n.discoLocal)})," al disco local de los nodos"]}),e.jsxs(S,{valor:n.mbSeconds,max:i.mbSeconds,children:[e.jsxs("b",{className:"num",title:"Los MB de cada contenedor por los segundos que estuvo vivo, sumados",children:[N(n.mbSeconds/1024,1)," GB·s"]})," de memoria × tiempo en YARN"]}),n.leido==null&&e.jsx("p",{className:"cp-mov-no",children:a.motor==="TEZ"?"Tez no guarda contadores sin Timeline Server. Los de las corridas que lanza esta interfaz salen de lo que imprime beeline; de esta, YARN solo sabe cuánto tardó y cuánta memoria usó.":"Los contadores todavía no llegaron al historial."})]})}function Ee({v:a,run:n,mov:i,maxMov:r,now:s,maxLineas:o,maxT:c}){const[l,p]=v.useState(!1),m=a.archivos.reduce((u,t)=>u+t.lineas,0),f=n?.at(-1),j=f&&R(f),d=async()=>{if(a.plantilla){p(!0);try{const u=await P().submitJob({template:a.plantilla,params:{}});I({kind:"run",title:`${a.nombre}: enviado a YARN`,description:"La columna muestra el tiempo cuando termina",action:{label:"Ver el trabajo",run:()=>b("yarn",u)}})}catch(u){I({kind:"bad",title:`${a.nombre}: no se pudo lanzar`,description:u instanceof Error?u.message:String(u)})}finally{p(!1)}}};return e.jsxs("article",{className:"cp-col",id:`cp-${a.id}`,"data-motor":_[a.motor].eng,"data-run":j||void 0,"aria-label":a.nombre,children:[e.jsxs("header",{className:"cp-col-h","data-capa":"lenguajes",children:[e.jsx("h3",{children:a.nombre}),e.jsx(U,{engine:_[a.motor].eng}),e.jsx("p",{children:a.estilo})]}),e.jsxs("div",{className:"cp-med",children:[e.jsxs(S,{valor:m,max:o,children:[e.jsx("b",{className:"num",children:N(m)})," líneas hacen la cuenta"]}),f&&n?e.jsxs(S,{valor:C(n,s),max:c,children:[e.jsx("b",{className:"num",children:J(C(n,s)/1e3)})," la última vez · ",e.jsxs("span",{"data-st":f.state,children:[be[f.state],j?` ${N(f.progress)} %`:""]})]}):e.jsx("div",{className:"cp-bar cp-bar-nada",children:"Todavía no corrió en este cluster"}),i&&e.jsx(qe,{v:a,mov:i,max:r})]}),e.jsx(xe,{v:a,app:f}),e.jsx(B,{archivos:a.archivos}),e.jsx("p",{className:"cp-nota",children:a.nota}),e.jsxs("div",{className:"cp-acc",children:[a.plantilla?e.jsxs(W,{cap:he[a.id],className:"btn btn-sm btn-primary",busy:l,onClick:d,children:[e.jsx(Y,{size:12}),"Lanzar en YARN"]}):e.jsxs("button",{type:"button",className:"btn btn-sm btn-primary",onClick:()=>b("lenguajes","pig"),children:[e.jsx(Q,{size:13}),"Probarlo en Lenguajes"]}),f&&e.jsxs("button",{type:"button",className:"btn btn-sm btn-ghost",onClick:()=>b("yarn",f.id),children:["Ver el trabajo",e.jsx(E,{size:13})]}),e.jsx("button",{type:"button",className:"btn btn-sm btn-ghost",onClick:()=>b("hdfs",a.salida.slice(1)),children:"Ver el resultado"})]}),e.jsx(k,{cmd:a.cmd,bash:!0,donde:"o en la terminal, parado en /datos"})]})}function Ne({tarea:a}){return e.jsxs("nav",{className:"cp-tareas","aria-label":"Qué tarea comparar",children:[e.jsxs("button",{type:"button","aria-current":a==="ventas"||void 0,onClick:()=>T(""),children:[e.jsx("b",{children:"Ventas por producto"}),e.jsx("small",{children:"Contar y agrupar, en las cuatro"})]}),z.map(n=>e.jsxs("button",{type:"button","aria-current":a===n.id||void 0,onClick:()=>T(`tarea/${n.id}`),children:[e.jsx("b",{children:n.titulo}),e.jsx("small",{children:n.variantes.map(i=>i.nombre).join(", ")})]},n.id)),ge.map(n=>e.jsxs("button",{type:"button",className:"cp-tareas-afuera",onClick:()=>b(n.ir.page,n.ir.arg),children:[e.jsxs("b",{children:[n.titulo,e.jsx(E,{size:12,"aria-hidden":"true"})]}),e.jsx("small",{children:n.ir.label})]},n.id))]})}function ke({t:a}){const n=s=>s.archivos.reduce((o,c)=>o+c.lineas,0),i=Math.max(...a.variantes.map(n)),r=a.ir;return e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"cp-intro",children:[e.jsxs("div",{children:[e.jsx("h2",{children:a.titulo}),e.jsxs("p",{children:[a.corto,", con ",a.variantes.length===2?"dos herramientas":`${a.variantes.length} herramientas`,": el código real del repo y cómo correr cada una."]})]}),r&&e.jsx("div",{className:"cp-intro-a",children:e.jsxs("button",{type:"button",className:"btn btn-sm",onClick:()=>b(r.page,r.arg),children:[r.label,e.jsx(E,{size:13})]})})]}),a.antes&&e.jsxs("div",{className:"cp-antes",children:[e.jsxs("p",{children:[e.jsx("b",{children:"Antes:"})," ",a.antes.texto]}),a.antes.cmd&&e.jsx(k,{cmd:a.antes.cmd,bash:!0,donde:"en la terminal, parado en /datos"}),a.antes.ir&&e.jsxs("button",{type:"button",className:"btn btn-sm",onClick:()=>b(a.antes.ir.page,a.antes.ir.arg),children:[a.antes.ir.label,e.jsx(E,{size:13})]})]}),e.jsx("div",{className:"cp-cols","data-n":a.variantes.length,children:a.variantes.map(s=>e.jsxs("article",{className:"cp-col","data-motor":s.motor,"aria-label":s.nombre,children:[e.jsxs("header",{className:"cp-col-h","data-capa":"lenguajes",children:[e.jsx("h3",{children:s.nombre}),e.jsx(U,{engine:s.motor}),e.jsxs("p",{children:["Corre ",s.donde]})]}),e.jsx("div",{className:"cp-med",children:e.jsxs(S,{valor:n(s),max:i,children:[e.jsx("b",{className:"num",children:N(n(s))})," líneas hacen el trabajo"]})}),e.jsx(B,{archivos:s.archivos}),e.jsx("p",{className:"cp-nota",children:s.nota}),e.jsx(k,{cmd:s.cmd,bash:!0,donde:"en la terminal, parado en /datos"})]},s.nombre))}),e.jsxs("section",{className:"cp-obs","aria-label":"Qué mirar",children:[e.jsx("h3",{children:"Qué mirar"}),e.jsx("p",{className:"cp-mirar",children:a.mirar})]})]})}function Re({sel:a}){const n=v.useRef(null),i=Math.max(0,x.findIndex(o=>o.id===a)),r=x[i],s=v.useRef(a);return v.useEffect(()=>{x.some(o=>o.id===s.current)&&n.current?.scrollIntoView({block:"start"})},[]),e.jsxs("section",{className:"cp-preg",ref:n,"aria-label":"Las preguntas de siempre",children:[e.jsx("div",{className:"cp-preg-tabs",role:"tablist","aria-label":"Qué comparar",children:x.map((o,c)=>e.jsxs("button",{type:"button",role:"tab","aria-selected":c===i,onClick:()=>T(o.id),children:[e.jsx("b",{children:o.pregunta}),e.jsx("small",{children:o.cuales})]},o.id))}),e.jsxs("div",{className:"cp-preg-body",role:"tabpanel","aria-label":r.t,children:[e.jsx("h3",{children:r.t}),e.jsx("p",{children:r.q}),e.jsx("div",{className:"cp-preg-wrap",children:e.jsxs("table",{className:"cp-tabla",children:[e.jsx("thead",{children:e.jsxs("tr",{children:[e.jsx("th",{}),r.cols.map(([o,c])=>e.jsx("th",{"data-capa":c,children:o},o))]})}),e.jsx("tbody",{children:r.rows.map(o=>e.jsxs("tr",{children:[e.jsx("th",{scope:"row",children:o[0]}),o.slice(1).map((c,l)=>e.jsx("td",{dangerouslySetInnerHTML:M(c)},l))]},o[0]))})]})})]})]})}function Le(a,n){const[i,r]=v.useState({}),[s,o]=v.useState(0),c=v.useRef({}),l=Object.values(a).filter(d=>d.every(u=>!R(u))).flatMap(d=>d.map(u=>u.id)),p=d=>!d||d.source==="rm"&&d.type!=="TEZ"&&d.state==="FINISHED",m=l.filter(d=>p(i[d])&&(c.current[d]??0)<6),f=m.join(",");v.useEffect(()=>{if(!n||!m.length)return;let d=!0;const u=setTimeout(()=>{m.forEach(t=>{c.current[t]=(c.current[t]??0)+1}),P().yarnMetrics(m.slice(0,12)).then(t=>{d&&(r(g=>({...g,...Object.fromEntries(t.map(y=>[y.id,y]))})),o(g=>g+1))},()=>{})},s?5e3:0);return()=>{d=!1,clearTimeout(u)}},[f,n,s]);const j={};for(const[d,u]of Object.entries(a)){const t=u.map(y=>i[y.id]),g=t.every(Boolean)?re(t):void 0;g&&(j[d]=g)}return j}function ze(){const{status:a,apps:n}=V(),i=X(),r=v.useMemo(()=>ne(n),[n]),s=Le(r,a?.phase==="running");if(!a)return null;const o=new Set(n.filter(R).map(t=>t.type)),c=Object.fromEntries(Object.entries(r).map(([t,g])=>[t,g.at(-1)])),l=Math.max(...A.map(t=>t.archivos.reduce((g,y)=>g+y.lineas,0))),p=Math.max(0,...Object.values(r).map(t=>C(t,a.now))),m=Object.values(s),f={leido:Math.max(0,...m.map(t=>t.leido??0)),shuffle:Math.max(0,...m.map(t=>t.shuffle??0)),discoLocal:Math.max(0,...m.map(t=>t.discoLocal??0)),mbSeconds:Math.max(0,...m.map(t=>t.mbSeconds))},j=se(s),d=F.tres.steps[F.tres.steps.length-1],u=/^tarea\/([\w-]+)$/.exec(i)?z.find(t=>t.id===i.slice(6)):void 0;return e.jsxs("div",{className:"page-in cp",children:[e.jsx(K,{title:"Comparar",sub:"La misma tarea hecha con cada herramienta: el código real, el motor que la ejecuta y en qué se diferencian."}),e.jsx(Ne,{tarea:u?.id??"ventas"}),u?e.jsx(ke,{t:u}):e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"cp-intro",children:[e.jsxs("div",{children:[e.jsx("h2",{children:"Ventas por producto, cuatro veces"}),e.jsx("p",{children:"Cuántas unidades se vendieron de cada producto y cuánto se facturó. El repo trae la cuenta escrita cuatro veces y las cuatro tienen que dar igual: los datos y quien reparte (YARN) son los mismos; cambia cómo la escribís y qué motor la hace."})]}),e.jsx("div",{className:"cp-intro-a",children:e.jsxs("button",{type:"button",className:"btn btn-sm",onClick:()=>b("inicio","recorrido/tres"),children:[e.jsx(H,{size:13}),"Verlo en el mapa"]})})]}),e.jsx(_e,{vivos:o,ult:c}),e.jsx("div",{className:"cp-cols",children:A.map(t=>e.jsx(Ee,{v:t,run:r[t.id],mov:s[t.id],maxMov:f,now:a.now,maxLineas:l,maxT:p},t.id))}),j.length>0&&e.jsxs("section",{className:"cp-obs","aria-label":"Qué muestran los números",children:[e.jsx("h3",{children:"Qué muestran los números"}),e.jsx("ul",{children:j.map(t=>e.jsx("li",{children:t},t))}),e.jsx("p",{children:"Salen de la última corrida de cada una: el tiempo y la memoria, de YARN; lo leído, el shuffle y el disco local, de JobHistory (MapReduce) y de Spark History."})]}),e.jsxs("section",{className:"cp-cierre","aria-label":d.t,children:[e.jsxs("div",{children:[e.jsx("h3",{children:d.t}),e.jsx("div",{className:"cp-cierre-x",dangerouslySetInnerHTML:M(d.x)}),d.tip&&e.jsx("p",{className:"cp-cierre-tip",dangerouslySetInnerHTML:M(d.tip)})]}),e.jsxs("div",{children:[e.jsx("h3",{children:"¿Dieron lo mismo?"}),e.jsx("p",{className:"cp-cierre-p",children:"Cada una separa las columnas con otra cosa y ordena distinto: así se ven las cuatro una abajo de la otra, con el mismo formato."}),e.jsx(k,{cmd:oe,bash:!0,donde:"en la terminal del contenedor"})]})]})]}),e.jsxs("div",{className:"section-h cp-sec",children:[e.jsx("h2",{children:"¿Cuál uso?"}),e.jsx("span",{className:"muted",children:"Las preguntas de siempre, con una tabla cada una"})]}),e.jsx(Re,{sel:i})]})}export{ze as CompararPage};
