"""ETL de ventas sucias con pandas + numpy: de ventas_sucias.csv a una tabla limpia.

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
iso = f.str.fullmatch(r"\d{4}-\d{2}-\d{2}", na=False)        # 2026-03-05
argentina = f.str.fullmatch(r"\d{2}/\d{2}/\d{4}", na=False)  # 05/03/2026
junta = f.str.fullmatch(r"\d{8}", na=False)                  # 20260305
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
print(f"\nMetodo IQR sobre cantidad: rango aceptado {q1 - 1.5 * iqr:g} a {q3 + 1.5 * iqr:g},"
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

print("\nAsi quedan:")
print(ventas.head(8).to_string(index=False))
print("\nTipos de cada columna:")
print(ventas.dtypes.to_string())
mb = ventas.memory_usage(deep=True).sum() / 1024 ** 2
print(f"\nMemoria que ocupa la tabla en pandas: {mb:.1f} MB")

# ---------------------------------------------------------------------------
# Resumen (etl_spark.py imprime el mismo, para comparar)
# ---------------------------------------------------------------------------
print("\n=== RESUMEN DEL ETL ===")
for paso, n in cuenta.items():
    print(f"  {paso:<40} {n:>9}")
print(f"  {'facturado total':<40} {ventas['importe'].sum():>15}")
print("=== POR SUCURSAL ===")
por_sucursal = ventas.groupby("sucursal").agg(filas=("ticket", "size"), facturado=("importe", "sum"))
for sucursal, fila in por_sucursal.sort_index().iterrows():
    print(f"  {sucursal:<10} {fila['filas']:>9} {fila['facturado']:>15}")
print(f"\nGuardado en {salida} ({time.perf_counter() - inicio:.1f} s en total)")
