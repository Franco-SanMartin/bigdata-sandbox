# 9. MongoDB y NoSQL

Las bases de datos que dejan de lado el modelo de tablas para escalar
horizontalmente o para guardar datos con forma variable. MongoDB, la base de
**documentos** más usada, es el ejemplo de la imagen.

[← 8. ZooKeeper y HA](08-zookeeper-ha.md) · [Teoría](README.md)

## Por qué aparecieron

Las bases relacionales dan transacciones, consistencia fuerte y un lenguaje
estándar (SQL), pero tienen dos dificultades con ciertos datos:

1. **Esquema rígido**: todas las filas de una tabla tienen las mismas
   columnas. Un catálogo donde la yerba tiene `peso_kg` y `origen`, y el termo
   `capacidad_l` y `colores`, termina en una columna por atributo posible
   (casi todas vacías) o en una tabla genérica de atributos difícil de
   consultar.
2. **Escalar escrituras**: una base relacional crece sobre todo en vertical.
   Repartir una tabla entre muchos servidores sin perder JOINs ni
   transacciones es difícil.

Las bases **NoSQL** (*not only SQL*), que se difundieron a fines de la década
de 2000 en empresas web (el paper de Dynamo de Amazon, Bigtable de Google),
resignan parte de eso a cambio de flexibilidad y escala horizontal.

## Las familias NoSQL

| Familia | Modelo | Ejemplos | Bueno para |
|---|---|---|---|
| **Clave-valor** | Un diccionario gigante: clave → valor opaco | Redis, Amazon DynamoDB, Riak | Cachés, sesiones, contadores: acceso por clave, rapidísimo |
| **Documentos** | Clave → documento estructurado (JSON/BSON) que se puede consultar por dentro | **MongoDB**, Couchbase, Firestore | Catálogos, perfiles, contenidos: entidades con forma variable que se leen enteras |
| **Columnas anchas** | Filas con familias de columnas, cada fila con sus columnas, repartidas por clave | Apache Cassandra, HBase, Bigtable | Volúmenes enormes de escrituras: series temporales, eventos |
| **Grafos** | Nodos y relaciones como ciudadanos de primera clase | Neo4j, Amazon Neptune | Redes sociales, recomendaciones, fraude: recorrer relaciones |

## Conceptos de MongoDB

| MongoDB | Relacional | Detalle |
|---|---|---|
| Base | Base | `tienda` |
| **Colección** | Tabla | Sin columnas fijas |
| **Documento** | Fila | Un objeto BSON (JSON binario, con más tipos: fechas, enteros de 64 bits, decimales) de hasta 16 MB |
| Campo | Columna | Puede ser un valor, una lista o un **subdocumento** |
| `_id` | Clave primaria | Obligatorio y único; si no se da, MongoDB genera un `ObjectId` |
| Subdocumento / lista embebida | Tabla hija + JOIN | Los `items` de un pedido van **adentro** del pedido |
| `$lookup` | JOIN | Existe, pero el diseño busca no necesitarlo |
| Índice | Índice | B-tree; sobre un campo de una lista indexa cada elemento (índice *multikey*) |

### Modelar: embeber o referenciar

La pregunta central del diseño en MongoDB no es "qué tablas hay" sino **cómo
se van a leer los datos**:

- **Embeber** lo que se lee junto: un pedido con sus ítems y su entrega se
  muestra entero, así que va en un documento. Una lectura, sin JOIN, y la
  escritura del pedido es atómica (un documento se escribe entero o nada).
- **Referenciar** lo que se comparte o crece sin límite: el cliente está en
  su colección, y el pedido guarda `cliente_id`. Embeber al cliente en cada
  pedido lo repetiría 10 veces y habría que actualizarlo en todos.

