# 6. MongoDB + pandas

Leer los pedidos de MongoDB desde Python con pymongo y convertirlos en tablas
de pandas: los subdocumentos pasan a columnas, los campos que no todos tienen
quedan vacíos y la lista de ítems pasa a una tabla aparte. Es el paso que hay
que hacer siempre antes de analizar o modelar datos que vienen de una base de
documentos.

[← 5. Los mismos modelos con Spark MLlib](05-modelos-spark-mllib.md) · [Índice de ml](README.md) · Siguiente: [7. Problemas de `ml` →](07-problemas.md)

## Antes de empezar

- El contenedor creado con `-e MONGODB=si` (el `docker run` de la
  [guía 1](01-arrancar-y-jupyterlab.md) ya lo trae). Si lo creaste sin eso,
  hay que recrearlo: ver la [guía 10 de base](../10-mongodb.md).
- MongoDB necesita un procesador con AVX
  ([guía 1 de base](../01-instalacion.md#tu-procesador-tiene-avx-para-mongodb)).
- Conviene haber hecho la [guía 10](../10-mongodb.md): acá se usa la misma
  base `tienda`, que se carga sola la primera vez que prende MongoDB.

Comprobá que está prendido:

<!-- prueba: adentro | espera: 20000 -->
```bash
mongosh --quiet tienda --eval "db.pedidos.countDocuments()"
```

Tiene que dar 20000 pedidos.

## Qué vamos a hacer y por qué

Un pedido de la base `tienda` es un **documento**, no una fila: tiene
subdocumentos (`entrega`, `cupon`), una lista (`items`) y campos que solo
algunos pedidos tienen (`cupon`, `calificacion`, `nota`). Los envíos tienen
ciudad y costo; los retiros, sucursal. pandas, scikit-learn y Spark necesitan
**tablas**: filas y columnas fijas. Hay que aplanar.

## Correr el ejemplo

<!-- prueba: adentro | espera: 20000 pedidos leidos de MongoDB | espera: MongoDB calcula lo mismo: si -->
```bash
python3 ejemplos/ml/mongo_pandas.py
```

Hace tres cosas. Abajo, qué muestra cada una (los números salen del generador
de la base, que usa una semilla fija: son siempre los mismos).

### 1. Un pedido, tal cual llega

`pymongo` devuelve cada documento como un **diccionario** de Python. El
primero es un pedido por la web de un termo (2 × 35000), con envío a
Quilmes sin costo y calificación 4. Las fechas llegan como `datetime` de
Python, no como texto.

### 2. Los pedidos como tabla: `json_normalize`

`pd.json_normalize(pedidos)` pone cada campo como columna y cada campo de un
subdocumento como una columna con **punto**: `entrega.tipo`,
`entrega.ciudad`, `entrega.costo`, `entrega.sucursal`, `cupon.codigo`,
`cupon.descuento_pct`. La tabla tiene las columnas de **todos** los pedidos
juntos, y donde un pedido no tiene el campo queda `NaN`. El script muestra
cuántos tienen cada uno:

| Campo | Pedidos que lo tienen | Por qué |
|---|---:|---|
| `_id`, `cliente_id`, `fecha`, `canal`, `total`, `entrega.tipo` | 20000 | Todos |
| `entrega.ciudad`, `entrega.costo` | 12099 | Solo los envíos (60 %) |
| `entrega.sucursal` | 7901 | Solo los retiros |
| `calificacion` | 6123 | El 30 % calificó |
| `cupon.codigo`, `cupon.descuento_pct` | 2014 | El 10 % usó cupón (el mismo 2014 de la guía 10) |
| `nota` | 974 | El 5 % dejó una nota |

`items` se saca de esta tabla (`drop(columns="items")`): es una lista, y una
lista no entra en una celda de forma útil.

### 3. Los ítems como otra tabla: `record_path`

<!-- prueba: no (fragmento de mongo_pandas.py: se corre con el script entero) -->
```python
items = pd.json_normalize(pedidos, record_path="items", meta=["_id", "canal", ["entrega", "tipo"]])
```

- `record_path="items"`: una fila por **ítem**, no por pedido. Salen 42497
  ítems de los 20000 pedidos.
- `meta=[...]`: datos del pedido que se copian al lado de cada ítem (el
  `_id`, el canal y `entrega.tipo`), para poder agrupar por ellos.

Es lo mismo que `$unwind` en MongoDB, y lo que en SQL sería la tabla de
renglones de pedido con un `JOIN`. Con esa tabla, unidades y facturado por
producto:

| Producto | Unidades | Facturado |
|---|---:|---:|
| termo | 2700 | 94500000 |
| mate | 10730 | 85840000 |
| yerba | 32734 | 81835000 |
| cafe | 7072 | 45968000 |
| galletitas | 17863 | 32153400 |
| bombilla | 8003 | 24009000 |
| azucar | 19387 | 23264400 |
| yerba organica | 5510 | 23142000 |
| facturas | 23736 | 21362400 |

La yerba da las mismas 32734 unidades que el `$unwind` + `$group` de la
guía 10.

Al final, el script le pide la misma cuenta a MongoDB con `aggregate` y
compara: *MongoDB calcula lo mismo: si*.

## ¿pandas o MongoDB?

Las dos formas dan lo mismo, pero no cuestan lo mismo:

| | Traer todo a pandas | `aggregate` en MongoDB |
|---|---|---|
| Qué viaja por la red | Los 20000 pedidos enteros | Solo el resultado (9 filas) |
| Dónde se calcula | En Python, en tu memoria | En la base, que tiene índices |
| Para | Análisis libre, gráficos, modelos (que necesitan la tabla) | Totales y filtros que se repiten |

La regla práctica: filtrar y agrupar **en la base** todo lo que se pueda, y
traer a pandas solo lo que hace falta. `find` acepta un filtro y una
proyección, igual que en mongosh.

## Seguir en un notebook

<!-- prueba: no (celda de JupyterLab) -->
```python
import pandas as pd
from pymongo import MongoClient

db = MongoClient("mongodb://localhost:27017")["tienda"]
pedidos = list(db.pedidos.find({}, {"items": 0}))
tabla = pd.json_normalize(pedidos)
tabla.dtypes
```

La proyección `{"items": 0}` no trae los ítems: viaja menos. Mirá los tipos:
`calificacion`, `entrega.costo` y `cupon.descuento_pct` salen `float64`
aunque en MongoDB son enteros. Es por los `NaN`: en pandas, un entero no
puede estar vacío, así que la columna pasa a decimal.

<!-- prueba: no (celda de JupyterLab) -->
```python
tabla.groupby("canal")["total"].agg(["count", "sum"])
```

Pedidos y facturación por canal: app 10070 pedidos, web 6691 y teléfono 3239.
Es el mismo `$group` por canal de la guía 10.

<!-- prueba: no (celda de JupyterLab) -->
```python
tabla.groupby("entrega.tipo")["total"].mean().round(0)
```

El pedido promedio con envío (unos 22.550) es un poco más caro que con
retiro (unos 21.300): el total de los envíos incluye el costo de envío.

Para pasar estos datos a un modelo hay que decidir qué hacer con los `NaN`:
un pedido sin cupón tiene descuento 0 (`fillna(0)`), pero uno sin calificación
**no** tiene calificación 0. Es la misma decisión de la
[teoría 2](teoria/02-preparacion-de-datos.md).

## Qué hiciste

- Leíste MongoDB desde Python con `pymongo` y comprobaste que pandas y
  `aggregate` dan lo mismo.
- Aplanaste documentos con `json_normalize`: subdocumentos a columnas con
  punto, campos ausentes a `NaN`, listas a otra tabla con `record_path`.
- Viste cuándo conviene calcular en la base y cuándo en pandas.

Siguiente: [7. Problemas de `ml` →](07-problemas.md)
