# Evaluación 9. MongoDB y NoSQL

[← 8. ZooKeeper y HA](08-zookeeper-ha.md) · [Evaluación](README.md) · Teoría: [MongoDB y NoSQL](../teoria/09-mongodb.md) · Guía: [10. MongoDB](../../10-mongodb.md)

## Opción múltiple

**1.** ¿Qué familia de bases NoSQL es MongoDB?

- a) Clave-valor.
- b) De documentos: cada registro es un documento (BSON, parecido a JSON) que
  se puede consultar por dentro.
- c) De columnas anchas.
- d) De grafos.

<details><summary>Respuesta</summary>

**b)** La diferencia con una clave-valor es que la base entiende el contenido
del documento: se puede filtrar por un campo, indexarlo y agregarlo.

- a) Redis o DynamoDB son clave-valor: el valor es opaco.
- c) Cassandra y HBase son de columnas anchas.
- d) Neo4j es de grafos.

</details>

**2.** En la base `tienda`, 1417 de los 2000 clientes tienen `email`. ¿Qué
tienen los otros 583 en ese campo?

- a) `NULL`.
- b) Nada: el campo no existe en esos documentos (`$exists: false`).
- c) Un texto vacío.
- d) Un error.

<details><summary>Respuesta</summary>

**b)** Es el esquema flexible: cada documento tiene los campos que necesita.
En una tabla, todas las filas tienen la columna, con `NULL` si falta.

- a) Un `null` explícito sería un valor guardado; acá el campo no está.
- c) Tampoco hay un texto vacío.
- d) No es un error: es lo normal en MongoDB.

</details>

**3.** ¿Por qué los ítems de un pedido van **adentro** del pedido y el
cliente va **aparte** (con `cliente_id`)?

- a) Por casualidad.
- b) Los ítems se leen siempre con su pedido y son solo de él: se embeben. El
  cliente se comparte entre muchos pedidos y cambia aparte: se referencia,
  para no repetirlo ni tener que actualizarlo en cada pedido.
- c) Porque MongoDB no permite listas de clientes.
- d) Porque los clientes son más que los pedidos.

<details><summary>Respuesta</summary>

**b)** La regla de diseño: embeber lo que se lee junto, referenciar lo que se
comparte o crece sin límite.

- a) Es la decisión central del modelo.
- c) Permite listas de lo que sea.
- d) Son 2.000 clientes y 20.000 pedidos: al revés.

</details>

**4.** Las dos consultas siguientes dan distinto (651 y 354). ¿Por qué?

```text
db.pedidos.countDocuments({ "items.producto": "termo", "items.cantidad": { $gte: 4 } })
db.pedidos.countDocuments({ items: { $elemMatch: { producto: "termo", cantidad: { $gte: 4 } } } })
```

- a) Porque la segunda usa un índice.
- b) La primera pide un ítem que sea termo y **algún** ítem (cualquiera) con
  4 o más; `$elemMatch` pide que el **mismo** ítem cumpla las dos cosas.
- c) Porque `$elemMatch` cuenta ítems y no pedidos.
- d) Es un error de MongoDB.

<details><summary>Respuesta</summary>

**b)** Un pedido con 1 termo y 5 yerbas entra en la primera y no en la
segunda.

- a) El índice cambia la velocidad, no el resultado.
- c) `countDocuments` siempre cuenta documentos (pedidos).
- d) Es la semántica de las condiciones sobre listas.

</details>

**5.** En un `aggregate`, ¿qué hace `$unwind: "$items"`?

- a) Borra los ítems.
- b) Convierte cada pedido en un documento por ítem, para poder agrupar por
  producto.
- c) Ordena los ítems.
- d) Une los pedidos con los productos.

<details><summary>Respuesta</summary>

**b)** Un pedido con 3 ítems pasa a ser 3 documentos. Después, `$group` por
`$items.producto` suma como un `GROUP BY` sobre una tabla de renglones.

- a) No borra nada: es dentro del pipeline.
- c) Ordenar es `$sort`.
- d) Unir colecciones es `$lookup`.

</details>

**6.** ¿Qué significa `_id: null` en un `$group`?

- a) Que agrupe los documentos sin `_id`.
- b) Un solo grupo con todos los documentos: sirve para un total general.
- c) Que borre el `_id`.
- d) Un error.

<details><summary>Respuesta</summary>

**b)** Es `SELECT SUM(total) FROM pedidos`, sin `GROUP BY`. Con la base de
ejemplo da 441242420.

- a) Todos los documentos tienen `_id`.
- c) No modifica los documentos.
- d) Es la forma estándar.

</details>

