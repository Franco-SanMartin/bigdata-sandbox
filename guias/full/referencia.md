# Referencia de la interfaz, pantalla por pantalla

Para consultar, no para leer de corrido. Por cada pantalla: qué muestra cada
parte, **de dónde sale el dato** (la ruta de la API que la alimenta y lo que
esa ruta le pregunta a Hadoop), el **comando equivalente** para hacerlo en la
terminal y dónde aparece lo mismo en la industria. El paso a paso está en las
guías [1](01-arrancar-y-recorrido.md) a [12](12-formatos.md); el contrato
completo de la API, con los tipos, en [`ui/API.md`](../../ui/API.md).

[← 11. Comparar](11-comparar.md) · [Índice de full](README.md) · [Glosario](../glosario.md) · [Teoría →](teoria/README.md)

Cómo leer las tablas:

- **De dónde sale**: `MÉTODO /api/...` es la ruta del servidor de la
  interfaz (el que corre adentro del contenedor, en el 8080); después de la
  flecha, lo que esa ruta consulta o corre.
- **Comando equivalente**: va **adentro** del contenedor
  (`docker exec -it bigdata-full bash`), salvo los de `docker`, que van en tu
  compu.
- Las secciones siguen el orden de la barra lateral: primero dónde viven los
  datos, después quién reparte la máquina, qué hace las cuentas y cómo entran
  los datos. Las palabras están en el [glosario](../glosario.md).
- Todas las pantallas se refrescan solas: el servidor manda eventos por SSE
  (`GET /api/events`) y, además, la interfaz vuelve a pedir el estado cada
  2 s.

## Global: barra lateral, barra de arriba, paleta y ayuda

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Barra lateral | Las pantallas por capa: Empezar (Inicio, Prácticas), Almacenamiento (HDFS, Tablas, Bases, Formatos), Recursos (Trabajos), Procesamiento (Motores, Lenguajes, Comparar, Machine Learning), Ingesta (Pipeline), Operar (Cluster, Consola, Configuración) | Fija, en la interfaz | — |
| Estado arriba | *Apagado*, *Arrancando · Paso N de M*, en marcha, *Degradado* o *Con fallas* | `GET /api/status` → procesos propios, JMX del NameNode, REST del ResourceManager | `estado` |
| Consola (`Ctrl+J`) | El cajón con los eventos | `GET /api/activity?limit=200` + SSE `activity` | `docker logs bigdata-full` |
| Paleta (`Ctrl+K`) | Buscar pantallas, acciones y palabras del glosario (aparecen al escribir) | Fija, en la interfaz | — |
| Ayuda (`?`) | *Esta pantalla*: qué es, sus conceptos, sus términos del glosario y los atajos. *Glosario*: todas las palabras por capa, con buscador | `ui/src/help/` y [`guias/glosario.md`](../glosario.md), que se lee al armar la imagen | — |
| Camino de los datos | En el detalle de un trabajo y en el resultado de una consulta: de dónde → qué lo procesa → dónde queda, cada caja con su capa, su pantalla y su `?` al glosario | Armado en la interfaz (`ui/src/lib/camino.ts`) con el `trace` del trabajo o de la consulta | — |
| Direcciones | `#hdfs/user/root`, `#tablas/ventas`, `#lenguajes/pig`, `#bases/mongodb`, `#yarn/application_…`, `#comparar/quien-hace-el-trabajo`, `#inicio/recorrido/tres`... | La interfaz | — |

Atajos: `G` y después la letra. `G I` Inicio, `G R` Prácticas, `G H` HDFS,
`G T` Tablas, `G B` Bases, `G F` Formatos, `G Y` Trabajos, `G E` Motores, `G L` Lenguajes, `G K` Comparar,
`G P` Pipeline, `G M` Machine Learning, `G C` Cluster, `G O` Consola,
`G S` Configuración. La dirección vieja `#datos` (Consultas) lleva a Lenguajes.

Si no hay servidor (o se abre con `?demo` en la dirección), la interfaz usa
el **modo demo**: simula el cluster en el navegador con datos medidos en la
imagen y los tiempos acelerados. Sirve para mirar las pantallas sin Docker.

**En la industria.** La barra de estado global y la paleta de comandos son el
patrón de las consolas de nube (AWS, GCP, Azure) y de **Ambari** / **Cloudera
Manager**: un indicador de salud siempre visible y un buscador para saltar a
cualquier recurso.

## Inicio

