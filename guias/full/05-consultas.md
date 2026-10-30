# 5. Consultas: Hive, MariaDB, MongoDB y Pig

Escribir una consulta, correrla, ver el resultado, pedir el plan y entender
**quién** la resolvió: HiveServer2 solo, un trabajo Tez en YARN, MapReduce
(Pig) o el proceso de la base. Es lo de las guías
[5 (Pig)](../05-pig.md), [6 (Hive)](../06-hive.md),
[7 (MySQL)](../07-mysql-sqoop.md) y [10 (MongoDB)](../10-mongodb.md) en una
sola pantalla.

[← 4. YARN y los trabajos](04-trabajos-yarn.md) · [Índice de full](README.md) · Siguiente: [6. Pipeline →](06-pipeline.md)

El editor está en dos pantallas que siguen las capas del mapa: **Lenguajes**
(`G L`, Hive y Pig, que corren en el cluster) y **Bases** (`G B`, MariaDB y
MongoDB, de una sola máquina). El detalle de cada tabla de Hive (columnas,
carpeta de HDFS, muestra y CREATE TABLE) está en **Tablas** (`G T`). La
dirección vieja `#datos` lleva a Lenguajes. Los comandos equivalentes van
**adentro** del contenedor, parado en `/datos`.

## Paso 1. Los cuatro motores

**Qué se ve.** El título *Lenguajes* (o *Bases*) con una etiqueta: **N de 2
listos**, *Arrancando* o *Cluster apagado*. Arriba del editor, el selector de
motor (**Hive** y **Pig** en Lenguajes; **MariaDB** y **MongoDB** en Bases),
cada uno con su lámpara, y una línea con lo que admite:

| Motor | Qué es | Qué se puede | Quién lo resuelve |
|---|---|---|---|
| Hive | SQL sobre los archivos de HDFS | SELECT, CREATE, INSERT y DROP. Agrupar, unir u ordenar lanza un trabajo Tez en YARN. | Tez (o HiveServer2 solo) |
| MariaDB | SQL sobre la base relacional `tienda` | SQL de MariaDB. Lo que escribas cambia la base de verdad. | Una sola máquina |
| MongoDB | Documentos de la base `tienda` | find, aggregate, countDocuments y explain. Una expresión por vez. | Una sola máquina |
| Pig | Scripts de flujo de datos sobre HDFS | LOAD, FILTER, GROUP, DUMP, STORE. Desde acá no se permite sh, exec, STREAM ni borrar fuera de /user. | MapReduce |

Si un motor no está, el selector igual lo muestra y un cartel dice por qué
(por ejemplo, Hive con `SERVICIOS=mapreduce`, o MongoDB con `MONGODB=no`) con
el botón que lo arregla.

**Qué significa.** Hive y Pig trabajan sobre **archivos de HDFS** y, cuando
hace falta, lanzan trabajos en YARN; MariaDB y MongoDB tienen sus propios
archivos y resuelven en su proceso. La interfaz no tiene un motor propio:
llama a los mismos clientes de la terminal (`beeline`, `mysql`, `mongosh`,
`pig`).

## Paso 2. El catálogo, las guardadas y el historial

**Qué se ve.** A la izquierda, tres pestañas:

- **Tablas**: las tablas de Hive y MariaDB y las colecciones de MongoDB, con
  la cantidad de filas, y el buscador "Buscar tabla o columna". Un clic abre
  `SELECT * FROM … LIMIT 100;` (o `db.<colección>.find().limit(100)` en
  MongoDB). Al pie: "Pig no tiene catálogo: lee los archivos de HDFS con
  LOAD." Con el cluster apagado: "El catálogo aparece con el cluster
  prendido", y se puede igual escribir y guardar.
- **Guardadas**: las consultas guardadas con **Guardar**, con su motor.
- **Historial**: las últimas 50 que corriste, con cuántas filas devolvieron o
  si fallaron, y **Borrar historial**.

**Qué significa.** Las guardadas, el historial y las pestañas abiertas quedan
**en este navegador** (`localStorage`), no en el cluster: en otra compu no
están.

**En la terminal.** Lo mismo que lista el catálogo de MariaDB:

<!-- prueba: adentro | espera: sucursales -->
```bash
mysql --batch tienda -e "SHOW TABLES;"
```

<!-- prueba: no (necesita SERVICIOS=todo y la tabla ventas creada) -->
```bash
beeline -u jdbc:hive2://localhost:10000 -e "SHOW TABLES;"
```

## Paso 3. Crear la tabla `ventas` de Hive

**Qué se ve.** Si Hive está listo y no tiene la tabla `ventas`, un cartel:
"Hive todavía no tiene la tabla ventas. Se crea como tabla externa sobre
/user/root/ventas: apunta a los archivos de HDFS, no los copia. Si no están,
primero los sube." con el botón **Crear tabla ventas desde HDFS**.

**Qué hacer.** Tocalo.

