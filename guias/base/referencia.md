# Referencia de la versión `base`

Qué hace cada pieza del cluster, dónde se usa fuera del aula y cómo se usa en
esta imagen: comandos, opciones, puertos, parámetros y carpetas. Todo sale del
código de la imagen (`Dockerfile`, `entrypoint.sh`, `sandbox/` y `conf/`).

[← Versión base](README.md) · [Índice de guías](../README.md)

- [El cluster de un vistazo](#el-cluster-de-un-vistazo)
- Componentes: [HDFS](#hdfs) · [YARN](#yarn) · [MapReduce y JobHistory](#mapreduce-y-jobhistory) ·
  [Tez](#tez) · [Pig](#pig) · [Hive](#hive) · [Sqoop](#sqoop) ·
  [MySQL (MariaDB)](#mysql-mariadb) · [Spark](#spark) · [ZooKeeper](#zookeeper) ·
  [MongoDB](#mongodb)
- [Puertos y páginas web](#puertos-y-páginas-web)
- [Parámetros del `docker run`](#parámetros-del-docker-run)
- [Comandos propios de la imagen](#comandos-propios-de-la-imagen)
- [Volúmenes y carpetas](#volúmenes-y-carpetas)
- [Qué hace el arranque, paso a paso](#qué-hace-el-arranque-paso-a-paso)

## El cluster de un vistazo

Un solo contenedor, pero cada daemon es un proceso Java (o una base de datos)
aparte, como en un cluster de varias máquinas. Con la configuración de la
[guía 2](../02-arrancar-y-apagar.md) (`DATANODES=3`, `SERVICIOS=todo`,
`MONGODB=si`):

```text
                    contenedor "bigdata"
 +------------------------------------------------------------------+
 |  HDFS        NameNode :9870   Secondary NameNode :9868            |
 |              DataNode 1 :9901  DataNode 2 :9902  DataNode 3 :9903 |
 |                                                                  |
 |  YARN        ResourceManager :8088   NodeManager :8042           |
 |              MapReduce JobHistory :19888                         |
 |                                                                  |
 |  Hive        Metastore :9083 (Derby)   HiveServer2 :10000/:10002 |
 |  Spark       History Server :18080   (app activa :4040)          |
 |                                                                  |
 |  Bases       MySQL :3306 (tienda)    MongoDB :27017 (tienda)     |
 |                                                                  |
 |  Comandos    hdfs yarn mapred hadoop pig beeline sqoop           |
 |              spark-submit pyspark mysql mongosh zkCli.sh         |
 +------------------------------------------------------------------+
   /hadoop  volumen: HDFS, metastore, MySQL, MongoDB (persiste)
   /datos   tu carpeta datos/ (archivos de ida y vuelta)
```

Con `NAMENODES=2` o `3` cambia la parte de HDFS: no hay Secondary NameNode y
aparecen ZooKeeper, 3 JournalNodes y un ZKFC por NameNode
([ZooKeeper](#zookeeper)). Pig, Sqoop y los clientes no son servicios: son
comandos que mandan trabajos a YARN o se conectan a un servidor.

## HDFS

**Qué hace.** El sistema de archivos distribuido de Hadoop: parte cada
archivo en **bloques** de tamaño fijo y guarda cada bloque en varios
DataNodes (la **replicación**), para que la caída de un nodo no pierda datos
y para que muchos procesos lean en paralelo.

**Dónde se usa.** Fue el almacenamiento de los primeros grandes clusters de
Hadoop (Yahoo, Facebook, LinkedIn) y sigue siendo el de los *data lakes*
instalados en servidores propios de bancos, telcos y organismos públicos,
muchas veces con distribuciones como Cloudera. En la nube lo reemplaza casi
siempre el **almacenamiento de objetos** (Amazon S3, Azure Data Lake Storage,
Google Cloud Storage), y en servidores propios aparecen alternativas como
MinIO o Apache Ozone. Las herramientas (Hive, Spark) leen igual de HDFS que de
S3: lo que cambia es la ruta (`hdfs://` o `s3a://`).

**En esta imagen.** Sin alta disponibilidad, la dirección de HDFS es
`hdfs://localhost:9000` (en `core-site.xml`, `fs.defaultFS`); con HA es
`hdfs://sandbox`. El `hdfs-site.xml` se genera en cada arranque a partir de
los parámetros: editarlo a mano no sirve, se pisa. Lo que cambia respecto de
Hadoop de fábrica:

| Propiedad | Valor acá | De fábrica | Por qué |
|---|---|---|---|
| `dfs.replication` | `REPLICATION` (1) | 3 | Lo elegís en el `docker run` |
| `dfs.blocksize` | `BLOCK_SIZE` (128m) | 128m | Con `1m` se ven muchos bloques con archivos chicos |
| `dfs.permissions.enabled` | `false` | `true` | Sandbox de aprendizaje: sin chequeo de permisos |
| `dfs.heartbeat.interval` | 3 s | 3 s | |
| `dfs.namenode.heartbeat.recheck-interval` | 5 s | 5 min | Un DataNode caído se da por muerto a los ~40 s (de fábrica, 10,5 min) |
| `dfs.namenode.safemode.extension` | 5 s | 30 s | Al reiniciar, sale antes de *safe mode* |
| `dfs.namenode.checkpoint.period` | 300 s | 1 h | Para ver el checkpoint del Secondary en la clase |

### NameNode

Guarda los **metadatos**: el árbol de carpetas, qué bloques forman cada
archivo y en qué DataNodes está cada bloque. No guarda datos. Tiene los
metadatos en memoria y en disco como una imagen (`fsimage`) más un registro
de cambios (`edits`). Sin HA es el *punto único de falla*: si se cae, HDFS
queda sin servicio. Acá: un proceso `NameNode (nn1)` en `jps`, web en
http://localhost:9870, metadatos en `/hadoop/dfs/name` (con HA,
`/hadoop/dfs/nnN`). La primera vez el arranque lo formatea solo
(`hdfs namenode -format`): **no** lo corras a mano, borra los metadatos.

### DataNode

Guarda los bloques como archivos comunes en su disco, le avisa al NameNode
que está vivo cada 3 s (*heartbeat*) y le manda la lista de sus bloques. Los
clientes leen y escriben los bloques directo en los DataNodes: el NameNode
solo les dice dónde. Acá hay de 1 a 9 (`DATANODES`), cada uno con su web
(DataNode N en el puerto 9900+N), su carpeta `/hadoop/dfs/dnN` y su nombre en
`jps` (`DataNode (dn2)`). Se apagan y prenden con el comando
[`datanode`](#datanode).

### Secondary NameNode

**No es un NameNode de repuesto.** Cada tanto (acá, cada 5 min) baja la
`fsimage` y los `edits` del NameNode, los junta en una `fsimage` nueva (el
*checkpoint*) y se la devuelve: así el registro de cambios no crece sin fin y
el NameNode arranca rápido. Web en http://localhost:9868, checkpoints en
`/hadoop/dfs/secondary`. Con HA no existe: el checkpoint lo hace el NameNode
*standby*.

### Comandos de HDFS

Las rutas sin `/` adelante son relativas a `/user/root`. Los archivos locales
son los de `/datos` (la carpeta donde arrancás).

| Comando | Qué hace | Opciones más usadas |
|---|---|---|
| `hdfs dfs -ls <ruta>` | Lista | `-h` tamaños legibles, `-R` recursivo. La 2.ª columna es la replicación |
| `hdfs dfs -mkdir <carpeta>` | Crea una carpeta | `-p` crea las del medio y no falla si existe |
| `hdfs dfs -put <local> <hdfs>` | Sube | `-f` pisa si existe. Con `-D dfs.blocksize=2m` o `-D dfs.replication=3` antes del `-put`, sube con otro bloque u otra replicación |
| `hdfs dfs -get <hdfs> <local>` | Baja | `-f` pisa si existe |
| `hdfs dfs -cat <archivo>` | Muestra el contenido | con `\| head` para los grandes; también `-tail` |
| `hdfs dfs -rm <ruta>` | Borra | `-r` carpetas, `-f` no falla si no existe |
| `hdfs dfs -mv`, `-cp` | Mueve, copia (adentro de HDFS) | |
| `hdfs dfs -du -h <ruta>` | Cuánto ocupa (sin contar réplicas, y con ellas) | `-s` un total |
| `hdfs dfs -df -h` | Capacidad libre y usada de HDFS | |
| `hdfs dfs -setrep -w N <ruta>` | Cambia la replicación de lo ya subido | `-w` espera a que estén las copias |
| `hdfs dfs -test -e <ruta>` | ¿Existe? (sale con código 0 o 1, sin imprimir) | `-d` carpeta, `-f` archivo |
| `hdfs dfs -chmod` | Permisos (acá no se chequean) | `-R` |
| `hdfs fsck <ruta> -files -blocks -locations` | Bloques de cada archivo y dónde está cada copia | sin opciones: el resumen (`HEALTHY`, *Under-replicated*, `MISSING`) |
| `hdfs dfsadmin -report` | Capacidad y estado de cada DataNode | |
| `hdfs dfsadmin -safemode get` | Si está en *safe mode* | `wait`, `leave`, `enter` |
| `hdfs getconf -confKey <propiedad>` | El valor de una propiedad de la configuración | |
| `hdfs haadmin -getAllServiceState` | Con HA: quién es *active* y quién *standby* | `-getServiceState nn1` |

Por ejemplo, para ver con qué tamaño de bloque y qué replicación arrancó el
cluster:

<!-- prueba: adentro -->
```bash
hdfs getconf -confKey dfs.blocksize
hdfs getconf -confKey dfs.replication
hdfs dfs -df -h
```

**Aparece en:** [guía 3](../03-hdfs.md) (todo), [guía 9](../09-zookeeper-ha.md)
(HA) y como entrada y salida de todas las demás. Teoría:
[HDFS](teoria/02-hdfs.md).

## YARN

**Qué hace.** El "sistema operativo" del cluster: lleva la cuenta de la
memoria y la CPU de cada nodo y se las reparte a los trabajos en forma de
**contenedores**. No sabe nada de MapReduce, Spark o Tez: cada trabajo trae
su propio *ApplicationMaster*, que le pide contenedores y los usa.

- **ResourceManager**: uno por cluster. Recibe los trabajos, decide a quién
  le toca cada contenedor (el *scheduler*) y tiene la web de todos los
  trabajos, http://localhost:8088.
- **NodeManager**: uno por nodo. Lanza y vigila los contenedores de su nodo
  y le informa al ResourceManager cuánto tiene libre. Web en
  http://localhost:8042.

**Dónde se usa.** En todos los clusters de Hadoop desde la versión 2 (2013):
ahí corren juntos Spark, Hive sobre Tez, MapReduce y Flink, con colas por
área de la empresa. En plataformas nuevas, el que reparte recursos suele ser
**Kubernetes** (Spark y Flink corren directo sobre él) o el servicio
administrado de la nube (Amazon EMR, Google Dataproc y Azure HDInsight siguen
usando YARN por debajo).

**En esta imagen.** Un ResourceManager y un NodeManager (con
`SERVICIOS=mapreduce` o `todo`). El NodeManager ofrece **4096 MB** para
contenedores, que se reparten de a 512 MB como mínimo (`yarn-site.xml`).
Además:

- `yarn.log-aggregation-enable=true`: los logs de cada contenedor quedan en
  HDFS, así `yarn logs` y el link *logs* de las webs andan con el trabajo
  terminado.
- `yarn.nodemanager.vmem-check-enabled=false`: YARN no mata contenedores por
  la memoria virtual (un falso positivo común en Java 8).
- El chequeo de disco se subió a 99,5 % (de fábrica, 90 %): en una notebook
  con el disco casi lleno, YARN marcaría el nodo *UNHEALTHY* y no correría
  nada.

| Comando | Qué hace |
|---|---|
| `yarn node -list` | Los NodeManagers y su estado (`RUNNING`) |
| `yarn application -list` | Los trabajos corriendo (o esperando, `ACCEPTED`) |
| `yarn application -list -appStates FINISHED` | Los terminados (`ALL`: todos) |
| `yarn application -status <id>` | El detalle de uno (`application_...`) |
| `yarn application -kill <id>` | Lo corta |
| `yarn logs -applicationId <id>` | Los logs de todos sus contenedores |

**Aparece en:** [guía 4](../04-yarn-mapreduce.md#yarn-desde-la-terminal), y su
web en todas las que corren trabajos (4 a 8). Teoría:
[YARN y MapReduce](teoria/03-yarn-mapreduce.md).

## MapReduce y JobHistory

**Qué hace.** MapReduce es el modelo de procesamiento original de Hadoop:
**map** (cada *mapper* lee un pedazo de la entrada y emite pares clave-valor),
**shuffle** (Hadoop agrupa y ordena por clave) y **reduce** (cada *reducer*
resume los valores de una clave). Cada etapa escribe a disco. El
**JobHistory Server** guarda los trabajos MapReduce terminados (contadores,
tiempos de cada tarea, logs).

**Dónde se usa.** Viene del paper de Google de 2004 y fue *el* modo de
procesar en Hadoop hasta ~2014. Hoy casi todo lo nuevo se escribe en Spark,
SQL (Hive, Trino) o Flink, que son más rápidos porque no escriben a disco
entre etapas. Sigue vivo por debajo: Sqoop, Pig y la copia entre clusters
(`hadoop distcp`) generan trabajos MapReduce, y quedan muchos trabajos batch
viejos en producción.

**En esta imagen.** Corre sobre YARN (`mapreduce.framework.name=yarn`), con
contenedores de 512 MB para el *ApplicationMaster*, cada mapper y cada
reducer (`mapred-site.xml`). JobHistory en http://localhost:19888 (y RPC en
el 10020). Los ejemplos de Hadoop están en
`$HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar` y
Streaming en `$HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-3.3.6.jar`.

| Comando | Qué hace |
|---|---|
| `hadoop jar <jar> <programa> <entrada> <salida>` | Corre un trabajo en Java (por ejemplo, `wordcount` del jar de ejemplos) |
| `hadoop jar <jar de streaming> -files a.py,b.py -mapper "python3 a.py" -reducer "python3 b.py" -input <hdfs> -output <hdfs>` | Hadoop Streaming: cualquier programa que lea y escriba líneas como mapper y reducer |
| `-D mapreduce.job.reduces=N` (antes de las otras opciones) | Cuántos reducers |
| `mapred job -list` | Los trabajos MapReduce corriendo |

Reglas que siempre aparecen: la carpeta de salida **no** tiene que existir
(si no, `Output directory ... already exists`); la salida es una carpeta con
un `part-r-NNNNN` por reducer (`part-m-NNNNN` si no hay reducers) y un
`_SUCCESS`.

Correr el jar de ejemplos sin argumentos lista los programas que trae (y
termina con error, porque no le dijiste cuál correr):

<!-- prueba: adentro | falla | espera: wordcount -->
```bash
hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar
```

**Aparece en:** [guía 4](../04-yarn-mapreduce.md). Teoría:
[YARN y MapReduce](teoria/03-yarn-mapreduce.md).

## Tez

**Qué hace.** Un motor de ejecución sobre YARN que arma cada consulta como un
**DAG** (un grafo de etapas) y pasa los datos de una etapa a la otra sin
escribirlos en HDFS en el medio, y reusa contenedores entre tareas. Es lo
que hace que Hive sea mucho más rápido que con MapReduce.

**Dónde se usa.** Es el motor por defecto de Hive desde la versión 2 en las
distribuciones de Hadoop (Hortonworks, que lo creó, y después Cloudera) y
puede correr Pig. Fuera de Hive casi no se usa directo: el lugar que ocupa lo
ocupan Spark y los motores SQL como Trino o Impala.

**En esta imagen.** No es un servicio ni tiene comando: Hive lo usa
(`hive.execution.engine=tez`). Sus librerías se suben a HDFS en el primer
arranque (`/apps/tez/tez.tar.gz`, `tez.lib.uris`), con contenedores de 1024 MB
para el *ApplicationMaster* y cada tarea (`tez-site.xml`). Las consultas de
Hive aparecen en http://localhost:8088 con tipo `TEZ`.

**Aparece en:** [guía 6](../06-hive.md#las-piezas). Teoría:
[Hive](teoria/05-hive.md#el-motor-de-ejecución-tez).

## Pig

**Qué hace.** Pig Latin es un lenguaje de **flujo de datos**: cada línea
transforma una relación (cargar, filtrar, agrupar, sumar) y Pig traduce el
script entero a uno o más trabajos MapReduce. No es un servicio: es un
comando.

**Dónde se usa.** Lo creó Yahoo (~2006) para que sus analistas no escribieran
MapReduce en Java, y se usó mucho en ETL sobre Hadoop hasta mediados de la
década de 2010. Hoy es tecnología heredada: lo nuevo se escribe con
DataFrames de Spark o SQL. Se sigue enseñando porque muestra muy claro la
idea de *plan lógico → trabajos MapReduce*.

**En esta imagen.** Pig 0.18.0 contra el Hadoop del contenedor, con
`PIG_HEAPSIZE=512`. Se sacaron del paquete su copia propia de Hadoop, el modo
Spark y los conectores a HBase y Accumulo.

| Comando | Qué hace |
|---|---|
| `pig script.pig` | Corre el script en el cluster (modo `mapreduce`, el de por defecto): lee y escribe en HDFS, trabajos en YARN |
| `pig -x local script.pig` | Sin cluster: archivos de `/datos`, sin HDFS ni YARN. Anda también con `SERVICIOS=hdfs` |
| `pig -param clave=valor script.pig` | Cambia un `%default clave ...` del script |
| `pig` / `pig -x local` | La consola `grunt>` (salir: `quit`) |

| En el script o en `grunt` | Qué hace |
|---|---|
| `DUMP r;` | Ejecuta y muestra la relación `r` |
| `STORE r INTO 'ruta' USING PigStorage(',');` | Ejecuta y guarda en una carpeta (no tiene que existir) |
| `DESCRIBE r;` | El esquema de `r` |
| `EXPLAIN r;` | El plan: lógico, físico y los trabajos MapReduce |
| `fs -ls`, `fs -rm -r -f <ruta>` | Comandos de HDFS desde adentro de Pig (los usa `ventas.pig`) |
| `%default clave 'valor'` | Valor por defecto de un parámetro (`$clave` en el script) |

**Aparece en:** [guía 5](../05-pig.md). Teoría: [Pig](teoria/04-pig.md).

## Hive

**Qué hace.** SQL sobre los archivos de HDFS. Hive no guarda los datos: anota
en el **Metastore** el esquema de cada tabla (columnas, formato, carpeta de
HDFS) y, al consultar, traduce el SQL (HiveQL) a trabajos de Tez sobre esos
archivos. El esquema se aplica **al leer** (*schema on read*).

- **Metastore**: el catálogo de bases, tablas, columnas y particiones. Acá
  guarda todo en una base Derby en `/hadoop/metastore_db` y atiende por
  Thrift en el 9083. Spark usa el mismo.
- **HiveServer2**: el servidor al que se conectan los clientes SQL por JDBC
  (`jdbc:hive2://localhost:10000`), con una web de sesiones y consultas en
  http://localhost:10002.
- **beeline**: el cliente de consola de HiveServer2.

**Dónde se usa.** Lo creó Facebook (2008) para que sus analistas consultaran
Hadoop con SQL; fue el *data warehouse* de Hadoop en casi toda empresa que
tuvo un cluster. Hoy el **Metastore** es todavía más importante que el motor:
es el catálogo que leen Spark, Trino/Presto e Impala, y el AWS Glue Data
Catalog es compatible con él. Como motor SQL, en lo nuevo compite con Trino,
Spark SQL y los *warehouses* de la nube (BigQuery, Snowflake, Redshift).

**En esta imagen.** Con `SERVICIOS=todo`. Lo distinto de fábrica
(`hive-site.xml`): motor `tez`, warehouse en `/user/hive/warehouse`,
`hive.server2.enable.doAs=false` (las consultas corren como el usuario del
servidor) y el caché de resultados **apagado**, para que cada consulta corra
de verdad (y un `INSERT OVERWRITE DIRECTORY` deje siempre su salida en la
carpeta). Logs en `/opt/hive/metastore.log` y `/opt/hive/hiveserver2.log`.
HiveServer2 tarda hasta ~1 min más que HDFS en aceptar conexiones.

| Comando | Qué hace |
|---|---|
| `beeline -u jdbc:hive2://localhost:10000` | Consola SQL (salir: `!quit`) |
| `beeline -u jdbc:hive2://localhost:10000 -f archivo.sql` | Corre un archivo |
| `beeline -u jdbc:hive2://localhost:10000 -e "SELECT ..."` | Una consulta suelta |
| `--outputformat=csv2` | Salida en CSV en vez de la tabla con bordes (sirve para scripts) |
| `--silent=true` | Sin los mensajes de conexión y de progreso |

| HiveQL | Qué hace |
|---|---|
| `SHOW DATABASES;` `SHOW TABLES;` | Bases y tablas |
| `DESCRIBE FORMATTED t;` | Columnas, si es `EXTERNAL_TABLE` o `MANAGED_TABLE`, y su carpeta (`Location`) |
| `CREATE EXTERNAL TABLE ... ROW FORMAT DELIMITED FIELDS TERMINATED BY ',' LOCATION '/carpeta'` | Tabla sobre archivos que ya están en HDFS; `DROP TABLE` no los borra |
| `TBLPROPERTIES ('skip.header.line.count' = '1')` | Saltea el encabezado del CSV |
| `CREATE TABLE t AS SELECT ...` | Tabla administrada, con sus archivos en el warehouse; `DROP TABLE` los borra |
| `INSERT OVERWRITE DIRECTORY '/carpeta' ... SELECT ...` | Guarda un resultado como archivos en HDFS |
| `PARTITIONED BY (col tipo)` | Tabla partida en subcarpetas por el valor de una columna |

**Aparece en:** [guía 6](../06-hive.md), [guía 7](../07-mysql-sqoop.md#3-procesar-en-hive-un-join)
(un JOIN) y [guía 8](../08-spark.md#sql-sobre-las-tablas-de-hive) (desde
Spark). Teoría: [Hive](teoria/05-hive.md).

## Sqoop

**Qué hace.** Copia tablas entre una base relacional (por JDBC) y HDFS, en
las dos direcciones: `import` (base → HDFS) y `export` (HDFS → base). Cada
copia es un trabajo MapReduce **solo de mappers**: parte la tabla en rangos
de una columna (la clave primaria, o la de `--split-by`) y cada mapper copia
un rango. Antes de copiar genera y compila una clase Java para leer la tabla
(por eso la imagen trae el JDK y deja un `<tabla>.java` en la carpeta).

**Dónde se usa.** Fue la forma estándar de cargar un *data lake* de Hadoop
con los datos de los sistemas de la empresa (ventas, facturación, CRM). El
proyecto se **retiró en 2021** (pasó al *Attic* de Apache) y la 1.4.7 es la
última versión; se sigue enseñando porque el problema que resuelve sigue
existiendo. Hoy se hace con Spark leyendo por JDBC, con Apache NiFi, con
herramientas de ingesta como Airbyte o con **CDC** (captura de cambios:
Debezium sobre Kafka, AWS DMS), que en vez de copiar la tabla entera manda
cada cambio a medida que pasa.

**En esta imagen.** Sqoop 1.4.7 con el driver `mysql-connector-java-5.1.49`
(el que espera Sqoop) y `commons-lang` 2.6, que Hadoop 3 ya no trae. Los
avisos de HBase, HCatalog y Accumulo están silenciados (esos sistemas no
están); los `WARN` que quedan son normales. Necesita `SERVICIOS=mapreduce` o
`todo` (sin YARN no hay MySQL ni dónde correr los mappers).

| Comando | Qué hace |
|---|---|
| `sqoop list-databases --connect jdbc:mysql://localhost ...` | Las bases del servidor |
| `sqoop list-tables --connect jdbc:mysql://localhost/tienda ...` | Las tablas de una base |
| `sqoop eval --connect ... --query "SQL"` | Corre SQL directo en la base (sin Hadoop): para probar o para un `TRUNCATE` |
| `sqoop import --connect ... --table t --target-dir /carpeta` | Base → HDFS |
| `sqoop export --connect ... --table t --export-dir /carpeta` | HDFS → base (la tabla tiene que existir) |

| Opción | Qué hace |
|---|---|
| `--connect jdbc:mysql://localhost/tienda` | La base, como URL de JDBC |
| `--username alumno --password alumno` | El usuario (`-P` la pide por teclado, sin dejarla en la línea de comandos) |
| `--table t` | La tabla |
| `--target-dir` / `--export-dir` | La carpeta de HDFS, para `import` / `export` |
| `--delete-target-dir` | Borra la carpeta destino antes de importar |
| `-m N` | Cuántos mappers en paralelo (= cuántos archivos `part-m-*`) |
| `--split-by col` | Por qué columna partir (si la tabla no tiene clave primaria; si no, `-m 1`) |
| `--where "cond"` | Solo las filas que cumplen |
| `--columns "a,b,c"` | Solo esas columnas |
| `--query "SELECT ... WHERE \$CONDITIONS"` | Importar una consulta (con `--split-by` o `-m 1`; Sqoop reemplaza `$CONDITIONS` por el rango de cada mapper) |
| `--fields-terminated-by '\t'` | Otro separador al importar (al exportar: `--input-fields-terminated-by`) |

`--hive-import` (crear la tabla de Hive directo) existe, pero Sqoop 1.4.7 es
anterior a Hive 4: las pruebas de la imagen lo prueban solo como informativo.
El camino de las guías es importar a una carpeta y crear encima una tabla
`EXTERNAL`.

**Aparece en:** [guía 7](../07-mysql-sqoop.md). Teoría:
[Sqoop](teoria/06-sqoop.md).

## MySQL (MariaDB)

**Qué hace.** Una base de datos relacional común (OLTP): el "sistema de
ventas" de la empresa de ejemplo, del que Sqoop trae los datos al cluster. No
es parte de Hadoop ni guarda nada en HDFS.

**Dónde se usa.** MySQL y MariaDB (su derivado, compatible) son de las bases
más usadas en sistemas web y de gestión; junto con PostgreSQL, Oracle y SQL
Server son las fuentes típicas de un *data lake*.

**En esta imagen.** MariaDB 10.11, con `SERVICIOS=mapreduce` o `todo`. Datos
en el volumen (`/hadoop/mysql`), configurada chica (~100 MB de memoria,
`conf/mysql.cnf`), log en `/var/log/mysql/error.log`. La primera vez crea:

- La base **`tienda`** (`ejemplos/tienda.sql`): `productos` (8), `sucursales`
  (4), `ventas` (las 200.000 de `ventas_grandes.csv`, con `id` como clave
  primaria) y `resumen_categoria` (vacía: ahí devuelve Sqoop).
- El usuario **`alumno`**, clave **`alumno`**, con todos los permisos, para
  Sqoop y para entrar desde tu compu.

| Comando (adentro) | Qué hace |
|---|---|
| `mysql tienda` | Consola SQL en la base `tienda` (salir: `exit`). Adentro entra como `root` sin clave |
| `mysql tienda < archivo.sql` | Corre un archivo |
| `mysql -N -B -e "SELECT ..."` | Una consulta suelta, sin encabezado y separada por tabs |

Desde tu compu (DBeaver, MySQL Workbench): `localhost:3306`, usuario
`alumno`, clave `alumno`, base `tienda`, con el `-p 127.0.0.1:3306:3306` del
`docker run`. Para recrear la base de cero, los dos comandos del comentario
de `ejemplos/tienda.sql`.

**Aparece en:** [guía 7](../07-mysql-sqoop.md#la-base-mysql-tienda). Teoría:
[Sqoop](teoria/06-sqoop.md).

## Spark

**Qué hace.** Un motor de procesamiento distribuido que guarda en **memoria**
lo intermedio y planifica el trabajo entero antes de correrlo (evaluación
*lazy*). Un programa tiene un **driver** (tu programa, que arma el plan) y
**executors** (en contenedores de YARN, procesan los datos). Se programa con
DataFrames (en Python, Scala, Java o R) o con SQL. El **History Server**
muestra las aplicaciones terminadas.

**Dónde se usa.** Nació en la Universidad de Berkeley (2009) y hoy es el motor
de procesamiento más usado en Big Data: ETL, SQL, *machine learning* (MLlib)
y streaming, en clusters de Hadoop, en Kubernetes y en servicios como
Databricks, Amazon EMR, Google Dataproc o Azure Synapse. Alternativas según el
caso: Flink (streaming), Trino (SQL interactivo), y para datos que entran en
una sola máquina, pandas, Polars o DuckDB.

**En esta imagen.** Spark 3.5.9 sobre YARN (`spark.master yarn`, modo
`client`: el driver corre en tu consola), con valores chicos para que entren
varios trabajos en los 4 GB de YARN (`spark-defaults.conf`):

| Propiedad | Valor |
|---|---|
| `spark.driver.memory`, `spark.yarn.am.memory`, `spark.executor.memory` | 512m |
| `spark.executor.instances` / `spark.executor.cores` | 2 / 1 |
| `spark.sql.shuffle.partitions` | 4 (de fábrica, 200) |
| `spark.yarn.archive` | `/apps/spark/spark-libs.jar` en HDFS (las librerías se suben una sola vez) |
| `spark.eventLog.dir` | `/spark-logs` en HDFS (lo lee el History Server) |
| `spark.sql.catalogImplementation` | `hive`: las tablas son las del Metastore de Hive |

PySpark usa `python3` (`PYSPARK_PYTHON`). Los logs del History Server están
en `/opt/spark/logs/`.

| Comando | Qué hace |
|---|---|
| `spark-submit programa.py` | Corre un programa de PySpark en YARN |
| `pyspark` | Consola de Python con la variable `spark` ya creada (salir: `exit()`) |
| `--num-executors N`, `--executor-memory 1g`, `--conf clave=valor` | Opciones de `spark-submit` y `pyspark` para cambiar los valores de arriba en un trabajo |

Mientras corre una aplicación, su web está en http://localhost:4040 (una
segunda al mismo tiempo usa el 4041, que el `docker run` de la guía no
expone: se llega desde http://localhost:8088 → *ApplicationMaster*).
Terminada, en http://localhost:18080. `spark.stop()` al final del programa
libera la memoria de YARN.

**Aparece en:** [guía 8](../08-spark.md). Teoría: [Spark](teoria/07-spark.md).

## ZooKeeper

**Qué hace.** Un servicio de **coordinación**: un árbol chico de datos
(*znodes*) replicado y consistente, con nodos *efímeros* que desaparecen si
se cae el proceso que los creó. Sobre eso se arman candados, elección de
líder y configuración compartida. En HDFS con alta disponibilidad, elige cuál
NameNode es el **active**.

Con `NAMENODES=2` o `3` aparecen además:

- **JournalNodes** (3): guardan el registro de cambios (*edits*) de HDFS. El
  NameNode activo escribe ahí y los standby leen; hace falta la mayoría (2 de
  3) para escribir.
- **ZKFC** (*ZooKeeper Failover Controller*), uno por NameNode: vigila a su
  NameNode y compite en ZooKeeper por el candado
  `/hadoop-ha/sandbox/ActiveStandbyElectorLock`. El que lo tiene es el
  activo.

**Dónde se usa.** Nació en Yahoo y es la pieza de coordinación del ecosistema
Hadoop: HA de HDFS y de YARN, HBase, Solr, y Kafka hasta que lo reemplazó por
su propio protocolo (KRaft). Fuera de Hadoop, el mismo papel lo cumplen etcd
(el de Kubernetes) y Consul.

**En esta imagen.** ZooKeeper 3.8.7 de **un solo nodo** (en producción son 3
o 5), puerto 2181, datos en `/hadoop/zookeeper`, solo con `NAMENODES` 2 o 3.
Admite las órdenes de cuatro letras `stat`, `ruok`, `srvr` y `mntr`. Como
todos los NameNodes están en la misma máquina, no hay *fencing* real
(`dfs.ha.fencing.methods=shell(/bin/true)`).

| Comando (adentro, con HA) | Qué hace |
|---|---|
| `namenode` | Los NameNodes y cuál es el activo ([abajo](#namenode)) |
| `hdfs haadmin -getAllServiceState` | El estado de cada NameNode según Hadoop |
| `zkCli.sh -server localhost:2181` | Consola de ZooKeeper: `ls /`, `get <znodo>`, `stat <znodo>`, salir con `quit` |
| `zkCli.sh -server localhost:2181 ls /hadoop-ha/sandbox` | El candado de la elección (`ActiveStandbyElectorLock`, `ActiveBreadCrumb`) |

**Aparece en:** [guía 9](../09-zookeeper-ha.md). Teoría:
[ZooKeeper y alta disponibilidad](teoria/08-zookeeper-ha.md).

## MongoDB

**Qué hace.** Una base **NoSQL de documentos**: guarda documentos BSON
(parecidos a JSON) en colecciones, sin columnas fijas, con listas y
subdocumentos adentro. Consulta con filtros, un *pipeline* de agregación e
índices; escala repartiendo colecciones entre servidores (*sharding*) y
replica con *replica sets*.

**Dónde se usa.** Catálogos de productos, perfiles de usuario, contenidos,
eventos de aplicaciones: datos con forma variable que se leen de a un
documento. Alternativas: Couchbase, Amazon DocumentDB, Firestore, o
PostgreSQL con columnas `jsonb`. Para análisis grandes, los datos de MongoDB
se suelen llevar a un *data lake* (Spark tiene un conector).

**En esta imagen.** MongoDB 8.0 y `mongosh`, solo con `MONGODB=si` (anda con
cualquier `SERVICIOS`). Un solo servidor sin usuario ni clave, puerto 27017,
datos en `/hadoop/mongodb`, caché de 0,25 GB (`conf/mongod.conf`), log en
`/var/log/mongodb/mongod.log`. En Intel/AMD necesita **AVX**: sin eso, el
arranque avisa y sigue sin MongoDB. La primera vez carga la base `tienda`
(`ejemplos/tienda_mongo.js`): `productos` (9), `clientes` (2.000) y
`pedidos` (20.000), con índices en `pedidos` por `cliente_id` y por
`items.producto`.

| Comando | Qué hace |
|---|---|
| `mongosh tienda` | Consola en la base `tienda` (salir: `exit`) |
| `mongosh --quiet tienda archivo.js` | Corre un script |
| `mongosh --quiet tienda --eval "..."` | Una consulta suelta |
| `mongosh --quiet ejemplos/tienda_mongo.js` | Recarga la base `tienda` de cero |

Desde tu compu, MongoDB Compass con `mongodb://localhost:27017` (con el
`-p 127.0.0.1:27017:27017`).

**Aparece en:** [guía 10](../10-mongodb.md). Teoría:
[MongoDB y NoSQL](teoria/09-mongodb.md).

## Puertos y páginas web

Los que tienen `-p` en el `docker run` de la [guía 2](../02-arrancar-y-apagar.md)
se abren desde el navegador de tu compu. Los internos los usan los procesos
entre sí, adentro del contenedor.

| Puerto | Qué es | Cuándo está | En el `docker run` de la guía 2 |
|---|---|---|---|
| 9870 | NameNode, web (NameNode 1 con HA) | siempre | sí |
| 9871, 9872 | NameNodes 2 y 3, web | `NAMENODES` 2 o 3 | no (la guía 9 los expone) |
| 9000 | NameNode, RPC: `hdfs://localhost:9000` (con HA, 9000 a 9002) | siempre | no (interno) |
| 9868 | Secondary NameNode, web | sin HA | sí |
| 9901 a 9909 | DataNode N, web (9900 + N) | según `DATANODES` | sí |
| 9911 a 9919, 9921 a 9929 | DataNode N, transferencia de bloques e IPC | según `DATANODES` | no (interno) |
| 8480 a 8482 | JournalNodes, web | HA | no (la guía 9 los expone) |
| 8485 a 8487 | JournalNodes, RPC | HA | no (interno) |
| 8019 a 8021 | ZKFC de cada NameNode (sin web) | HA | no (interno) |
| 2181 | ZooKeeper | HA | no (interno) |
| 8088 | YARN ResourceManager, web | `mapreduce` o `todo` | sí |
| 8042 | YARN NodeManager, web | `mapreduce` o `todo` | sí |
| 19888 | MapReduce JobHistory, web | `mapreduce` o `todo` | sí |
| 10020 | MapReduce JobHistory, RPC | `mapreduce` o `todo` | no (interno) |
| 3306 | MySQL (`alumno` / `alumno`) | `mapreduce` o `todo` | sí |
| 9083 | Hive Metastore (Thrift) | `todo` | no (interno) |
| 10000 | HiveServer2, JDBC | `todo` | sí |
| 10002 | HiveServer2, web | `todo` | sí |
| 18080 | Spark History Server, web | `todo` | sí |
| 4040 | La aplicación de Spark que está corriendo (la siguiente, 4041...) | con un `spark-submit` o `pyspark` abierto | sí (solo el 4040) |
| 27017 | MongoDB | `MONGODB=si` | sí |

El `127.0.0.1:` de cada `-p` hace que solo se vean desde tu compu y no desde
la red del aula. Si un puerto ya está ocupado en tu compu, se cambia el
número de la izquierda (`-p 127.0.0.1:18088:8088`).

## Parámetros del `docker run`

Se pasan con `-e NOMBRE=valor`. Los valida `entrypoint.sh` al arrancar: si uno
está mal, el contenedor se apaga y `docker logs` dice cuál, con
`[sandbox] ERROR:` y el motivo.

| Parámetro | Qué elige | Por defecto | Valores | Si está mal, el log dice |
|---|---|---|---|---|
| `DATANODES` | Cuántos DataNodes | 1 | 1 a 9 | `DATANODES=...: tiene que ser un numero de 1 a 9` |
| `REPLICATION` | Copias de cada bloque | 1 | 1 a 9 | `REPLICATION=...: tiene que ser un numero de 1 a 9` |
| `BLOCK_SIZE` | Tamaño de bloque | `128m` | número + `m` o `g` (`1m`, `32m`, `1g`), mínimo `1m` | `BLOCK_SIZE=...: numero + m o g (ej. 1m, 32m, 128m, 1g). Minimo 1m` |
| `NAMENODES` | NameNodes: 2 o 3 activan la alta disponibilidad | 1 | 1 a 3 | `NAMENODES=...: tiene que ser un numero de 1 a 3` |
| `SERVICIOS` | Qué se prende además de HDFS | `todo` | `hdfs`, `mapreduce`, `todo` | `SERVICIOS=...: tiene que ser hdfs, mapreduce o todo` |
| `MONGODB` | Prender MongoDB | `no` | `si`, `no` (también `sí`, `SI`) | `MONGODB=...: tiene que ser si o no` |
| `JUPYTER` | JupyterLab | `si` | `si`, `no` | En `base` no hay JupyterLab: si lo pedís, el log avisa que viene en la versión `ml` |

Qué prende cada valor de `SERVICIOS` (MongoDB va aparte, con `MONGODB=si`):

| `SERVICIOS` | Procesos | RAM para Docker |
|---|---|---|
| `hdfs` | NameNode, Secondary NameNode (o ZooKeeper, JournalNodes y ZKFC con HA) y DataNodes | 4 GB |
| `mapreduce` | lo de `hdfs` + ResourceManager, NodeManager, JobHistory y MySQL | 5 GB |
| `todo` | lo de `mapreduce` + Hive Metastore, HiveServer2 y Spark History Server | 6 GB |

Lo que conviene saber:

- **`NAMENODES` queda fijo al crear el volumen** (se graba en
  `/hadoop/namenodes`): pasar de 1 a 2 cambia el formato de los metadatos. Si
  después pedís otro valor, el log avisa `AVISO: este volumen se creo con N
  NameNode(s)` y usa el grabado. Para cambiarlo, otro volumen.
- `DATANODES`, `REPLICATION`, `BLOCK_SIZE`, `SERVICIOS` y `MONGODB` se
  cambian recreando el contenedor con el mismo volumen
  ([guía 2](../02-arrancar-y-apagar.md#cambiar-los-parámetros)). La
  replicación y el bloque nuevos valen para lo que se suba desde ese momento.
- Con `REPLICATION` mayor que `DATANODES`, `estado` avisa que los bloques
  quedan sub-replicados (no hay dónde poner tantas copias).
- Si bajás `DATANODES` y faltan bloques, HDFS no sale solo de *safe mode*: a
  los 120 s el arranque lo fuerza, con un `AVISO` que sugiere `hdfs fsck /`.
- `ROL`, `RED`, `MAESTRO`, `NODO`, `PCS_POR_FILA`, `TRABAJADOR_RAM` y
  `MAESTRO_NM` son de la versión `empresa` (el cluster del aula, un nodo por
  PC). En `base` no se usan: dejalas sin definir.

### Variables fijas de la imagen

Las define el `Dockerfile`; no hace falta tocarlas, pero aparecen en los
comandos:

| Variable | Valor |
|---|---|
| `HADOOP_HOME`, `HIVE_HOME`, `TEZ_HOME`, `SPARK_HOME`, `PIG_HOME`, `SQOOP_HOME`, `ZK_HOME` | `/opt/hadoop`, `/opt/hive`, `/opt/tez`, `/opt/spark`, `/opt/pig`, `/opt/sqoop`, `/opt/zookeeper` |
| `HADOOP_CONF_DIR`, `YARN_CONF_DIR` | `/opt/hadoop/etc/hadoop` |
| `HIVE_CONF_DIR` | `/opt/hive/conf` |
| `PYSPARK_PYTHON` | `python3` |
| `PIG_HEAPSIZE` | `512` (MB) |
| `HADOOP_CLIENT_OPTS` | `-XX:+UseSerialGC -XX:TieredStopAtLevel=1`: cada comando (`hdfs`, `hive`, `pig`) es una JVM nueva; así arranca más rápido y ocupa menos |
| `SANDBOX_VERSION` | `base` (lo muestra `estado` al final) |

Cada daemon arranca con un tope de memoria chico (`sandbox/lib.sh`): NameNode
y ResourceManager 384 MB; DataNode, Secondary NameNode, NodeManager y
JobHistory 256 MB; JournalNode, ZKFC y ZooKeeper 128 MB; Spark History
256 MB. Los trabajos corren en contenedores de YARN aparte, con su propia
memoria.

## Comandos propios de la imagen

Están en `/opt/sandbox/bin`, el primero en el `PATH`.

### `estado`

Muestra la arquitectura del cluster: arriba, cuántos NameNodes y DataNodes
hay, la replicación, el tamaño de bloque y `SERVICIOS`; abajo, una fila por
proceso con su dirección y si está **arriba** o **ABAJO** (mira si su puerto
escucha). Agrega lo que ve el NameNode activo: DataNodes vivos y muertos,
bloques, sub-replicados y perdidos. Al final, la versión de la imagen. Es lo
mismo que imprime el arranque después de *Cluster LISTO*. Se corre adentro
(`estado`) o desde tu compu (`docker exec bigdata estado`).

### `datanode`

| Uso | Qué hace |
|---|---|
| `datanode` | Lista los DataNodes: número, web, carpeta de datos y si está `arriba` o `APAGADO` |
| `datanode stop N` | Apaga el DataNode N (simula que se cae ese nodo). El NameNode lo da por muerto en ~40 s y después re-replica sus bloques |
| `datanode start N` | Lo prende. Si N es mayor que `DATANODES`, suma un nodo nuevo (que no vuelve al reiniciar el contenedor: para que quede, recrealo con `-e DATANODES=N`) |

### `namenode`

| Uso | Qué hace |
|---|---|
| `namenode` | Lista los NameNodes, su web y su estado (`active`, `standby` o `APAGADO`) |
| `namenode stop N` | Apaga el NameNode N. Con HA, otro toma el control; sin HA, HDFS queda sin servicio |
| `namenode start N` | Lo prende. Con HA vuelve como `standby` |

Con HA (de la [guía 9](../09-zookeeper-ha.md#un-cluster-con-ha-aparte)):

```text
  NameNode 1 (nn1)  http://localhost:9870  active
  NameNode 2 (nn2)  http://localhost:9871  standby
```

### `jps`

Reemplaza al `jps` del JDK: lista los procesos Java (PID y clase principal)
y les suma la instancia de Hadoop, para distinguir varios iguales:
`DataNode (dn2)`, `NameNode (nn1)`, `JournalNode (jn3)`.

### `ls`, `df` y `du`

Llaman a los de Linux sin la variable `BLOCK_SIZE`: los de Linux la leen
(con el mismo nombre que el parámetro de HDFS) y con `BLOCK_SIZE=1m`
mostrarían todo en MB.

### Ver lo que generó el arranque

La configuración que usan los clientes está en `$HADOOP_CONF_DIR`; la de cada
instancia (cada DataNode, cada NameNode con HA) en `/opt/sandbox/run/<instancia>`:

<!-- prueba: adentro | espera: dfs.replication -->
```bash
cat $HADOOP_CONF_DIR/hdfs-site.xml
ls /opt/sandbox/run
jps
```

## Volúmenes y carpetas

### `/hadoop`: el volumen

Todo lo que tiene que sobrevivir a apagar y a borrar el contenedor
(`-v bigdata_hadoop:/hadoop`):

| Ruta | Qué guarda |
|---|---|
| `/hadoop/dfs/name` | Metadatos del NameNode (`fsimage` y `edits`), sin HA |
| `/hadoop/dfs/secondary` | Checkpoints del Secondary NameNode |
| `/hadoop/dfs/dn1` ... `dn9` | Los bloques de cada DataNode |
| `/hadoop/dfs/nn1` ... `nn3`, `/hadoop/dfs/jn1` ... `jn3` | Con HA: metadatos de cada NameNode y registro de cada JournalNode |
| `/hadoop/namenodes` | El `NAMENODES` con que se creó el volumen |
| `/hadoop/tmp` | Temporales de Hadoop (`hadoop.tmp.dir`) |
| `/hadoop/zookeeper` | Datos de ZooKeeper (con HA) |
| `/hadoop/metastore_db` | El Metastore de Hive (Derby) |
| `/hadoop/mysql` | La base MySQL |
| `/hadoop/mongodb` | La base MongoDB |

Y unas marcas de "esto ya se hizo", para no repetir lo lento en cada arranque:
`.dirs-hdfs` (carpetas de HDFS), `.libs-hdfs` (librerías de Tez y Spark),
`.metastore-listo`, `.zk-listo`, y `.sandbox-listo` adentro de `mysql/` y
`mongodb/`. Borrar el volumen (`docker volume rm bigdata_hadoop`) es empezar
de cero ([guía 11](../11-problemas.md#empezar-de-cero)).

### `/datos`: tu carpeta

Es la carpeta `datos/` de tu compu (`-v "$(pwd)/datos:/datos"`) y donde
arrancás adentro. En cada arranque se copian los ejemplos a
`/datos/ejemplos`, **sin pisar** los que ya estén: si editaste uno, queda tu
versión; para recuperar el original, borralo y reiniciá el contenedor. Los
originales están en `/opt/sandbox/ejemplos`.

| Archivo de `ejemplos/` | Qué es | Guía |
|---|---|---|
| `ventas.csv` | 7 ventas, para mirar a ojo | [3](../03-hdfs.md) |
| `generar_ventas.py` | Genera `ventas_grandes.csv` (200.000 ventas, siempre iguales) | [3](../03-hdfs.md#un-dataset-de-verdad-200000-ventas) |
| `texto.txt`, `mapper.py`, `reducer.py` | Wordcount y el MapReduce en Python | [4](../04-yarn-mapreduce.md) |
| `wordcount.pig`, `ventas.pig` | Scripts de Pig | [5](../05-pig.md) |
| `ventas.hql` | Tabla externa y consultas de Hive | [6](../06-hive.md) |
| `tienda.sql`, `tienda.hql`, `sqoop.sh` | La base MySQL, el JOIN en Hive y Sqoop de punta a punta | [7](../07-mysql-sqoop.md) |
| `ventas.py` | El mismo cálculo en PySpark | [8](../08-spark.md) |
| `tienda_mongo.js`, `consultas_mongo.js` | La base MongoDB y sus consultas | [10](../10-mongodb.md) |

### Carpetas de HDFS que crea el arranque

| Carpeta | Para qué |
|---|---|
| `/user/root` | Tu "home" en HDFS: las rutas relativas parten de acá |
| `/tmp` | Temporales de los trabajos (permisos `1777`) |
| `/user/hive/warehouse` | Las tablas administradas de Hive y Spark |
| `/apps/tez/tez.tar.gz`, `/apps/spark/spark-libs.jar` | Las librerías de Tez y Spark (con bloque de 128m aunque `BLOCK_SIZE` sea chico) |
| `/spark-logs` | El historial de Spark |

### Logs

| Dónde | De qué |
|---|---|
| `docker logs bigdata` | El arranque y, después, los logs de Hadoop, Hive y MySQL juntos |
| `/opt/hadoop/logs/` | Un log por proceso: `hadoop-nn1-namenode-*.log`, `hadoop-dn2-datanode-*.log`... |
| `/opt/hive/metastore.log`, `/opt/hive/hiveserver2.log` | Hive |
| `/opt/spark/logs/` | Spark History Server |
| `/opt/zookeeper/logs/` | ZooKeeper |
| `/var/log/mysql/error.log`, `/var/log/mongodb/mongod.log` | MySQL y MongoDB |

## Qué hace el arranque, paso a paso

Lo que hace `entrypoint.sh` desde el `docker start` hasta *Cluster LISTO*:

1. **Valida los parámetros** y lee el `NAMENODES` grabado en el volumen.
2. Copia los ejemplos a `/datos/ejemplos` y **genera la configuración**
   (`core-site.xml`, `hdfs-site.xml`, `tez-site.xml`, `spark-defaults.conf`)
   según los parámetros.
3. **HDFS**: la primera vez formatea el NameNode. Prende el NameNode y el
   Secondary (con HA: ZooKeeper, los JournalNodes, los NameNodes con sus
   ZKFC, y espera la elección del activo) y los DataNodes en paralelo.
4. Espera que HDFS salga de *safe mode* (hasta 120 s) y que todos los
   DataNodes estén anotados en el NameNode.
5. La primera vez, crea las [carpetas de HDFS](#carpetas-de-hdfs-que-crea-el-arranque).
6. Con `mapreduce` o `todo`: **YARN** y JobHistory, y **MySQL** (la primera
   vez, la base `tienda` y el usuario `alumno`).
7. Con `MONGODB=si`: **MongoDB** (la primera vez, su base `tienda`).
8. Con `todo`: la primera vez sube las librerías de Tez y Spark e inicializa
   el schema del Metastore; prende el **Metastore**, **HiveServer2** y el
   **Spark History Server**, y espera que HiveServer2 acepte conexiones.
9. Imprime *Cluster LISTO* y `estado`, y se queda mostrando los logs.

Con `docker stop` apaga en orden: primero Hive y el historial de Spark
(mientras HDFS sigue arriba), junto con MySQL y MongoDB; cuando esos
terminan, el resto de los procesos Java (YARN, HDFS y ZooKeeper). Por eso el
`--stop-timeout 20`: le da tiempo a cerrar todo prolijo.