```text
  relacional (3 tablas, 2 JOIN)               MongoDB (1 documento por pedido)

  pedidos(id, cliente_id, canal, total)       {
  items(pedido_id, producto, cant, precio)      _id: 1, cliente_id: 1503, canal: "app",
  entregas(pedido_id, tipo, ciudad, costo)      items: [ { producto: "yerba", cantidad: 3, precio: 2500 },
                                                         { producto: "mate",  cantidad: 1, precio: 8000 } ],
  SELECT ... FROM pedidos p                     entrega: { tipo: "envio", ciudad: "Quilmes", costo: 1500 },
   JOIN items i ON ...                          total: 17000
   JOIN entregas e ON ...                     }
                                              (los valores son un ejemplo)
```

### Esquema flexible

Cada documento tiene los campos que necesita. En la base `tienda`, 1417 de
los 2000 clientes tienen `email`, y solo 101 tienen el subdocumento
`mayorista`. Un campo que no está **no existe** (`$exists: false`), que no es
lo mismo que un `NULL`. Agregar un dato nuevo a un producto es un `$set` en
ese documento, sin `ALTER TABLE`.

Flexible no quiere decir sin esquema: el esquema está **en la aplicación**.
Si la mitad de los programas escribe `telefono` y la otra mitad `tel`, la base
lo acepta igual. Para eso MongoDB permite agregar validación con *JSON
Schema* a una colección.

## Cómo funciona por dentro

### Consultas, agregación e índices

- `find(filtro, proyección)` filtra documentos, con operadores (`$gt`, `$in`,
  `$exists`, `$elemMatch`) que entran en subdocumentos (con punto:
  `"entrega.tipo"`) y en listas (encuentra el documento si algún elemento
  cumple).
- `aggregate([...])` es un **pipeline**: cada etapa (`$match`, `$unwind`,
  `$group`, `$sort`, `$lookup`, `$project`) recibe los documentos de la
  anterior. Es el equivalente de un `SELECT ... GROUP BY`, y la misma idea que
  el flujo de Pig.

```text
  pedidos (20.000)
     | $unwind: "$items"      un documento por ítem (un pedido con 3 ítems -> 3)
     v
  ítems
     | $group: _id = producto, unidades = $sum cantidad, facturado = $sum cantidad*precio
     v
  9 grupos (uno por producto)
     | $sort: facturado -1
     v
  resultado
```

- Sin índice, una búsqueda recorre toda la colección (**COLLSCAN**). Con un
  índice sobre el campo, va directo a los documentos que cumplen
  (**IXSCAN**). `explain()` dice cuál usó y cuántos documentos examinó. Los
  índices aceleran las lecturas, pero cada escritura tiene que actualizarlos y
  ocupan memoria: se crean para las consultas frecuentes, no para todo.

### Escalar: replica sets y sharding

```text
  replica set (disponibilidad)                sharding (escala horizontal)

  [primario] --replica--> [secundario]        mongos (router) <- clientes
      |                    [secundario]           |   decide por la shard key
   escrituras                                     v
   si cae, los secundarios eligen          [shard A: clientes 1-700]  (cada shard
   un nuevo primario (por mayoría)         [shard B: clientes 701-1400] es un
                                           [shard C: clientes 1401-2000] replica set)
                                           + config servers (dónde está cada rango)
```

- **Replica set**: copias del mismo dato. Un primario recibe las escrituras;
  si cae, los secundarios eligen uno nuevo por mayoría (la misma idea de
  quórum que ZooKeeper). Con el *write concern* se elige cuántas copias tienen
  que confirmar una escritura.
- **Sharding**: cada colección grande se reparte por una **shard key** (como
  los bloques de HDFS, pero por rango o *hash* de un campo). Una buena shard
  key reparte parejo y deja que la mayoría de las consultas vayan a un solo
  shard.

En la imagen, MongoDB es **un solo servidor**, sin réplicas ni sharding, y sin
usuario ni clave. Alcanza para aprender el modelo y las consultas.

## CAP, ACID y BASE

