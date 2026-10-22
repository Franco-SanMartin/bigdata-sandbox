"""Genera un dataset de ventas SUCIO (CSV), para practicar limpieza de datos (ETL).

Asi llegan los datos en la vida real: las ventas vienen de los sistemas de
las 4 sucursales, cada uno cargado a su manera y con errores de tipeo. Este
generador arma ventas correctas y despues les mete, A PROPOSITO y en
cantidades conocidas, la suciedad tipica:

  1. Duplicados: el 3% de los tickets aparece dos veces (se cargo dos veces
     el mismo ticket).
  2. Fechas en tres formatos: 2026-03-05 (ISO, el estandar), 05/03/2026
     (dia/mes/año, como se escribe en Argentina) y 20260305 (todo junto, de un
     sistema viejo).
  3. Texto desprolijo en producto, sucursal y medio de pago: mayusculas,
     espacios de mas y tildes ("  YERBA", "Débito ").
  4. Precios con formato argentino en el 15% de las filas: "2.575,00" en vez
     de 2575.
  5. Nulos (celdas vacias): cantidad en el 2% de las filas, precio en el 1% y
     medio de pago en el 5%.
  6. Errores de tipeo (outliers): cantidad multiplicada por 100 (0,5%: 300 en
     vez de 3), cantidad negativa (0,3%) y precio sin la coma decimal (0,5%:
     257500 en vez de 2.575,00).

Los precios suben un 3% por mes (inflacion): el mismo producto no vale lo
mismo en enero que en junio.

Al final muestra cuantas filas de cada problema metio: el ETL (etl_pandas.py
y etl_spark.py) tiene que encontrar exactamente esas.

Uso (adentro del contenedor, parado en /datos):

    python3 ejemplos/ml/generar_sucios.py                 # 100.000 tickets -> ventas_sucias.csv
    python3 ejemplos/ml/generar_sucios.py 500000 otro.csv  # otra cantidad y otro nombre

Columnas: ticket,fecha,sucursal,producto,cantidad,precio,medio_pago

Siempre genera los mismos datos (semilla fija): a todos les da lo mismo.
Solo usa Python, sin librerias: anda tambien en la version base de la imagen.
"""
import csv
import datetime
import sys
import random

# producto: (precio de lista en enero, peso relativo en las ventas)
PRODUCTOS = {
    "yerba": (2500, 30),
    "facturas": (900, 20),
    "azucar": (1200, 15),
    "galletitas": (1800, 14),
    "mate": (8000, 8),
    "bombilla": (3000, 6),
    "cafe": (6500, 5),
    "termo": (35000, 2),
}
SUCURSALES = ["Centro", "Norte", "Sur", "Oeste"]
MEDIOS_DE_PAGO = ["efectivo", "débito", "crédito", "qr"]
INICIO = datetime.date(2026, 1, 1)
DIAS = 181  # primer semestre
INFLACION_MENSUAL = 0.03

tickets = int(sys.argv[1]) if len(sys.argv) > 1 else 100000
archivo = sys.argv[2] if len(sys.argv) > 2 else "ventas_sucias.csv"

azar = random.Random(2026)
nombres = list(PRODUCTOS)
pesos = [PRODUCTOS[p][1] for p in nombres]

# ---------------------------------------------------------------------------
# 1. Ventas correctas
# ---------------------------------------------------------------------------
ventas = []
for ticket in range(1, tickets + 1):
    fecha = INICIO + datetime.timedelta(days=azar.randrange(DIAS))
    producto = azar.choices(nombres, weights=pesos)[0]
    precio = round(PRODUCTOS[producto][0] * (1 + INFLACION_MENSUAL) ** (fecha.month - 1))
    ventas.append({
        "ticket": ticket,
        "fecha": fecha,
        "sucursal": azar.choice(SUCURSALES),
        "producto": producto,
        "cantidad": azar.randint(1, 5),
        "precio": precio,
        "medio_pago": azar.choice(MEDIOS_DE_PAGO),
    })