**7.** `explain()` dice `COLLSCAN` para `find({ canal: "telefono" })`. ¿Qué
significa?

- a) Que usó un índice.
- b) Que recorrió toda la colección, porque no hay un índice sobre `canal`.
- c) Que la consulta falló.
- d) Que la colección está vacía.

<details><summary>Respuesta</summary>

**b)** Por `cliente_id` sí hay índice, y dice `IXSCAN`.

- a) Con índice sería `IXSCAN`.
- c) La consulta funciona, solo que más lenta.
- d) Tiene 20.000 pedidos.

</details>

**8.** ¿Por qué no conviene crear un índice para cada campo?

- a) Porque MongoDB permite uno solo.
- b) Porque cada índice ocupa memoria y disco, y cada escritura tiene que
  actualizarlos todos: se crean para las consultas frecuentes.
- c) Porque los índices cambian los resultados.
- d) Porque solo sirven para `_id`.

<details><summary>Respuesta</summary>

**b)** Leer es más rápido, escribir más lento. Es el mismo equilibrio que en
una base relacional.

- a) Puede haber muchos (`pedidos` trae dos además del de `_id`).
- c) Solo cambian la velocidad.
- d) La base trae índices por `cliente_id` y por `items.producto`.

</details>

**9.** Según el teorema **CAP**, ¿qué tiene que elegir un sistema distribuido
cuando hay una partición de red?

- a) Entre consistencia y disponibilidad.
- b) Entre SQL y NoSQL.
- c) Entre replicación y sharding.
- d) Nada: puede tener las tres cosas siempre.

<details><summary>Respuesta</summary>

**a)** Si dos grupos de servidores no se ven, o se niega a responder en uno
(consistencia) o responde con datos que pueden estar viejos
(disponibilidad). MongoDB con un replica set tiende a la consistencia: un
primario aislado deja de aceptar escrituras.

- b) No es una elección del teorema.
- c) Son técnicas, no las propiedades del teorema.
- d) Durante una partición no se pueden tener las tres.

</details>

**10.** ¿Para qué es más adecuado MongoDB que HDFS con Hive o Spark?

- a) Para analizar todo el historial de ventas de una vez.
- b) Para servir a una aplicación: leer y escribir documentos de a uno, con
  respuesta en milisegundos.
- c) Para guardar archivos de varios terabytes.
- d) Para correr trabajos MapReduce.

<details><summary>Respuesta</summary>

**b)** MongoDB es una base operativa (OLTP); el cluster es para análisis
masivos (OLAP). Es común usarlos juntos: la aplicación en MongoDB y una copia
en el data lake para analizar.

- a) Para eso está el cluster.
- c) Un documento tiene un máximo de 16 MB; los archivos grandes van a HDFS.
- d) MongoDB no corre MapReduce de Hadoop.

</details>

## Desarrollo

**1.** Diseñá en MongoDB un pedido de la tienda y explicá qué embebiste y qué
referenciaste. Compará con el diseño relacional de la base MySQL.

<details><summary>Respuesta modelo</summary>

Un documento por pedido, con lo que se lee junto adentro:

- `items`: una lista de `{ producto, cantidad, precio }`. Embebido: son del
  pedido, se muestran con él y no se modifican aparte. El precio se copia
  porque es el del momento de la venta.
- `entrega`: un subdocumento, con `ciudad` y `costo` si es envío, o
  `sucursal` si es retiro (cada forma con sus campos).
- `cupon`, `calificacion`, `nota`: solo si hay.
- `cliente_id`: referencia a `clientes`. Referenciado porque un cliente tiene
  muchos pedidos y sus datos cambian (email, direcciones).

En relacional serían tres tablas (`pedidos`, `items`, `entregas`) y dos JOIN
para mostrar un pedido. En MongoDB es una lectura, y escribir un pedido es
atómico porque es un solo documento. El costo: si cambia algo embebido que se
repite en muchos documentos, hay que actualizarlo en todos.

</details>

**2.** ¿Qué ventajas y qué riesgos tiene el esquema flexible?

<details><summary>Respuesta modelo</summary>

- Ventajas: cada documento tiene sus campos (el termo con `colores` y
  `resenas`, la yerba con `origen`), sin columnas casi vacías; agregar un
  dato nuevo es un `$set`, sin `ALTER TABLE` ni migración.
- Riesgos: la base acepta cualquier cosa. Un error de nombre (`tel` en vez de
  `telefono`) o de tipo (un precio como texto) no se rechaza, y las consultas
  dan de menos sin avisar. El esquema pasa a estar en la aplicación. MongoDB
  permite agregar validación con JSON Schema a una colección para recuperar
  parte de ese control.

</details>

