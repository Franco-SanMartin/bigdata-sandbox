"""Genera un dataset de ventas de prueba (CSV) para practicar.

Uso (adentro del contenedor, parado en /datos):

    python3 ejemplos/generar_ventas.py                  # 200.000 filas en ventas_grandes.csv
    python3 ejemplos/generar_ventas.py 1000000 otro.csv # 1 millon de filas, otro nombre

Columnas: fecha,sucursal,producto,cantidad,precio (con encabezado), las
mismas que ejemplos/ventas.csv.

Siempre genera los mismos datos (semilla fija): todos los que lo corran con la
misma cantidad de filas obtienen los mismos resultados y los pueden comparar.
"""
import datetime
import os
import random
import sys

# producto: (precio unitario en pesos, peso relativo en las ventas)
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
INICIO = datetime.date(2026, 1, 1)
DIAS = 181  # primer semestre

filas = int(sys.argv[1]) if len(sys.argv) > 1 else 200000
archivo = sys.argv[2] if len(sys.argv) > 2 else "ventas_grandes.csv"

azar = random.Random(2026)
nombres = list(PRODUCTOS)
pesos = [PRODUCTOS[p][1] for p in nombres]

with open(archivo, "w", newline="\n") as f:
    f.write("fecha,sucursal,producto,cantidad,precio\n")
    for _ in range(filas):
        fecha = INICIO + datetime.timedelta(days=azar.randrange(DIAS))
        sucursal = azar.choice(SUCURSALES)
        producto = azar.choices(nombres, weights=pesos)[0]
        cantidad = azar.randint(1, 5)
        f.write(f"{fecha},{sucursal},{producto},{cantidad},{PRODUCTOS[producto][0]}\n")

mb = os.path.getsize(archivo) / 1024 / 1024
print(f"Listo: {filas} filas en {archivo} ({mb:.1f} MB)")
