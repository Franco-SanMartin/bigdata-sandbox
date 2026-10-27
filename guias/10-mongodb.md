# 10. MongoDB

Una base de datos **NoSQL de documentos**: en vez de tablas con columnas
fijas, guarda documentos (parecidos a JSON) que pueden tener cada uno sus
propios campos, con listas y subdocumentos adentro. Esta guía la recorre de
punta a punta con la base de ejemplo `tienda`: leer, filtrar, escribir,
agregar, unir colecciones e índices, comparando cada cosa con SQL.

[← 9. ZooKeeper y HA](09-zookeeper-ha.md) · [Índice](README.md) · Siguiente: [11. Problemas →](11-problemas.md)

## Antes de empezar

- MongoDB viene **apagado**: se prende con `-e MONGODB=si` en el `docker
  run`. El de la [guía 2](02-arrancar-y-apagar.md) ya lo trae. Si creaste el
  cluster sin eso, recrealo con `-e MONGODB=si` ([Cambiar los
  parámetros](02-arrancar-y-apagar.md#cambiar-los-parámetros)): HDFS y lo
  demás quedan.
- Suma ~1 GB de RAM: Docker con **7 GB**.
- Necesita un procesador con AVX ([guía 1](01-instalacion.md#tu-procesador-tiene-avx-para-mongodb)).
- Anda con cualquier `SERVICIOS`: para una clase solo de MongoDB alcanza con
  `-e SERVICIOS=hdfs -e MONGODB=si` (más liviano).
- La primera vez que prende, carga la base `tienda` sola (~10 s).

Comprobá que está prendido (adentro del contenedor):

<!-- prueba: adentro | espera: MongoDB -->
```bash
estado
```

En la parte *MongoDB* tiene que decir que está arriba, en el puerto 27017.

## Las ideas

| MongoDB | SQL (MySQL) | |
|---|---|---|
| base (`tienda`) | base | |
| **colección** (`pedidos`) | tabla | sin columnas fijas |
| **documento** | fila | cada uno con sus campos |
| campo | columna | puede ser una lista (*array*) u otro documento (*subdocumento*) |
| `_id` | clave primaria | todo documento tiene uno; si no lo das, MongoDB lo inventa |
| `$lookup` | `JOIN` | se usa poco: lo que va junto se guarda junto |

La base `tienda` es la misma empresa de la base MySQL de la
[guía 7](07-mysql-sqoop.md), pero con lo que a una base relacional le cuesta
guardar:

- **`productos`** (9): cada producto con **sus** datos. La yerba tiene
  `peso_kg` y `origen`; el termo, `capacidad_l`, `colores` y una lista de
  `resenas`; las facturas, `tipos`. En MySQL haría falta una columna para cada
  dato posible (casi todas vacías) o una tabla aparte de atributos.
- **`clientes`** (2.000): de cada uno se sabe lo que dejó. Algunos tienen
  `email`, otros `telefono`, otros una lista de `direcciones`; los mayoristas,
  un subdocumento `mayorista` con su CUIT y su descuento. El campo que no
  tiene **no está** (no es lo mismo que un `NULL`).
- **`pedidos`** (20.000): cada pedido guarda **adentro** sus `items`
  (producto, cantidad, precio), la forma de `entrega` (envío con ciudad y
  costo, o retiro en una sucursal) y, a veces, un `cupon`, una
  `calificacion` o una `nota`. En MySQL serían tres tablas y dos JOIN.

## La consola: mongosh

Adentro del contenedor:

<!-- prueba: no (abre una consola interactiva) -->
```bash
mongosh tienda
```

El prompt cambia a `tienda>`. Ahí se escribe JavaScript: cada línea se
ejecuta al dar Enter y muestra el resultado. Se sale con `exit`. Los bloques
`js` de esta guía se escriben ahí, de a una línea (o se pegan enteros).

Desde tu compu, sin entrar al contenedor, se abre directo con `docker exec -it
bigdata mongosh tienda`.

Para mirar qué hay:

<!-- prueba: adentro < mongosh --quiet tienda | espera: pedidos | espera: 20000 -->
```js
show dbs
show collections
db.productos.countDocuments()
db.clientes.countDocuments()
db.pedidos.countDocuments()
```

Tiene que dar 9 productos, 2000 clientes y 20000 pedidos. `db` es la base en
la que estás parado (`tienda`); `use otra_base` cambia (si no existe, se crea
cuando le escribís algo).

## Leer documentos

Un documento entero. El termo trae sus colores y sus reseñas **adentro**:

<!-- prueba: adentro < mongosh --quiet tienda | espera: acero inoxidable | espera: Llego con un golpe -->
```js
db.productos.findOne({ _id: "termo" })
```

```text
{
  _id: 'termo',
  categoria: 'accesorios',
  precio: 35000,
  capacidad_l: 1,
  material: 'acero inoxidable',
  garantia_meses: 24,
  colores: [ 'negro', 'verde', 'rojo' ],
  resenas: [
    { cliente_id: 12, estrellas: 5, texto: 'Mantiene el agua caliente todo el dia' },
    ...
```

Comparalo con el azúcar: tiene otros campos.

<!-- prueba: adentro < mongosh --quiet tienda | espera: comun -->
```js
db.productos.findOne({ _id: "azucar" })
```

`find` devuelve **todos** los que cumplen el filtro (el primer `{}` es el
filtro; vacío = todos). El segundo `{}` es la **proyección**: qué campos
mostrar (`1` = sí; el `_id` sale siempre, salvo `_id: 0`).

<!-- prueba: adentro < mongosh --quiet tienda | espera: bombilla | espera: yerba organica -->
```js
db.productos.find({ categoria: "accesorios" }, { precio: 1 })
db.productos.find({}, { categoria: 1, precio: 1 }).sort({ precio: -1 }).limit(3)
db.productos.find({ categoria: "infusiones" }, { _id: 1 })
```

| MongoDB | SQL |
|---|---|
| `db.productos.find({ categoria: "accesorios" }, { precio: 1 })` | `SELECT producto, precio FROM productos WHERE categoria = 'accesorios'` |
| `.sort({ precio: -1 })` | `ORDER BY precio DESC` (`1` = ascendente) |
| `.limit(3)` | `LIMIT 3` |

En la consola, `find` muestra de a 20 documentos: `it` muestra los 20
siguientes.

## Filtros

Con **operadores** (empiezan con `$`):

<!-- prueba: adentro < mongosh --quiet tienda | espera: termo -->
```js
db.productos.find({ precio: { $gt: 5000 } }, { precio: 1 })
db.productos.find({ precio: { $gte: 1000, $lte: 3000 } }, { precio: 1 })
db.productos.find({ _id: { $in: ["mate", "termo", "bombilla"] } }, { precio: 1 })
db.pedidos.countDocuments({ canal: "telefono", total: { $gt: 50000 } })
db.pedidos.countDocuments({ $or: [ { canal: "telefono" }, { calificacion: 1 } ] })
```

| Operador | Significa | SQL |
|---|---|---|
| `$gt`, `$gte`, `$lt`, `$lte` | mayor, mayor o igual, menor, menor o igual | `>`, `>=`, `<`, `<=` |
| `$ne` | distinto | `<>` |
| `$in: [...]` | alguno de la lista | `IN (...)` |
| dos condiciones en el mismo `{}` | y | `AND` |
| `$or: [ {...}, {...} ]` | o | `OR` |

### Campos que no todos tienen: `$exists`

<!-- prueba: adentro < mongosh --quiet tienda | espera: 1417 | espera: 101 | espera: 2014 -->
```js
db.clientes.countDocuments({ email: { $exists: true } })
db.clientes.countDocuments({ email: { $exists: false }, telefono: { $exists: false } })
db.clientes.countDocuments({ mayorista: { $exists: true } })
db.pedidos.countDocuments({ cupon: { $exists: true } })
```

Tiene que dar 1417 clientes con email, 101 mayoristas y 2014 pedidos con
cupón. En SQL sería `WHERE email IS NOT NULL`... si existiera la columna.

### Adentro de subdocumentos y listas

Un campo de un subdocumento se nombra **con punto**, entre comillas. Una
lista se busca como si fuera un valor: encuentra el documento si **algún**
elemento cumple.

<!-- prueba: adentro < mongosh --quiet tienda | espera: termo -->
```js
db.clientes.countDocuments({ "mayorista.descuento_pct": 15 })
db.clientes.countDocuments({ "direcciones.ciudad": "Quilmes" })
db.pedidos.countDocuments({ "entrega.tipo": "retiro" })
db.productos.find({ colores: "negro" }, { colores: 1 })
db.productos.find({ "resenas.estrellas": { $lte: 2 } }, { resenas: 1 })
db.pedidos.countDocuments({ "items.producto": "termo", "items.cantidad": { $gte: 4 } })
db.pedidos.countDocuments({ items: { $elemMatch: { producto: "termo", cantidad: { $gte: 4 } } } })
db.pedidos.countDocuments({ items: { $size: 3 } })
```

Las dos con `termo` dan distinto: la primera cuenta los pedidos que tienen un
termo y **algún** ítem (cualquiera) con 4 o más unidades; `$elemMatch` pide
que el **mismo** ítem cumpla las dos cosas (4 termos o más).

### Valores distintos

<!-- prueba: adentro < mongosh --quiet tienda | espera: telefono -->
```js
db.pedidos.distinct("canal")
db.clientes.distinct("direcciones.ciudad")
```

## Escribir: insertar, modificar, borrar

Para no tocar los datos de ejemplo, en una colección de práctica (se crea sola
con el primer `insert`). El `drop` del principio la borra, para poder repetir
todo de cero:

<!-- prueba: adentro < mongosh --quiet tienda | espera: insertedId | espera: modifiedCount: 1 | espera: deletedCount: 1 -->
```js
db.practica.drop()
db.practica.insertOne({ _id: 1, nombre: "Ana", materias: ["Big Data"] })
db.practica.insertMany([
  { _id: 2, nombre: "Bruno", materias: ["Big Data", "Redes"], email: "bruno@correo.com" },
  { _id: 3, nombre: "Carla" }
])
db.practica.updateOne({ _id: 1 }, { $set: { email: "ana@correo.com" }, $push: { materias: "Bases de datos" } })
db.practica.updateMany({}, { $inc: { visitas: 1 } })
db.practica.deleteOne({ _id: 3 })
db.practica.find()
```

| MongoDB | SQL |
|---|---|
| `insertOne({...})`, `insertMany([...])` | `INSERT INTO ... VALUES ...` |
| `updateOne(filtro, { $set: { campo: valor } })` | `UPDATE ... SET campo = valor WHERE ...` (a una fila) |
| `updateMany(filtro, {...})` | `UPDATE ... WHERE ...` (a todas las que cumplen) |
| `$inc: { visitas: 1 }` | `SET visitas = visitas + 1` |
| `$push` / `$pull` | agregar / sacar un elemento de una lista (en SQL, otra tabla) |
| `$unset: { campo: "" }` | sacar el campo de ese documento (en SQL, `ALTER TABLE` para todas las filas) |
| `deleteOne(filtro)`, `deleteMany(filtro)` | `DELETE FROM ... WHERE ...` |
| `db.practica.drop()` | `DROP TABLE practica` |

Fijate que `$set` **agregó** el campo `email` a Ana sin cambiar a los demás:
no hay esquema que modificar.

## Agregación: el GROUP BY de MongoDB

`aggregate` recibe un **pipeline**: una lista de etapas, y cada una le pasa
sus documentos a la siguiente.

| Etapa | Qué hace | SQL |
|---|---|---|
| `$match` | filtra | `WHERE` (o `HAVING` si va después de `$group`) |
| `$group` | agrupa por `_id` y calcula (`$sum`, `$avg`, `$min`, `$max`, `$count`) | `GROUP BY` |
| `$sort`, `$limit` | ordena, corta | `ORDER BY`, `LIMIT` |
| `$project` | elige o calcula campos | `SELECT` |
| `$unwind` | abre una lista: un documento por elemento | (el `JOIN` con la tabla de renglones) |
| `$lookup` | trae documentos de otra colección | `JOIN` |

Pedidos y facturación por canal:

<!-- prueba: adentro < mongosh --quiet tienda | espera: telefono -->
```js
db.pedidos.aggregate([
  { $group: { _id: "$canal", pedidos: { $sum: 1 }, facturado: { $sum: "$total" } } },
  { $sort: { facturado: -1 } }
])
```

`"$canal"` (con `$`) es *el valor del campo* canal. En SQL: `SELECT canal,
COUNT(*), SUM(total) FROM pedidos GROUP BY canal ORDER BY 3 DESC`.

El total de todos los pedidos (`_id: null` = un solo grupo con todo):

<!-- prueba: adentro < mongosh --quiet tienda | espera: 441242420 -->
```js
db.pedidos.aggregate([ { $group: { _id: null, total: { $sum: "$total" } } } ])
```

Tiene que dar 441242420.

### Abrir las listas: `$unwind`

Para sumar por **producto** hay que llegar a cada ítem. `$unwind` convierte
un pedido con 3 ítems en 3 documentos, uno por ítem:

<!-- prueba: adentro < mongosh --quiet tienda | espera: 32734 -->
```js
db.pedidos.aggregate([
  { $unwind: "$items" },
  { $group: { _id: "$items.producto",
              unidades: { $sum: "$items.cantidad" },
              facturado: { $sum: { $multiply: ["$items.cantidad", "$items.precio"] } } } },
  { $sort: { facturado: -1 } }
])
```

La yerba tiene que dar 32734 unidades.

### Unir colecciones: `$lookup`

Los 3 clientes que más gastaron, con su nombre (que está en `clientes`):

<!-- prueba: adentro < mongosh --quiet tienda | espera: gastado -->
```js
db.pedidos.aggregate([
  { $group: { _id: "$cliente_id", gastado: { $sum: "$total" }, pedidos: { $sum: 1 } } },
  { $sort: { gastado: -1 } },
  { $limit: 3 },
  { $lookup: { from: "clientes", localField: "_id", foreignField: "_id", as: "cliente" } },
  { $project: { gastado: 1, pedidos: 1, nombre: { $first: "$cliente.nombre" } } }
])
```

En SQL: `SELECT c.nombre, SUM(p.total) ... FROM pedidos p JOIN clientes c ON
p.cliente_id = c.id GROUP BY ... ORDER BY 2 DESC LIMIT 3`.

## Índices

Sin índice, para encontrar los pedidos de un cliente MongoDB recorre los
20.000 (*COLLSCAN*). La base trae dos índices en `pedidos`: por `cliente_id` y
por `items.producto`. `explain` muestra cómo resolvió una búsqueda:

<!-- prueba: adentro < mongosh --quiet tienda | espera: cliente_id_1 | espera: IXSCAN | espera: COLLSCAN -->
```js
db.pedidos.getIndexes().map(i => i.name)
db.pedidos.find({ cliente_id: 42 }).explain("executionStats").executionStats.totalDocsExamined
db.pedidos.find({ cliente_id: 42 }).explain().queryPlanner.winningPlan.inputStage.stage
db.pedidos.find({ canal: "telefono" }).explain().queryPlanner.winningPlan.stage
```

- Por `cliente_id` usa el índice (`IXSCAN`) y lee solo los pedidos de ese
  cliente.
- Por `canal` no hay índice: `COLLSCAN`, lee todos.

Crear uno es `db.pedidos.createIndex({ canal: 1 })` (y borrarlo,
`db.pedidos.dropIndex("canal_1")`).

## Las consultas de ejemplo

`ejemplos/consultas_mongo.js` tiene todo lo anterior junto, con su
equivalente en SQL al lado de cada consulta. Se corre entero así (adentro):

<!-- prueba: adentro | espera: etapa: IXSCAN | espera: en_oferta: true -->
```bash
mongosh --quiet tienda ejemplos/consultas_mongo.js
```

En un script, a diferencia de la consola, los resultados se muestran con
`print(...)` y `printjson(...)`, y los `find` necesitan `.toArray()`.

## Desde tu compu

Una consulta suelta, sin entrar al contenedor:

<!-- prueba: compu | espera: 20000 -->
```bash
docker exec bigdata mongosh --quiet tienda --eval "db.pedidos.countDocuments()"
```

### Desde tu compu: Compass

MongoDB Compass (https://www.mongodb.com/products/tools/compass) es la
aplicación gráfica de MongoDB: muestra las colecciones, los documentos y
arma consultas y agregaciones con el mouse. Con el `docker run` de la
[guía 2](02-arrancar-y-apagar.md) (que expone el puerto 27017), en Compass:
*New connection* →

```text
mongodb://localhost:27017
```

→ *Connect*. No pide usuario ni clave: por eso el puerto queda solo para tu
compu (`127.0.0.1`).

## Recargar la base de ejemplo

Si borraste o cambiaste algo y querés la base como vino (adentro; borra la
base `tienda` entera, también la colección `practica`):

<!-- prueba: adentro | espera: 20000 pedidos -->
```bash
mongosh --quiet ejemplos/tienda_mongo.js
```

## Resumen: SQL y MongoDB

| Quiero... | SQL | MongoDB |
|---|---|---|
| ver todo | `SELECT * FROM t` | `db.t.find()` |
| filtrar | `WHERE a = 1 AND b > 2` | `find({ a: 1, b: { $gt: 2 } })` |
| algunas columnas | `SELECT a, b` | `find({}, { a: 1, b: 1 })` |
| contar | `SELECT COUNT(*) ... WHERE ...` | `countDocuments({...})` |
| ordenar y cortar | `ORDER BY a DESC LIMIT 5` | `.sort({ a: -1 }).limit(5)` |
| agrupar | `GROUP BY` | `aggregate([{ $group: ... }])` |
| unir | `JOIN` | `$lookup` (o guardar junto lo que va junto) |
| insertar | `INSERT` | `insertOne`, `insertMany` |
| modificar | `UPDATE ... SET` | `updateOne`, `updateMany` con `$set` |
| borrar | `DELETE` | `deleteOne`, `deleteMany` |
| agregar un campo | `ALTER TABLE` (a todas las filas) | `$set` en los documentos que lo tengan |
| índice | `CREATE INDEX` | `createIndex` |

## Para profundizar

- Teoría: [MongoDB y NoSQL](base/teoria/09-mongodb.md): el porqué y cómo funciona por dentro.
- Evaluación: [MongoDB y NoSQL](base/evaluacion/09-mongodb.md): preguntas y ejercicios con sus respuestas.
- Referencia: [MongoDB](base/referencia.md#mongodb): comandos, opciones y puertos.