**Qué pasa.** Si `/user/root/ventas` está vacío, primero sube
`ventas_grandes.csv` (en el log: `$ hdfs dfs -put ventas_grandes.csv
/user/root/ventas`). Después abre un documento *Crear ventas* y corre:

<!-- prueba: no (necesita SERVICIOS=todo; la guía 6 de la materia crea la tabla) -->
```sql
CREATE EXTERNAL TABLE IF NOT EXISTS ventas (
  fecha STRING, sucursal STRING, producto STRING,
  cantidad INT, precio INT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '/user/root/ventas'
TBLPROPERTIES ('skip.header.line.count' = '1');
```

**Qué significa.** *Externa* quiere decir que Hive guarda solo la descripción
(columnas, separador, dónde están los archivos) en el Metastore; los datos
siguen siendo los archivos de HDFS. Un `DROP TABLE ventas` borra la
descripción, no los archivos.

## Paso 4. Correr: con y sin YARN

**Qué hacer.** Arriba del editor están los **Ejemplos** del motor elegido
(salen de los archivos de `/datos/ejemplos`: `ventas.hql`, `tienda.hql`,
`tienda.sql`, `consultas_mongo.js`, `ventas.pig`). Elegí, en Hive,
**Primeras filas** y **Correr** (`Ctrl+Enter`). Después, **Ventas por
producto**.

**Qué se ve.** Abajo, la pestaña **Resultado** con la tabla (se puede ordenar
por columna, **Copiar** como CSV o bajar el **CSV**) y, arriba a la derecha,
el motor, el tiempo y el id del trabajo de YARN si lo hubo. Mientras corre:
"Corriendo en Hive" con los segundos y, si pasa de 3 s, "si lanza un trabajo
Tez, abrir la sesión en YARN lleva 10-20 s". Se muestran hasta 1000 filas
("Se muestran las primeras 1.000 filas de N").

**Qué significa.** `SELECT * FROM ventas LIMIT 5` lo resuelve HiveServer2
**solo**, leyendo el archivo (una *fetch task*): no aparece nada en Trabajos.
`GROUP BY` y `ORDER BY` necesitan juntar filas de muchos bloques, así que
Hive arma un DAG de Tez y lo manda a YARN: aparece en Trabajos como
*Ventas…* con motor Tez.

**En la terminal.** La interfaz corre exactamente esto (lo muestra al pie del
editor y en el log):

<!-- prueba: no (necesita SERVICIOS=todo y la tabla ventas) -->
```bash
beeline -u jdbc:hive2://localhost:10000 --outputformat=tsv2 -e "SELECT producto, COUNT(*) AS n FROM ventas GROUP BY producto"
```

Así contestó `beeline` una consulta de ese tipo (sobre la tabla
`ventas_limpias` que deja el pipeline) en las pruebas de la imagen: el
resultado sale por la salida estándar, separado por tabuladores, y todo el
resto (conexión, compilación, avance de Tez) por la de errores.

```text
producto	n
azucar	14476
bombilla	5836
cafe	4808
facturas	19659
galletitas	13615
mate	7753
termo	1942
yerba	29111
```

Entre las líneas de la salida de errores está la que dice a qué trabajo de
YARN fue:

```text
INFO  : Status: Running (Executing on YARN cluster with App id application_1792696463919_0020)
```

## Paso 5. El plan

**Qué hacer.** Con la consulta de *Ventas por producto*, **Plan**
(`Ctrl+Shift+Enter`).

