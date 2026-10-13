"""Mapper de Hadoop Streaming: ventas por producto.

MapReduce "a mano" en Python: Hadoop le pasa a este script las lineas del CSV
por la entrada estandar (un mapper por cada bloque del archivo) y el script
emite pares clave <TAB> valor. Hadoop los ordena por clave y se los pasa al
reducer.

Por cada venta emite:  producto <TAB> cantidad <TAB> importe

Probarlo sin Hadoop:
    head ejemplos/ventas.csv | python3 ejemplos/mapper.py
"""
import sys

for linea in sys.stdin:
    campos = linea.strip().split(",")
    if len(campos) != 5 or campos[0] == "fecha":  # encabezado o linea rota
        continue
    fecha, sucursal, producto, cantidad, precio = campos
    print(f"{producto}\t{cantidad}\t{int(cantidad) * int(precio)}")