El **teorema CAP** (Brewer) dice que, ante una **partición** de red (P: dos
grupos de servidores que no se ven), un sistema distribuido tiene que elegir
entre **consistencia** (C: todos ven el último dato o se niega a responder) y
**disponibilidad** (A: siempre responde, aunque sea con un dato viejo). Sin
particiones se pueden tener las dos. La pregunta real es qué hace cada sistema
cuando la red falla.

- Las bases relacionales clásicas priorizan **ACID** (atomicidad,
  consistencia, aislamiento, durabilidad) en una máquina.
- Muchas NoSQL eligieron **BASE** (*basically available, soft state,
  eventually consistent*): siempre responden, y las réplicas convergen con el
  tiempo (Cassandra, DynamoDB en su modo por defecto).
- MongoDB, con un replica set, tiende a **CP**: las escrituras van al
  primario, y si un primario queda aislado de la mayoría, deja de aceptarlas
  hasta que se elige otro. Desde la versión 4.0 tiene transacciones ACID de
  varios documentos (en replica sets), aunque el diseño sigue apuntando a que
  cada operación toque un solo documento.

## MongoDB frente a Hadoop

| | HDFS + Hive/Spark | MongoDB |
|---|---|---|
| Para qué | Analizar todo el historial (OLAP, batch) | Servir a una aplicación (OLTP): leer y escribir documentos de a uno |
| Acceso típico | Recorrer millones de filas | Buscar uno o pocos documentos por clave o índice |
| Latencia | Segundos a minutos | Milisegundos |
| Modificar un dato | Reescribir archivos | `updateOne` |

No compiten: es común que una aplicación use MongoDB y que sus datos se copien
a un data lake para analizarlos con Spark, que tiene un conector para
MongoDB.

## Ventajas y limitaciones

**Ventajas**

- Modelo de documentos natural para objetos con forma variable y anidados,
  parecido a los objetos del programa (JSON).
- Lo que se lee junto se guarda junto: menos JOINs, lecturas rápidas.
- Escala horizontal integrada (sharding) y alta disponibilidad (replica
  sets).
- Pipeline de agregación potente.

**Limitaciones**

- Los JOINs (`$lookup`) existen, pero son más caros y menos naturales que en
  SQL. Un mal diseño (todo referenciado) termina peor que una base
  relacional.
- La duplicación que trae embeber obliga a actualizar en varios lugares.
- El esquema flexible traslada el control de calidad a la aplicación.
- Para análisis masivos sobre todo el historial, un motor como Spark o un
  warehouse es más eficiente.
- Licencia SSPL (desde 2018), que no es considerada de código abierto por la
  OSI. Por eso existen alternativas compatibles, como Amazon DocumentDB o
  FerretDB.

## En la guía 10 lo ves cuando...

- **[Las ideas](../../10-mongodb.md#las-ideas)**: los 9 productos tienen cada
  uno sus campos, y los pedidos guardan sus ítems adentro.
- **[Campos que no todos tienen](../../10-mongodb.md#campos-que-no-todos-tienen-exists)**:
  1417 clientes con email, 101 mayoristas, 2014 pedidos con cupón. Es el
  esquema flexible.
- **[Adentro de subdocumentos y listas](../../10-mongodb.md#adentro-de-subdocumentos-y-listas)**:
  la diferencia entre dos condiciones sobre `items` y `$elemMatch`.
- **[Agregación](../../10-mongodb.md#agregación-el-group-by-de-mongodb)** y
  **[`$unwind`](../../10-mongodb.md#abrir-las-listas-unwind)**: el pipeline.
  La yerba da 32734 unidades en los pedidos online.
- **[Índices](../../10-mongodb.md#índices)**: `IXSCAN` por `cliente_id` y
  `COLLSCAN` por `canal`.
- **[Escribir](../../10-mongodb.md#escribir-insertar-modificar-borrar)**:
  `$set` agrega un campo a un solo documento, sin tocar el resto.

Para repasar: [evaluación de MongoDB y NoSQL](../evaluacion/09-mongodb.md).
Comandos: [referencia de MongoDB](../referencia.md#mongodb).