**3.** Explicá qué es un replica set y qué es el sharding. ¿Qué problema
resuelve cada uno? ¿Se parecen a algo de HDFS?

<details><summary>Respuesta modelo</summary>

- **Replica set**: varias copias de los mismos datos; un primario recibe las
  escrituras y los secundarios lo copian. Si el primario cae, los secundarios
  eligen otro por mayoría. Resuelve la **disponibilidad**. Se parece a la HA
  del NameNode (elección por quórum) y a las réplicas de los bloques.
- **Sharding**: reparte una colección grande entre varios servidores (shards)
  según una *shard key*; un router (`mongos`) manda cada consulta al shard
  que corresponde. Resuelve la **escala**: más datos y más escrituras de las
  que entran en una máquina. Se parece al reparto de un archivo en bloques
  entre DataNodes, pero por el valor de un campo.
- En la imagen, MongoDB es un solo servidor, sin ninguno de los dos.

</details>

## Ejercicios sobre la imagen

Suponen `MONGODB=si` y la base `tienda` como vino
([recargarla](../../10-mongodb.md#recargar-la-base-de-ejemplo) si se
modificó). Se escriben en `mongosh tienda`.

### Ejercicio 1. Los cupones

¿Cuántos pedidos usó cada cupón y cuánto sumaron sus totales? Ordená de mayor
a menor cantidad de pedidos.

<details><summary>Solución</summary>

El código del cupón está en un subdocumento (`cupon.codigo`); los pedidos sin
cupón se filtran antes:

<!-- prueba: adentro < mongosh --quiet tienda | espera: 13727340 | espera: BIENVENIDA20 -->
```js
db.pedidos.aggregate([
  { $match: { cupon: { $exists: true } } },
  { $group: { _id: "$cupon.codigo", pedidos: { $sum: 1 }, total: { $sum: "$total" } } },
  { $sort: { pedidos: -1 } }
])
```

| cupón | pedidos | total |
|---|---:|---:|
| BIENVENIDA20 | 698 | 12620480 |
| OTONO15 | 665 | 11828600 |
| MATE10 | 651 | 13727340 |

- Suman 2014, los pedidos con cupón de la guía.
- MATE10 tiene menos pedidos pero suma más: su descuento es el más chico
  (10 %).

</details>

**Rúbrica (8 puntos)**: filtra los pedidos con cupón (2), agrupa por el campo
del subdocumento con punto (3), resultado exacto (2), comprueba el total de
2014 o explica la diferencia de MATE10 (1).

### Ejercicio 2. Envíos y retiros

Para los pedidos con **envío**, calculá cantidad y facturación por ciudad;
para los de **retiro**, por sucursal. ¿Qué ciudad tuvo más pedidos y cuál
facturó más?

<details><summary>Solución</summary>

<!-- prueba: adentro < mongosh --quiet tienda | espera: 48674735 | espera: 43442665 -->
```js
db.pedidos.aggregate([
  { $match: { "entrega.tipo": "envio" } },
  { $group: { _id: "$entrega.ciudad", pedidos: { $sum: 1 }, facturado: { $sum: "$total" } } },
  { $sort: { pedidos: -1 } }
])
db.pedidos.aggregate([
  { $match: { "entrega.tipo": "retiro" } },
  { $group: { _id: "$entrega.sucursal", pedidos: { $sum: 1 }, facturado: { $sum: "$total" } } },
  { $sort: { facturado: -1 } }
])
```

| ciudad (envío) | pedidos | facturado |
|---|---:|---:|
| Moron | 2116 | 46592950 |
| Lanus | 2062 | 48674735 |
| San Isidro | 2027 | 45645295 |
| Quilmes | 1976 | 43579175 |
| CABA | 1966 | 45697580 |
| La Plata | 1952 | 42671120 |

| sucursal (retiro) | pedidos | facturado |
|---|---:|---:|
| Centro | 1987 | 43442665 |
| Sur | 1981 | 42904395 |
| Oeste | 1946 | 41336400 |
| Norte | 1987 | 40698105 |

- Moron tuvo más pedidos, pero Lanus facturó más: los pedidos de Lanus fueron,
  en promedio, más caros.
- Los retiros suman 7901 y los envíos 12099: entre los dos, los 20.000
  pedidos.
- Los campos del subdocumento `entrega` son distintos según el tipo
  (`ciudad` o `sucursal`): es el esquema flexible.

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| Filtra por `entrega.tipo` | 2 |
| Agrupa por el campo que corresponde a cada tipo | 3 |
| Resultados exactos | 3 |
| Distingue más pedidos de más facturación | 1 |
| Comprueba que suman 20.000 o comenta el esquema flexible | 1 |

### Ejercicio 3. Pedidos por mes

Calculá cantidad de pedidos y facturación por mes. Los pedidos tienen una
`fecha` de tipo fecha (no texto).

<details><summary>Solución</summary>

`$dateToString` convierte la fecha en texto con el formato que se le pida (en
UTC, la zona en la que están guardadas):

<!-- prueba: adentro < mongosh --quiet tienda | espera: 76412255 | espera: 69481750 -->
```js
db.pedidos.aggregate([
  { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$fecha" } },
              pedidos: { $sum: 1 }, facturado: { $sum: "$total" } } },
  { $sort: { _id: 1 } }
])
```

| mes | pedidos | facturado |
|---|---:|---:|
| 2026-01 | 3495 | 76412255 |
| 2026-02 | 3066 | 66417175 |
| 2026-03 | 3449 | 79104785 |
| 2026-04 | 3323 | 74233935 |
| 2026-05 | 3395 | 75592520 |
| 2026-06 | 3272 | 69481750 |

Suman 20.000 pedidos y 441.242.420, el total de la guía. En SQL sería `GROUP
BY DATE_FORMAT(fecha, '%Y-%m')`.

</details>

**Rúbrica (8 puntos)**: agrupa por una expresión de fecha (3), formato de mes
correcto (2), resultado exacto (2), comprueba el total (1).

### Ejercicio 4. Un índice para el canal

Comprobá con `explain` que la búsqueda por `canal` recorre toda la colección.
Creá un índice sobre `canal` y volvé a mirar: ¿qué cambió? ¿Cuántos documentos
examina ahora para `canal: "telefono"`? Al final, borrá el índice para dejar
la base como vino.

<details><summary>Solución</summary>

<!-- prueba: adentro < mongosh --quiet tienda | espera: COLLSCAN | espera: canal_1 | espera: IXSCAN | espera: 3239 -->
```js
db.pedidos.find({ canal: "telefono" }).explain().queryPlanner.winningPlan.stage
db.pedidos.find({ canal: "telefono" }).explain("executionStats").executionStats.totalDocsExamined
db.pedidos.createIndex({ canal: 1 })
db.pedidos.find({ canal: "telefono" }).explain().queryPlanner.winningPlan.inputStage.stage
db.pedidos.find({ canal: "telefono" }).explain("executionStats").executionStats.totalDocsExamined
db.pedidos.dropIndex("canal_1")
```

- Antes: `COLLSCAN`, examina los 20000 pedidos.
- `createIndex` devuelve el nombre del índice, `canal_1`.
- Después: el plan tiene una etapa `FETCH` que trae los documentos y, debajo,
  un `IXSCAN` sobre `canal_1`. Examina **3239** documentos: solo los pedidos
  por teléfono.
- Con tres valores posibles, el índice sobre `canal` descarta dos tercios; un
  índice rinde más cuanto más selectivo es el campo (como `cliente_id`, con
  2000 valores).

</details>

**Rúbrica (8 puntos)**: muestra el `COLLSCAN` inicial (2), crea el índice
(2), muestra el `IXSCAN` y los documentos examinados (3), borra el índice
(1).

### Ejercicio 5. Calificación por canal

¿Qué canal tiene mejor calificación promedio? Contá también cuántos pedidos
calificados tiene cada uno, y redondeá el promedio a dos decimales.

<details><summary>Solución</summary>

Solo una parte de los pedidos tiene `calificacion`; `$avg` ignora los que no
la tienen, pero filtrar antes deja la cuenta correcta:

<!-- prueba: adentro < mongosh --quiet tienda | espera: 2027 | espera: 970 -->
```js
db.pedidos.aggregate([
  { $match: { calificacion: { $exists: true } } },
  { $group: { _id: "$canal", calificados: { $sum: 1 }, promedio: { $avg: "$calificacion" } } },
  { $project: { calificados: 1, promedio: { $round: ["$promedio", 2] } } },
  { $sort: { promedio: -1 } }
])
```

| canal | calificados | promedio |
|---|---:|---:|
| web | 2027 | 3.01 |
| app | 3126 | 3.01 |
| telefono | 970 | 2.9 |

- Son 6123 pedidos calificados de 20.000.
- Web y app quedan prácticamente iguales (3,0133 y 3,0058 sin redondear);
  teléfono, un poco abajo. Como redondeados empatan, el orden entre web y app
  puede salir al revés. Con calificaciones de 1 a 5 repartidas casi
  parejo, el promedio ronda 3.

</details>

**Rúbrica (6 puntos)**: filtra o explica los pedidos sin calificación (2),
`$avg` y conteo por canal (2), redondeo con `$round` y resultado (2).