# ---------------------------------------------------------------------------
# 2. Errores en los valores: cada problema en filas distintas, para poder
#    contar exactamente cuantas hay de cada uno
# ---------------------------------------------------------------------------
libres = list(range(tickets))
azar.shuffle(libres)


def tomar(proporcion):
    """Saca de 'libres' una proporcion de las filas y las devuelve."""
    n = round(tickets * proporcion)
    elegidas = libres[:n]
    del libres[:n]
    return elegidas


problemas = {}
for i in (elegidas := tomar(0.02)):
    ventas[i]["cantidad"] = None
problemas["cantidad vacia"] = len(elegidas)
for i in (elegidas := tomar(0.005)):
    ventas[i]["cantidad"] *= 100
problemas["cantidad x100"] = len(elegidas)
for i in (elegidas := tomar(0.003)):
    ventas[i]["cantidad"] = -ventas[i]["cantidad"]
problemas["cantidad negativa"] = len(elegidas)
for i in (elegidas := tomar(0.01)):
    ventas[i]["precio"] = None
problemas["precio vacio"] = len(elegidas)
for i in (elegidas := tomar(0.005)):
    ventas[i]["precio"] *= 100
problemas["precio sin coma decimal"] = len(elegidas)
for i in (elegidas := tomar(0.05)):
    ventas[i]["medio_pago"] = None
problemas["medio de pago vacio"] = len(elegidas)

# ---------------------------------------------------------------------------
# 3. Errores de formato (no cambian el valor, solo como esta escrito)
# ---------------------------------------------------------------------------


def fecha_desprolija(fecha):
    r = azar.random()
    if r < 0.55:
        return fecha.strftime("%Y-%m-%d")
    if r < 0.90:
        return fecha.strftime("%d/%m/%Y")
    return fecha.strftime("%Y%m%d")


def texto_desprolijo(texto):
    r = azar.random()
    if r < 0.10:
        texto = texto.upper()
    elif r < 0.25:
        texto = texto.capitalize()
    if azar.random() < 0.10:
        texto = " " * azar.randint(1, 2) + texto
    if azar.random() < 0.10:
        texto = texto + " "
    return texto


def precio_desprolijo(precio):
    if precio is None:
        return ""
    if azar.random() < 0.15:
        # 2575 -> "2.575,00"
        return f"{precio:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return str(precio)


filas = []
for v in ventas:
    filas.append([
        v["ticket"],
        fecha_desprolija(v["fecha"]),
        texto_desprolijo(v["sucursal"]),
        texto_desprolijo(v["producto"]),
        "" if v["cantidad"] is None else v["cantidad"],
        precio_desprolijo(v["precio"]),
        "" if v["medio_pago"] is None else texto_desprolijo(v["medio_pago"]),
    ])

# ---------------------------------------------------------------------------
# 4. Duplicados: copias exactas de algunos tickets, y todo mezclado
# ---------------------------------------------------------------------------
duplicados = azar.sample(filas, round(tickets * 0.03))
filas += [list(f) for f in duplicados]
problemas["tickets duplicados"] = len(duplicados)
azar.shuffle(filas)

with open(archivo, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["ticket", "fecha", "sucursal", "producto", "cantidad", "precio", "medio_pago"])
    w.writerows(filas)

print(f"Listo: {len(filas)} filas ({tickets} tickets + {len(duplicados)} duplicados) en {archivo}")
print("Problemas que se metieron a proposito (el ETL tiene que encontrar estos):")
for nombre, n in problemas.items():
    print(f"  {nombre:<26} {n:>7}")
quedan = tickets - problemas["cantidad vacia"] - problemas["cantidad x100"] - problemas["cantidad negativa"]
print(f"Tickets que tendrian que quedar despues de limpiar: {quedan}")