Guía: [1. Arrancar y primer recorrido](01-arrancar-y-recorrido.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Estado | *El cluster está andando*, *degradado* o *con fallas*, procesos y DataNodes vivos, **Ver qué falla** | `GET /api/status` | `estado`, `jps` |
| Mapa del ecosistema | Las 20 herramientas por capa (desde dónde trabajás, lenguajes, motores, YARN, almacenamiento), con la lámpara de sus procesos y una línea en vivo | Fijo en `ui/src/lib/ecosistema.json` + `GET /api/status` (procesos y HDFS) y `GET /api/yarn/apps` | `jps`, `estado` |
| Flechas | Quién le pide qué a quién; las de MapReduce, Tez y Spark se mueven si hay un trabajo de ese motor corriendo | `GET /api/yarn/apps` (el tipo de cada aplicación activa) | `yarn application -list` |
| Ficha | Qué hace, una analogía, su pantalla y sus UIs, un comando de ejemplo, con qué no confundirla y con quién habla | Fija en `ecosistema.json`; el comando va a la terminal integrada | El de la ficha |
| Recorridos | *De un CSV a un tablero* y *Una consulta, tres motores*, paso a paso sobre el mapa (`#inicio/recorrido/<id>`) | Fijos en `ecosistema.json` | El de cada paso |
| ¿Cuál uso? | Las seis preguntas; cada una abre su tabla en Comparar | Fijas en `ecosistema.json` | — |
| Qué podés hacer ahora | Una tarjeta por tema: *Listo*, *Arrancando* o *No disponible* con el motivo y el arreglo | El estado de cada proceso cruzado con la configuración (`SERVICIOS`, `MONGODB`, `JUPYTER`, `NAMENODES`) | `estado` |
| Prácticas sugeridas | Las primeras que se pueden hacer ya | El avance guardado en el navegador + el estado | — |
| Archivos en HDFS | Cuántos, cuánto pesan, el último | `GET /api/hdfs/files` → `hdfs fsck / -files -blocks -locations` | `hdfs dfs -ls -R /` |
| Tablas de Hive | Cuántas y cuáles | `GET /api/data/catalog` → `beeline -e "SHOW TABLES; …"` (solo si Hive está listo) | `beeline -u jdbc:hive2://localhost:10000 -e "SHOW TABLES;"` |
| Trabajos en YARN | Cuántos y el último | `GET /api/yarn/apps` → `:8088/ws/v1/cluster/apps` | `yarn application -list -appStates ALL` |
| Modelos entrenados | Cuántos y el último | `GET /api/ml/models` → los entrenamientos de la sesión | — |
| Últimas acciones | Lo último que pasó, con el comando | `GET /api/activity` | `docker logs bigdata-full` |

**En la industria.** Es la página de inicio de cualquier plataforma de datos
administrada (**Databricks**, **EMR**, **Dataproc**): estado del cluster,
accesos rápidos y lo último que se hizo.

## Prácticas

Guía: [8. Prácticas guiadas](08-practicas.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Lista | Las 9 prácticas por capa (Almacenamiento, Recursos, Procesamiento, Ingesta y Alta disponibilidad), con su estado y avance | Fija en la interfaz + el avance en `localStorage` (`bds.practicas.v1`) | — |
| Antes de empezar | Cada servicio que necesita, con su lámpara | `GET /api/status` | `estado` |
| Pregunta | 4 opciones, por qué sí y por qué no | Fija en la interfaz | — |
| Ejecutar | Salida, código de salida, trace, *Dónde quedó* | No tiene ruta propia: usa las mismas que las pantallas (`/api/hdfs/mkdir`, `/api/hdfs/upload`, `/api/data/query`, `/api/yarn/apps`, `/api/processes/:id/stop`...) | El comando del paso |
| Verificar | Si dio lo esperado | Lecturas: `/api/hdfs/ls`, `/api/hdfs/fsck`, `/api/yarn/apps/:id`, `/api/status`... | El comando de verificación del paso |

**En la industria.** Los labs con validación automática de **Databricks
Academy**, **Google Cloud Skills Boost** y **AWS Skill Builder**, y los
*runbooks* de operación.

## HDFS

Guía: [3. HDFS desde la interfaz](03-hdfs.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Etiqueta de salud | *sano*, *N bloques sub-replicados*, *N DataNodes caídos*, *N bloques perdidos*, *safe mode*, *NameNode no responde* | `GET /api/hdfs/replication` → JMX (`UnderReplicatedBlocks`, `MissingBlocks`...) + `GET /api/hdfs/datanodes` → JMX `NameNodeInfo` | `hdfs dfsadmin -report`, `hdfs dfsadmin -safemode get` |
| Archivos: lista | Nombre, Tamaño, Réplica, Bloques, Estado, Modificado | `GET /api/hdfs/ls?path=…` → WebHDFS `:9870/webhdfs/v1<ruta>?op=LISTSTATUS` | `hdfs dfs -ls <ruta>` |
| Crear carpeta | — | `POST /api/hdfs/mkdir` | `hdfs dfs -mkdir -p <ruta>` |
| Subir | Ejemplos o un archivo de tu compu, con réplica y bloque | `POST /api/hdfs/upload` (o `POST /api/hdfs/put` para los ejemplos) | `hdfs dfs -D dfs.replication=N -D dfs.blocksize=X -put <archivo> <ruta>` |
| Detalle y mapa de bloques | Ruta, Tamaño, Bloques, Copias, Lo escribió, Permisos; una fila por bloque y una columna por DataNode | `GET /api/hdfs/file?path=…` → `hdfs fsck <ruta> -files -blocks -locations` | `hdfs fsck <ruta> -files -blocks -locations` |
| Ver | Los primeros 64 KB, en tabla o texto | `GET /api/hdfs/cat?path=…&offset=…&length=…` | `hdfs dfs -cat <ruta> \| head` |
| Bajar | El archivo en el navegador | `GET /api/hdfs/download?path=…` | `hdfs dfs -get <ruta> /datos/` |
| Mover | Nueva ruta | `POST /api/hdfs/move` | `hdfs dfs -mv <origen> <destino>` |
| Borrar | Sin papelera | `DELETE /api/hdfs/files?path=…&recursive=1` | `hdfs dfs -rm -r -skipTrash <ruta>` |
| Réplica | Copias antes → después | `PATCH /api/hdfs/files` → `hdfs dfs -setrep -w N <ruta>` (sin `-w` si no hay N DataNodes vivos) | `hdfs dfs -setrep N <ruta>` |
| Salud: fsck | HEALTHY o CORRUPT, copias de menos y de más, perdidos, la salida cruda | `GET /api/hdfs/fsck?path=…` → `hdfs fsck <ruta>` | `hdfs fsck /` |
| Salud: re-replicación | Curva, sub-replicados, en cola, perdidos, copias de más; la cola de tareas y las copias recientes | `GET /api/hdfs/replication` → JMX (`UnderReplicatedBlocks`, `PendingReplicationBlocks`, `MissingBlocks`...) + SSE `transfer` | `hdfs fsck / \| grep -E 'Under-replicated\|queued'` |
| DataNodes | Estado, latido, bloques, ocupado; Sumar, apagar y prender | `GET /api/hdfs/datanodes` → JMX `NameNodeInfo` + `hdfs dfsadmin -report`; `POST /api/hdfs/datanodes` para sumar | `datanode`, `datanode start N` |

**En la industria.** El *Browse the file system* del NameNode
(`localhost:9870`), el explorador de **Hue** y el *Files View* de **Ambari**;
las alertas de *under-replicated* y *missing blocks* de **Cloudera Manager**.
Teoría: [salud de HDFS](teoria/salud-hdfs.md).

## Tablas

Guía: [5. Lenguajes, Bases y Tablas](05-consultas.md), paso 3b.

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Lista | Las tablas de Hive: filas, si son externas o administradas y cuántas columnas | `GET /api/data/catalog` → `beeline -e "SHOW TABLES; DESCRIBE FORMATTED …"` (solo con Hive listo; apagado no se pide) | `beeline -u jdbc:hive2://localhost:10000 -e "SHOW TABLES;"` |
| Adónde apunta | La entrada del Metastore y la carpeta de HDFS, con **Abrir la carpeta** | `Location` de `DESCRIBE FORMATTED` | `hdfs dfs -ls /user/root/ventas` |
| Externa o administrada | Qué borra `DROP TABLE` en cada caso | `Table Type` de `DESCRIBE FORMATTED` | `beeline … -e "DESCRIBE FORMATTED ventas;"` |
| Columnas, formato y tamaño | Nombre y tipo de cada columna; textfile, parquet u orc; lo que ocupa en HDFS | `GET /api/data/schema?source=hive&name=…` → `DESCRIBE FORMATTED` | `hdfs dfs -du -s -h /user/root/ventas` |
| Quién la puede leer | Hive y Spark por el nombre; Pig por la carpeta, con el script que arma el esquema y saltea el encabezado. **Consultarla en Hive** y **Leerla con Pig** la abren en Lenguajes | Armado en la interfaz con las columnas y el `CREATE TABLE` (separador y `skip.header.line.count`) | `spark.table("default.ventas").show(10)` en `pyspark` |
| Muestra y CREATE TABLE | Las primeras 5 filas y lo que devuelve `SHOW CREATE TABLE` | `GET /api/data/schema` → `SHOW CREATE TABLE` + `SELECT * … LIMIT 5` | `beeline … -e "SHOW CREATE TABLE ventas;"` |

**En la industria.** El catálogo de datos: el **Hive Metastore** está detrás
de casi todo, y en la nube lo hacen **AWS Glue Data Catalog** o **Unity
Catalog** de Databricks; **DataHub** y **Amundsen** suman quién usa cada tabla.
Glosario: [Metastore](../glosario.md#metastore) y
[tabla externa](../glosario.md#tabla-externa).

## Bases

Guía: [5. Lenguajes, Bases y Tablas](05-consultas.md), pasos 7 y 8.

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Qué es | MariaDB y MongoDB no son Hadoop: una sola máquina, sin YARN, en milisegundos | Fijo en la interfaz | — |
| Selector de motor | MariaDB y MongoDB, con su lámpara | `GET /api/status` | `estado` |
| Tablas (catálogo) | Las tablas de MariaDB y las colecciones de MongoDB, con filas | `GET /api/data/catalog` → `information_schema.tables`; `estimatedDocumentCount()` en MongoDB | `mysql --batch tienda -e "SHOW TABLES;"`, `mongosh tienda --quiet --eval "db.getCollectionNames()"` |
| Ejemplos | Las consultas de cada base | `GET /api/data/examples` → `ejemplos/tienda.sql`, `consultas_mongo.js` | `cat /datos/ejemplos/tienda.sql` |
| Correr | Resultado (hasta 1000 filas), *Una sola máquina*, tiempo y filas leídas | `POST /api/data/query` → `mysql --batch -e`, `mongosh --quiet --eval` | `mysql --batch tienda -e "SELECT * FROM productos;"` |
| Plan | Si usa un índice o recorre todo | `POST /api/data/explain` → `EXPLAIN` en MariaDB, `explain("executionStats")` en MongoDB | `mysql --batch tienda -e "EXPLAIN SELECT …"` |
| Guardadas, historial, pestañas | Lo tuyo, de MariaDB y MongoDB | `localStorage` del navegador (las mismas listas que Lenguajes; cada pantalla muestra las de sus motores) | — |
| Direcciones | `#bases/mariadb`, `#bases/mongodb`; `#datos/mysql` lleva acá | La interfaz | — |

**En la industria.** **DBeaver**, **MySQL Workbench** o **MongoDB Compass**:
catálogo, editor, resultado y plan contra una base de una sola máquina.

## Formatos

Guía: [12. Formatos](12-formatos.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Fila contra columna | Las mismas ventas en CSV y por columnas; las columnas que la consulta no usa, apagadas | Fijo en la interfaz (`ui/src/lib/formatos.ts`) | — |
| Las tres copias | `ventas` (CSV), `ventas_parquet` y `ventas_orc`: lo que ocupa cada una, cuántas veces menos que el CSV, archivos y bloques | `GET /api/data/catalog` (si existen y su carpeta) + `GET /api/hdfs/ls?path=<carpeta>` (solo de las que existen) | `hdfs dfs -du -s -h /user/root/formatos/parquet` |
| Crear las copias | Las dos tablas externas en `/user/root/formatos` y el `INSERT OVERWRITE` que las llena | `POST /api/data/query` con el `CREATE EXTERNAL TABLE … STORED AS PARQUET` (u `ORC`) y el `INSERT OVERWRITE TABLE … SELECT * FROM ventas` (un trabajo de Tez) | `beeline -u jdbc:hive2://localhost:10000 -e "INSERT OVERWRITE TABLE ventas_parquet SELECT * FROM ventas;"` |
| La misma consulta en las tres | Tiempo, filas leídas y el trabajo de YARN de cada una, corridas una por vez | `POST /api/data/query` con la misma consulta sobre cada tabla | `beeline … -e "SELECT producto, SUM(cantidad) FROM ventas_orc GROUP BY producto;"` |
| Qué muestra esto | Las cuentas con esos números | Armado en la interfaz | — |

**En la industria.** Parquet es el formato de casi todo data lake (Spark,
Databricks, Athena) y ORC el de Hive; **Delta Lake**, **Iceberg** y **Hudi**
son Parquet más un registro de cambios. Glosario:
[Parquet y ORC](../glosario.md#parquet-y-orc).

## Trabajos en YARN

Guía: [4. YARN y los trabajos](04-trabajos-yarn.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Etiqueta y subtítulo | *listo*, *N corriendo*, *N en cola*; NodeManagers, memoria y vcores | `GET /api/yarn/cluster` → `:8088/ws/v1/cluster/nodes`, `…/scheduler`, `…/metrics` | `yarn node -list` |
| Números | Memoria en uso, Corriendo, En cola, Terminados | `GET /api/yarn/cluster` | `curl -s http://localhost:8088/ws/v1/cluster/metrics` |
| Lista de trabajos | Nombre, motor, estado, avance | `GET /api/yarn/apps` → `:8088/ws/v1/cluster/apps` + `:8042/ws/v1/node/containers` | `yarn application -list -appStates ALL` |
| Nuevo trabajo | Las 8 plantillas con sus parámetros y *Lo mismo en la terminal* | `GET /api/yarn/templates`; lanzar: `POST /api/yarn/apps` | `hadoop jar …/hadoop-mapreduce-examples-3.3.6.jar wordcount <entrada> <salida>` |
| Camino de los datos | De dónde leyó, qué motor lo corrió y la carpeta del resultado, con enlaces a HDFS y a Motores | `trace.input`, `engine` y `outputPath` de `GET /api/yarn/apps/:id` | — |
| Detalle: avance y resumen | Estado (ACCEPTED, RUNNING, FINISHED, FAILED, KILLED), Cola, Enviado, Memoria, Entra, Sale, Comando | `GET /api/yarn/apps/:id` → REST del ResourceManager | `yarn application -status <id>` |
| DAG | Fases (MapReduce), vértices (Tez) o etapas (Spark) | MapReduce: el ApplicationMaster y JobHistory (`:19888`); Tez: las tablas que imprime `beeline`; Spark: el driver (`:4040`) o Spark History (`:18080`) | `mapred job -status <job>` |
| Logs | Un log por contenedor (stdout, stderr, syslog) | `GET /api/yarn/apps/:id/logs?container=…` → `yarn logs` | `yarn logs -applicationId <id>` |
| Contadores | Lecturas, escrituras, registros | JobHistory `:19888/ws/v1/history/mapreduce/jobs/:job/counters` | `mapred job -status <job>` |
| Cancelar | — | `POST /api/yarn/apps/:id/kill` | `yarn application -kill <id>` |

**En la industria.** La interfaz del ResourceManager (`localhost:8088`), la de
Spark (`:4040` y Spark History), el **Tez UI** y, en la nube, las vistas de
trabajos de **EMR** y **Dataproc**. Teoría:
[ciclo de vida de una aplicación en YARN](teoria/ciclo-de-vida-yarn.md).

## Motores

Guía: [4. YARN y los trabajos](04-trabajos-yarn.md); la misma cuenta en los tres, [11. Comparar](11-comparar.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Ficha | MapReduce, Tez y Spark: qué hace, una analogía, cómo trabaja, cuándo conviene, quién lo usa en el sandbox y sus términos del glosario | Fija: `ecosistema.json` y la tabla de motores de D-05 | — |
| El último trabajo | El más nuevo de ese motor, con su DAG tarea por tarea (se actualiza mientras corre) | `GET /api/yarn/apps` + `GET /api/yarn/apps/:id` (solo con el cluster prendido) | `yarn application -list -appStates ALL` |
| Lo que movió | Memoria × tiempo, leído de HDFS, shuffle, disco local y tareas; Tez, solo memoria y tiempo | `GET /api/yarn/metrics?apps=<id>` | `curl -s http://localhost:8088/ws/v1/cluster/apps/<id>` |
| Lanzar ventas por producto | Un trabajo de ese motor | `POST /api/yarn/apps` con `mr-ventas`, `hive-ventas` o `spark-ventas` | `spark-submit ejemplos/ventas.py` |

**En la industria.** Las interfaces de cada motor: el ResourceManager y JobHistory
(`:8088`, `:19888`), el **Tez UI** y la de Spark (`:4040`, `:18080`); en la nube,
el detalle de cada paso en **EMR**, **Dataproc** o **Databricks**. Glosario:
[motor](../glosario.md#motor) y [DAG](../glosario.md#dag).

## Lenguajes

Guía: [5. Lenguajes, Bases y Tablas](05-consultas.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Qué es | Un lenguaje (SQL, Pig Latin) se traduce a trabajos de un motor (Tez, MapReduce) que corren en YARN | Fijo en la interfaz | — |
| Selector de motor | Hive y Pig, con su lámpara | `GET /api/status` | `estado` |
| Tablas (catálogo) | Las tablas de Hive; al pie, el botón a Tablas | `GET /api/data/catalog` | `beeline -u jdbc:hive2://localhost:10000 -e "SHOW TABLES;"` |
| Crear tabla ventas | El cartel, si Hive no la tiene | `POST /api/hdfs/put` (si falta el CSV) + `POST /api/data/query` con el `CREATE EXTERNAL TABLE` | `beeline -u jdbc:hive2://localhost:10000 -e "CREATE EXTERNAL TABLE …"` (el de la [guía 5](05-consultas.md#paso-3-crear-la-tabla-ventas-de-hive)) |
| Ejemplos | Las consultas de Hive y los scripts de Pig | `GET /api/data/examples` → `ejemplos/ventas.hql`, `tienda.hql`, `ventas.pig` | `cat /datos/ejemplos/ventas.pig` |
| Correr | Resultado (hasta 1000 filas), motor, tiempo e id de YARN | `POST /api/data/query` → `beeline --outputformat=tsv2 -e`, `pig -x mapreduce` | `beeline -u jdbc:hive2://localhost:10000 --outputformat=tsv2 -e "<sql>"` |
| Plan | Lo que va a hacer el motor, sin correrlo | `POST /api/data/explain` → `EXPLAIN` en Hive; en Pig, el script sin `DUMP` ni `STORE` y con `EXPLAIN` del último alias | `beeline … -e "EXPLAIN SELECT …"` |
| Trace | Quién la resolvió, paso a paso | `QueryResult.trace` de `POST /api/data/query` | — |
| Guardadas, historial, pestañas | Lo tuyo, de Hive y Pig | `localStorage` del navegador | — |
| Direcciones | `#lenguajes/hive`, `#lenguajes/pig`; `#datos` lleva acá | La interfaz | — |

**En la industria.** Los editores SQL de **Hue**, **Apache Superset (SQL
Lab)**, **Databricks SQL**, **Athena** o **BigQuery**: catálogo a la izquierda,
editor, resultado y plan. Teoría: [la interfaz y el cluster](teoria/ui-y-cluster.md).

## Comparar

Guía: [11. Comparar](11-comparar.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Recorrido de los datos | El dato una vez en HDFS, cuatro lenguajes, tres motores y cuatro resultados; la fila se mueve mientras corre | `GET /api/yarn/apps`: cada versión reconoce su trabajo por el nombre (`streamjob…`, `PigLatin:ventas.pig`, `HIVE-…`, `ventas por producto`) | `yarn application -list -appStates ALL` |
| Código | La parte que hace la cuenta o el archivo entero | `datos/ejemplos/`, copiados al lado de la interfaz al armar la imagen | `cat /datos/ejemplos/ventas.py` |
| Líneas, tiempo y fases | Líneas sin comentarios ni vacías; el tiempo de la última corrida; sus fases con las tareas reales | Contadas en la interfaz; `GET /api/yarn/apps` (con sus etapas) | `yarn application -status <id>` |
| Lanzar en YARN | Las cuatro: Pig manda sus trabajos en fila y la columna los suma | `POST /api/yarn/apps` con la plantilla `mr-ventas`, `pig-ventas`, `hive-ventas` o `spark-ventas` | `pig ejemplos/ventas.pig` |
| Lo que movió | Leído de HDFS, shuffle, disco local y memoria por tiempo, en la misma escala; Pig suma sus trabajos | `GET /api/yarn/metrics?apps=…` → RM `…/apps/:id` (`elapsedTime`, `memorySeconds`, `vcoreSeconds`); JobHistory `…/counters` (`HDFS_BYTES_READ`, `REDUCE_SHUFFLE_BYTES`, `FILE_BYTES_WRITTEN`); Spark History `…/stages` (`inputBytes`, `shuffleReadBytes`, `shuffleWriteBytes`, `diskBytesSpilled`). Tez: los contadores del resumen que imprimió beeline (`hive.tez.exec.print.summary`), si el trabajo lo mandó la interfaz; si no, solo el RM | `curl -s http://localhost:19888/ws/v1/history/mapreduce/jobs/<job>/counters` |
| Qué muestran los números | Lo que dicen esos números, en palabras | Armado en la interfaz con las métricas | — |
| ¿Dieron lo mismo? | Las cuatro salidas con el mismo formato | — | El bucle de `hdfs dfs -cat` de la [guía 11](11-comparar.md#paso-4-dieron-lo-mismo) |
| Otras tareas | Unir dos tablas (Hive, Pig y PySpark), SQL sobre la misma tabla (Hive y Spark SQL), limpiar los datos (pandas y PySpark), traer una tabla de MariaDB (Sqoop y Spark por JDBC) y entrenar un modelo (scikit-learn y MLlib), con el código real y su comando (`#comparar/tarea/<id>`) | `datos/ejemplos` y `datos/comparar`, importados en el build | El comando de cada columna |
| ¿Cuál uso? | Seis preguntas con su tabla (`#comparar/<pregunta>`) | Fijas en `ecosistema.json` | — |

**En la industria.** La pestaña *Stages* de la interfaz de Spark (con
*Shuffle Read* y *Spill*), los contadores de JobHistory y, en la nube, la
factura de **EMR**, **Dataproc** o **Databricks**, que se cobra por memoria y
CPU por tiempo. Glosario: [shuffle](../glosario.md#shuffle) y
[memoria por tiempo](../glosario.md#memoria-por-tiempo).

## Machine Learning

Guía: [7. Machine Learning](07-machine-learning.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Dataset y columnas | `clientes_senal.csv` y lo que dejó el pipeline | `GET /api/ml/datasets` | `hdfs dfs -ls /user/root/ml` |
| Qué modelo conviene | Recomendación con tiempo y memoria esperados | `POST /api/ml/recommend` → reglas fijas con lo medido en la imagen | — |
| Entrenar | Avance, métricas, referencia | `POST /api/ml/train` → `python3 server/sandbox_server/jobs/entrenar_sklearn.py` o `spark-submit …/jobs/entrenar_spark.py` + SSE `model` | `python3 ejemplos/ml/modelos_sklearn.py`, `spark-submit ejemplos/ml/modelos_spark.py` |
| Modelos | Los entrenamientos de la sesión | `GET /api/ml/models` | — |
| Camino de los datos | El conjunto, qué lo entrenó (scikit-learn en una máquina o MLlib en YARN, con su trabajo) y el modelo que queda | `dataset`, `engine` y `appId` del entrenamiento | — |
| El modelo por dentro | Árbol, red, KMeans, recta, en 3D y paso a paso | `GET /api/ml/models/{id}/viz` → lo que escribió `jobs/viz.py` al entrenar | — |

Entrenar necesita `SERVICIOS=todo` ("Machine Learning necesita los servicios
completos (Spark y Python)"); con MLlib, además el ResourceManager y HDFS. Se
entrena un modelo por vez.

**En la industria.** El seguimiento de experimentos de **MLflow**, los
*AutoML* de **SageMaker**, **Vertex AI** y **Azure ML**, y las
visualizaciones de **TensorBoard** y **SHAP**. Teoría:
[interpretabilidad](teoria/interpretabilidad.md).

## Pipeline

Guía: [6. Pipeline de punta a punta](06-pipeline.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Riel | Las 6 etapas con su estado, herramienta y salida; el dato que viaja | `GET /api/pipeline` | — |
| Etapa elegida y herramientas | Entra → sale, qué necesita, cuándo conviene cada herramienta | `GET /api/pipeline/catalog` | — |
| Camino de los datos | De dónde leyó el paso, qué herramienta y motor lo corrió y qué dejó, con enlaces a HDFS y al trabajo | `trace.input`, `engine`, `appIds` y `output.path` de la corrida | — |
| Correr | La corrida con su avance, motor, YARN, Dejó y el trace | `POST /api/pipeline/steps` + SSE `step` | Según la herramienta, abajo |
| Historial | Todas las corridas | `GET /api/pipeline/steps` | — |
| Empezar de nuevo | El riel a la primera etapa | `POST /api/pipeline/reset` (no borra datos) | — |

Comandos por etapa y herramienta:

| Etapa | Herramienta | Motor | Comando |
|---|---|---|---|
| Ingesta | `hdfs dfs -put` | HDFS | `hdfs dfs -put /datos/ejemplos/ml/ventas_sucias.csv /user/root/ml/` |
| Ingesta | Sqoop | MapReduce | `sqoop import --connect jdbc:mysql://localhost/tienda --table ventas -m N --target-dir /user/root/tienda/ventas` |
| ETL | pandas | una máquina | `python3 ejemplos/ml/etl_pandas.py` |
| ETL | PySpark | Spark | `spark-submit ejemplos/ml/etl_spark.py` |
| Almacenamiento | Tabla de Hive | una máquina | `beeline -e "CREATE EXTERNAL TABLE ventas_limpias … STORED AS PARQUET LOCATION '…'"` |
| Almacenamiento | Parquet en HDFS | HDFS | (deja el Parquet sin tabla) |
| Análisis | Hive | Tez | `beeline -e "SELECT … FROM ventas_limpias GROUP BY …"` |
| Análisis | Spark SQL | Spark | `spark-sql -e "…"` |
| Análisis | pandas | una máquina | `pandas.read_parquet(…).groupby(…)` |
| ML | scikit-learn | una máquina | `python3 server/sandbox_server/jobs/entrenar_sklearn.py` |
| ML | MLlib | Spark | `spark-submit server/sandbox_server/jobs/entrenar_spark.py` |
| Resultados | getmerge | HDFS | `hdfs dfs -getmerge /user/root/resultados/por_<x> /datos/por_<x>.csv` |
| Resultados | MySQL | MapReduce | `sqoop export --table resumen_<x> --export-dir /user/root/resultados/por_<x>` |

**En la industria.** Los orquestadores (**Apache Airflow**, **Dagster**,
**Prefect**, **Oozie** en Hadoop) y las vistas de *data lineage*. Teoría:
[pipelines de datos](teoria/pipelines.md).

## Cluster

Guía: [2. El panel del cluster y el sinóptico](02-cluster-y-sinoptico.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Vista previa (apagado) | Arquitectura, Configuración y Memoria estimada | `POST /api/config/estimate` → suma fija por parte (ver [Configuración](#configuración)) | — |
| Arranque | *N de M pasos*, cada paso con su comando y su log | `GET /api/status` (campo `boot`) → las líneas `[sandbox] …` de `/opt/entrypoint.sh` | `docker logs bigdata-full 2>&1 \| grep '\[sandbox\]'` |
| Sinóptico (lámparas) | Un módulo por proceso, por capa: Metadatos, Datos, Cómputo, Servicios | `GET /api/status` → `/proc/*/cmdline` (el proceso está) + `/proc/net/tcp` (el puerto escucha) | `jps`, `netstat -ltn` |
| Fichas de bloques | Los bloques de cada DataNode y las copias que viajan | `GET /api/hdfs/files` + SSE `transfer` | `hdfs fsck / -files -blocks -locations` |
| Procesos | Arriba / total, *todos responden* o *N con problemas* | `GET /api/status` | `jps` |
| DataNodes vivos | Vivos / total, *sin latidos*, *muerto* | JMX `FSNamesystemState` (`NumLiveDataNodes`, `NumDeadDataNodes`) | `hdfs dfsadmin -report` |
| Bloques | Total, perdidos, con copias de menos | JMX `FSNamesystem` (`BlocksTotal`, `MissingBlocks`, `UnderReplicatedBlocks`) | `hdfs fsck /` |
| YARN | Memoria usada / total, corriendo y en cola | `GET :8088/ws/v1/cluster/metrics` | `curl -s http://localhost:8088/ws/v1/cluster/metrics` |
| Memoria | Uso del contenedor sobre su tope, con historia | cgroup del contenedor y `free -m` | `free -m` |
| Detalle de un proceso | Estado, Capa, Puertos, Página, PID, Memoria, *Arriba desde*; en un DataNode, Bloques, Último latido y Carpeta | `GET /api/status` + `GET /api/hdfs/datanodes` | `ps -o pid,rss,etime -p <PID>` |
| Apagar / Prender | Un DataNode, el NameNode, MySQL, MongoDB, HiveServer2 o JupyterLab | `POST /api/processes/:id/stop` o `/start` → `GET /api/actions/:id` | `datanode stop 2`, `datanode start 2`, `hdfs --daemon stop namenode` |
| Carteles Degradado / Con fallas | Qué falla y qué depende de eso | Los arma la interfaz con lo que trae `GET /api/status`: el estado de cada proceso y los números de HDFS | `hdfs dfsadmin -report`, `hdfs fsck /` |
| Actividad reciente | Las últimas 8 entradas | `GET /api/activity` | `docker logs bigdata-full` |
| Reiniciar / Detener | Apagado en orden y vuelta a arrancar | `POST /api/cluster/apply` / `POST /api/cluster/stop` | `docker restart bigdata-full` (reinicia el contenedor, no solo el cluster) |

**En la industria.** La vista por host y por servicio de **Apache Ambari** y
**Cloudera Manager**, con sus alertas y sus botones de arrancar y parar. Las
lámparas son un *health check* de dos niveles (proceso vivo y puerto que
atiende), el mismo que hacen las *liveness* y *readiness probes* de
Kubernetes. Teoría: [la interfaz y el cluster](teoria/ui-y-cluster.md),
[salud de HDFS](teoria/salud-hdfs.md).

## Consola

Guía: [10. Consola](10-consola.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Eventos | Hora, gravedad, origen, título | `GET /api/activity?limit=200` + SSE `activity`; el servidor guarda los últimos 1000 en memoria | `docker logs bigdata-full` |
| Filtros | Gravedad (Todo, Problemas, Errores, Listos), Origen, buscador | En la interfaz, sobre la lista | `docker logs bigdata-full \| grep WARN` |
| Detalle | Comando, Entra, Hace, Sale, Log | El `ActionTrace` de cada evento; las acciones largas, `GET /api/actions/:id` | El comando que muestra |

**En la industria.** Logs centralizados (**ELK**, **Grafana Loki**,
**Splunk**, **Datadog**) y logs de auditoría (el *audit log* del NameNode,
**Apache Ranger**). Teoría: [observabilidad](teoria/observabilidad.md).

## Configuración

Guía: [9. Configuración y docker-compose.yml](09-configuracion-y-compose.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| HDFS | `DATANODES`, `REPLICATION`, `BLOCK_SIZE`, `NAMENODES` | La configuración guardada en el volumen | `docker run -e DATANODES=3 -e REPLICATION=2 …` |
| Servicios | `SERVICIOS`, `MONGODB`, `JUPYTER`, `PIG_HEAPSIZE` | Ídem | `docker run -e SERVICIOS=todo …` |
| Errores y avisos | Lo que está mal en cada campo | `POST /api/config/validate` → las mismas reglas que `sandbox/lib.sh` | — |
| Memoria | GB estimados sobre 7,7, el cartel y **Ver de dónde sale** | `POST /api/config/estimate` → suma fija por parte | `docker stats bigdata-full` (lo que usa de verdad) |
| Barra de cambios | Antes → después; Guardar, Guardar e iniciar, Aplicar y reiniciar | `PUT /api/config`, `POST /api/cluster/start`, `POST /api/cluster/apply` | `docker compose up -d` con el archivo nuevo |
| docker-compose.yml | El archivo para levantar lo mismo sin la interfaz | `POST /api/config/compose` (devuelve `text/yaml`) | `docker compose up -d` |
| Empezar de cero | Borra el volumen | `POST /api/cluster/reset` | `docker compose down -v` |

La memoria estimada suma, en MB: HDFS y sistema 4096; 256 por cada DataNode
más allá del primero; YARN, MapReduce y MySQL 1024 (si no es `hdfs`); Hive y
Spark 1024 (con `todo`); alta disponibilidad 2048 con 2 NameNodes o 2560 con
3; MongoDB 512; JupyterLab 384; la interfaz 128. El límite es 7884 MB.

**En la industria.** Infraestructura como código (**docker compose**,
**Helm**, **Terraform**) y las pantallas de configuración de **Cloudera
Manager** y **Ambari**, que también marcan qué servicios necesitan reinicio.

## La API en una página

Todas las rutas cuelgan de `/api`, hablan JSON y las acciones largas
contestan **202** y avisan el avance por SSE. Los errores traen
`{ "error": "…", "code": "…" }` con estos códigos: `cluster_stopped` (409),
`service_down` (503), `not_found` (404), `invalid` (400), `busy` (409),
`unsupported` (501) y `failed` (500).

| Grupo | Rutas |
|---|---|
| Estado | `GET /api/status`, `GET /api/activity`, `GET /api/events` (SSE), `GET /api/actions/:id` |
| Configuración y ciclo de vida | `POST /api/config/validate`, `POST /api/config/estimate`, `POST /api/config/compose`, `PUT /api/config`, `POST /api/cluster/start`, `POST /api/cluster/stop`, `POST /api/cluster/apply`, `POST /api/cluster/reset`, `POST /api/processes/:id/start` y `/stop` |
| HDFS | `GET /api/hdfs/datanodes`, `POST /api/hdfs/datanodes`, `GET /api/hdfs/files`, `PATCH /api/hdfs/files`, `DELETE /api/hdfs/files`, `POST /api/hdfs/put`, `GET /api/hdfs/ls`, `GET /api/hdfs/file`, `GET /api/hdfs/cat`, `GET /api/hdfs/download`, `POST /api/hdfs/upload`, `POST /api/hdfs/mkdir`, `POST /api/hdfs/move`, `GET /api/hdfs/fsck`, `GET /api/hdfs/replication` |
| YARN | `GET /api/yarn/apps`, `POST /api/yarn/apps`, `GET /api/yarn/apps/:id`, `GET /api/yarn/apps/:id/logs`, `POST /api/yarn/apps/:id/kill`, `GET /api/yarn/cluster`, `GET /api/yarn/templates`, `GET /api/yarn/metrics` |
| Pipeline | `GET /api/pipeline`, `GET /api/pipeline/catalog`, `GET /api/pipeline/steps`, `POST /api/pipeline/steps`, `POST /api/pipeline/reset` |
| Tablas, Bases y Lenguajes | `GET /api/data/catalog`, `GET /api/data/schema`, `GET /api/data/examples`, `POST /api/data/query`, `POST /api/data/explain` |
| Machine Learning | `GET /api/ml/datasets`, `POST /api/ml/recommend`, `POST /api/ml/train`, `GET /api/ml/models`, `GET /api/ml/models/{id}/viz` |

Eventos SSE: `status`, `activity`, `transfer`, `yarn`, `hdfs`, `step`,
`model` y `action`. El detalle de cada ruta (cuerpo, respuesta y comando
real) está en [`ui/API.md`](../../ui/API.md).
