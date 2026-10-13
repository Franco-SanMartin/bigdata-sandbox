"""Reducer de Hadoop Streaming: ventas por producto.

Recibe las lineas del mapper YA ORDENADAS por clave (producto): todas las de un
mismo producto llegan juntas. Suma mientras la clave no cambia y, cuando
cambia, emite el total del producto anterior.

Emite:  producto <TAB> unidades <TAB> facturado

Probarlo sin Hadoop (el sort hace de "shuffle"):
    cat ejemplos/ventas.csv | python3 ejemplos/mapper.py | sort | python3 ejemplos/reducer.py
"""
import sys

actual, unidades, facturado = None, 0, 0

for linea in sys.stdin:
    producto, cantidad, importe = linea.rstrip("\n").split("\t")
    if producto != actual:
        if actual is not None:
            print(f"{actual}\t{unidades}\t{facturado}")
        actual, unidades, facturado = producto, 0, 0
    unidades += int(cantidad)
    facturado += int(importe)

if actual is not None:
    print(f"{actual}\t{unidades}\t{facturado}")