**Qué se ve.** La pestaña **Plan**: el motor, un resumen ("Sin trabajo en
YARN: lo resuelve el motor en su proceso", "Lanza un trabajo en YARN con N
etapas" o, en Pig, "Lanza N trabajos MapReduce en YARN, uno detrás del
otro"), cuántos operadores tiene y el árbol de operadores. Los que leen la
tabla entera llevan la marca **lee todo** (un `TableScan` de Hive, un `ALL` de
MariaDB, un `COLLSCAN` de MongoDB). Abajo, plegada, la **Salida del motor
(EXPLAIN)** tal cual.

**Qué significa.** El plan es lo que el motor **piensa** hacer, sin hacerlo.
Sirve para saber antes de correr si va a lanzar un trabajo en YARN o si va a
recorrer toda la tabla.

**En la terminal.**

<!-- prueba: adentro | espera: sucursales -->
```bash
mysql --batch tienda -e "EXPLAIN SELECT * FROM sucursales;"
```

<!-- prueba: no (necesita SERVICIOS=todo y la tabla ventas) -->
```bash
beeline -u jdbc:hive2://localhost:10000 -e "SET hive.explain.user=false; EXPLAIN SELECT producto, COUNT(*) FROM ventas GROUP BY producto"
```

## Paso 6. El trace: quién la resolvió

**Qué hacer.** Después de correr, pestaña **Trace**.

**Qué se ve.** El comando y cuatro renglones: **Entra** (la consulta, o en
MariaDB "N filas leídas"), **Hace**, **Sale** ("N filas · T s") y **Motor**;
si hubo trabajo, **YARN** con su id. Abajo, **Después**: las primeras filas
del resultado. *Hace* es una de estas:

- "HiveServer2 la convierte en un trabajo Tez y lo manda a YARN"
- "HiveServer2 la resuelve leyendo directo de HDFS, sin YARN (fetch task)"
- "MySQL la resuelve en su propio proceso"
- "MongoDB la resuelve en su propio proceso"

La pestaña **Log** guarda, para este documento, cada corrida: el comando y
cómo terminó.

**Qué significa.** En MariaDB el número de filas leídas sale de los contadores
`Handler_read_*` de la sesión, que la interfaz pide después de tu consulta. Si
una consulta con `WHERE` sobre la clave lee pocas filas y otra sin índice lee
toda la tabla, se ve acá (y en la marca *leyó N* arriba del resultado).

## Paso 7. MariaDB: la base `tienda`

**Qué hacer.** Motor **MariaDB**, ejemplo **Sucursales**, **Correr**. Después
**Facturación por categoría (JOIN)**.

**En la terminal.**

<!-- prueba: adentro | espera: Laura Gomez -->
```bash
mysql --batch tienda -e "SELECT * FROM sucursales;"
```

**Qué significa.** `tienda` es la base relacional de la [guía 7](../07-mysql-sqoop.md):
la que Sqoop importa a HDFS. El ejemplo *Lo que devolvió sqoop export* lee la
tabla `resumen_categoria`, que existe recién después de hacer la exportación
de esa guía. La última etapa del [pipeline](06-pipeline.md) exporta a otras
tablas: `resumen_producto`, `resumen_sucursal`...

## Paso 8. MongoDB: documentos y explain

**Qué hacer.** Motor **MongoDB** (necesita `MONGODB=si`). Probá **Un
documento entero**, **Por producto ($unwind + $group)** y **Índice: IXSCAN en
vez de COLLSCAN**.

**Qué se ve.** El resultado es una columna *documento* con cada documento
formateado (hasta 1000). El último ejemplo es un `explain("executionStats")`:
en **Plan** se ve si usó el índice (`IXSCAN`) o recorrió la colección entera
(`COLLSCAN`, marcado *lee todo*).

**En la terminal.**

<!-- prueba: no (necesita MONGODB=si) -->
```bash
mongosh --quiet tienda --eval 'db.pedidos.find({ cliente_id: 42 }).explain("executionStats")'
```

## Paso 9. Pig desde el editor

**Qué hacer.** Motor **Pig**, ejemplo **Ventas por sucursal**, **Correr**.

**Qué se ve.** Tarda: "Pig arma los trabajos MapReduce y los manda a YARN:
cada uno tarda 20-40 s". En Trabajos aparecen uno o más trabajos MapReduce. El
resultado del `DUMP` vuelve como tabla.

**Qué significa.** Pig traduce el script a una cadena de trabajos MapReduce
(el **Plan** dice cuántos). La interfaz no deja correr `sh`, `exec`, `STREAM`
ni borrar fuera de `/user`, porque el script corre en el contenedor con
permisos de root. El ejemplo **Guardar el resultado en HDFS (STORE)** deja los
archivos en `/user/root/resultados/pig_por_producto`: se ven en HDFS.

**En la terminal.**

<!-- prueba: no (lanza trabajos MapReduce: la guía 5 de la materia lo corre) -->
```bash
pig -x mapreduce -f ejemplos/ventas.pig
```

## Paso 10. Cuando falla

**Qué hacer.** Corré `SELECT * FROM no_existe;` en Hive y en MariaDB.

**Qué se ve.** Un cartel rojo con el código y "La consulta falló en Hive", y
el mensaje del motor. Queda en el historial con *falló* y en la
[Consola](10-consola.md) como evento de error.

Así contestan los motores a una tabla que no existe (pruebas de la imagen,
con la tabla `no_existe_humo`). Hive:

```text
Error: Error while compiling statement: FAILED: SemanticException [Error 10001]: Line 1:14 Table not found 'no_existe_humo' (state=42S02,code=10001)
```

MariaDB:

```text
ERROR 1146 (42S02) at line 1: Table 'tienda.no_existe_humo' doesn't exist
```

**Qué significa.** El mensaje es el del motor, sin traducir: es el mismo que
verías en la terminal, y es el que tenés que saber leer.

## Dónde se usa esto en la industria

Un editor web de consultas con catálogo, historial y plan es lo que ofrecen
**Hue** (el clásico de los clusters Hadoop, con editores de Hive, Pig e
Impala), **Apache Zeppelin**, **DBeaver** o **DataGrip** del lado del
escritorio, y la consola de **MongoDB Compass** para documentos. Leer el
`EXPLAIN` antes de correr algo caro es una práctica diaria en cualquier equipo
de datos.
