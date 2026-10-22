"""De MongoDB a pandas: documentos con campos variables -> una tabla.

Lee los pedidos de la base "tienda" de MongoDB (tienda_mongo.js) con pymongo
y los aplana en tablas de pandas:
  - pd.json_normalize convierte cada subdocumento en columnas
    ("entrega.tipo", "cupon.codigo"...). Los campos que un pedido no tiene
    quedan como NaN: la tabla se ensancha con todo lo que exista en algun pedido.
  - Los items (un array adentro de cada pedido) pasan a una tabla aparte, una
    fila por item: lo mismo que hace $unwind en MongoDB.

Uso (adentro del contenedor, parado en /datos; MongoDB prendido con MONGODB=si):

    python3 ejemplos/ml/mongo_pandas.py
"""
import pandas as pd
from pymongo import MongoClient

cliente = MongoClient("mongodb://localhost:27017", serverSelectionTimeoutMS=5000)
db = cliente["tienda"]
pedidos = list(db.pedidos.find())
print(f"{len(pedidos)} pedidos leidos de MongoDB. Uno de ejemplo:\n{pedidos[0]}\n")

# 1. Los pedidos, con los subdocumentos como columnas (sin el array de items)
tabla = pd.json_normalize(pedidos).drop(columns="items")
print("Columnas de la tabla (los campos de TODOS los pedidos juntos):")
print(", ".join(tabla.columns))
print("\nCuantos pedidos tienen cada campo (los demas quedan NaN):")
print(tabla.notna().sum().sort_values(ascending=False).to_string())

# 2. Una fila por item, con datos del pedido al lado (como un JOIN)
items = pd.json_normalize(pedidos, record_path="items", meta=["_id", "canal", ["entrega", "tipo"]])
items["importe"] = items["cantidad"] * items["precio"]
print(f"\n{len(items)} items. Unidades y facturado por producto (como el $unwind + $group de"
      " consultas_mongo.js):")
resumen = (items.groupby("producto")
           .agg(unidades=("cantidad", "sum"), facturado=("importe", "sum"))
           .sort_values("facturado", ascending=False))
print(resumen.to_string())

# 3. Lo mismo calculado por MongoDB (el trabajo lo hace la base, y a Python
#    llega solo el resultado): tiene que dar igual
en_mongo = db.pedidos.aggregate([
    {"$unwind": "$items"},
    {"$group": {"_id": "$items.producto", "unidades": {"$sum": "$items.cantidad"}}},
])
iguales = all(resumen.loc[g["_id"], "unidades"] == g["unidades"] for g in en_mongo)
print(f"\nMongoDB calcula lo mismo: {'si' if iguales else 'NO'}")
