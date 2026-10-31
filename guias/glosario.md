# Glosario

Las palabras del cluster, ordenadas por capa, igual que el mapa de Inicio y la
barra lateral de `full`: dónde viven los datos, quién reparte la máquina, qué
hace las cuentas (motores), cómo se las pedís (lenguajes) y cómo entran los
datos. Es el mismo texto que muestra el `?` de cada pantalla de la interfaz.

[← Guías](README.md)

<!-- La interfaz lee este archivo (ui/src/help/glosario.ts): cada "##" es una capa, cada "###" un término
     y los párrafos de abajo su definición. Solo negrita, cursiva, `código` y enlaces adentro del texto. -->

## Almacenamiento: dónde viven los datos

Lo que guarda. Spark, MapReduce y Hive como motor no guardan nada: leen de acá
y escriben acá.

### HDFS

El sistema de archivos distribuido de Hadoop. Parte cada archivo en bloques y
guarda cada bloque en varias máquinas, así un disco que se rompe no se lleva
los datos. Se usa con `hdfs dfs -ls`, `-put` y `-cat`, como una carpeta más.

*En el sandbox:* la página del NameNode está en `localhost:9870` y la
pantalla HDFS de `full` muestra en qué DataNode quedó cada bloque.

### Bloque

El pedazo en que HDFS corta un archivo. Es la unidad que se replica y la que
lee cada tarea de map: un archivo de 6 bloques arranca 6 mappers.

*En el sandbox:* son de 1 MB (`BLOCK_SIZE=1m`) para que un CSV chico ya
ocupe varios; en un cluster real, 128 MB.

### Réplica

Cada copia de un bloque, en un DataNode distinto. El factor de replicación
dice cuántas: con 2, si se cae un DataNode el bloque sigue en otro y el
NameNode copia de nuevo lo que faltó.

*No confundir con:* un backup. Las réplicas protegen de una máquina caída, no
de un `hdfs dfs -rm` (se borran todas juntas).

### NameNode

El que sabe qué archivos hay, de qué bloques están hechos y en qué DataNode
está cada bloque. No guarda los datos, solo el índice. Si es uno solo y se
cae, HDFS deja de responder; por eso existe la alta disponibilidad.

### DataNode

El proceso que guarda los bloques en el disco de cada máquina. Le manda un
latido al NameNode cada 3 segundos; si deja de mandarlo un rato, el NameNode
lo da por muerto y copia sus bloques a otros.

### Rack

Un grupo de máquinas conectadas al mismo switch. HDFS pone las réplicas de un
bloque en racks distintos, para que un switch caído no se lleve todas.

*En el sandbox:* en `empresa`, cada fila del laboratorio es un rack.

### Formato de archivo

Cómo están escritos los datos adentro de los archivos. En texto (CSV, JSON)
se lee fila por fila y entero; en un formato columnar (Parquet, ORC) se puede
leer solo las columnas que hacen falta. Hive y Spark necesitan saber el formato
para leer una tabla.

### Parquet y ORC

Formatos columnares: guardan cada columna junta, comprimida y con su tipo. Una
consulta que usa 2 columnas de 20 lee mucho menos que con un CSV. Parquet es el
de Spark; ORC, el de Hive; los dos leen los dos.

### Data lake

No es una herramienta: es HDFS más una forma de ordenar las carpetas por
zonas, del dato crudo (como llegó) al limpio y al listo para usar. Todo queda
en archivos, y las tablas del Metastore los describen.

### Metastore

El catálogo de Hive: la lista de tablas, con sus columnas, su formato y la
carpeta de HDFS donde están los archivos. No guarda las filas. Lo comparten
Hive y Spark SQL, por eso una tabla creada en Hive se lee desde Spark.

*En el sandbox:* la pantalla Tablas muestra lo que anotó de cada tabla y
adónde apunta.

### Tabla externa

Una tabla que apunta a una carpeta que ya existía. `DROP TABLE` borra la
entrada del Metastore y deja los archivos donde estaban. Es la forma de poner
SQL arriba de datos que llegaron por otro lado.

### Tabla administrada

Una tabla cuya carpeta es de Hive (en `/user/hive/warehouse`). `DROP TABLE`
borra también los archivos.

### Partición de tabla

Una subcarpeta por valor de una columna (por ejemplo `fecha=2026-01-31`).
Una consulta que filtra por esa columna lee solo las carpetas que le sirven.

*No confundir con:* las particiones de Spark, que son pedazos de un DataFrame
en memoria.

### MariaDB

Una base relacional (compatible con MySQL): tablas con filas, claves,
índices y transacciones, en una sola máquina. Contesta en milisegundos y no
usa YARN. En el sandbox es la base tienda, de donde Sqoop trae las ventas.

### MongoDB

Una base de documentos: cada registro es un JSON que puede traer listas
adentro (un pedido con sus ítems). También corre en una sola máquina, fuera de
Hadoop.

### Índice

Una lista ordenada de los valores de una columna que le evita a la base
recorrer toda la tabla. En el plan se ve la diferencia: con índice busca, sin
índice recorre todo (en MongoDB, COLLSCAN).

## Recursos: quién corre dónde

YARN no guarda ni hace cuentas: decide en qué máquina corre cada pedazo de
trabajo y con cuánta memoria. Lo usan MapReduce, Tez y Spark.

### YARN

El administrador del cluster. Cada trabajo le pide memoria y CPU, y YARN se
los da en contenedores, en las máquinas que tienen lugar (mejor si es donde
está el bloque que hay que leer).

*En el sandbox:* la pantalla Trabajos y `localhost:8088`.

### ResourceManager

El proceso central de YARN: sabe cuánta memoria tiene libre cada máquina y
reparte. Si se cae, no arranca ningún trabajo nuevo.

### NodeManager

El proceso de YARN en cada máquina: presta su memoria y su CPU, arranca los
contenedores que le manda el ResourceManager y los vigila.

*En el sandbox:* uno solo, con 4 GB para repartir.

### Contenedor

Un pedazo de memoria y CPU de una máquina, prestado a un trabajo. Ahí corre
una tarea de map o de reduce, un vértice de Tez o un executor de Spark. Cuando
termina, la memoria vuelve a YARN.

### ApplicationMaster

El primer contenedor de cada trabajo: el que le pide a YARN el resto de los
contenedores y sigue cómo van. En Spark en modo cluster, el driver vive ahí; en
modo client (el del sandbox), el driver corre donde se escribió `spark-submit`.

### Cola

Por dónde entra cada trabajo a YARN, con una parte de la memoria del cluster.
Si no hay lugar, el trabajo espera en la cola (en la lista figura ACCEPTED).

### Localidad

Correr la tarea en la máquina que tiene el bloque, para no mandarlo por la red.
YARN lo intenta primero en el mismo nodo, después en el mismo rack. MapReduce
la cuenta en DATA_LOCAL_MAPS.

### Memoria por tiempo

Los MB de cada contenedor por los segundos que estuvo vivo, sumados (MB·s). Es
lo que de verdad ocupó un trabajo en el cluster: uno rápido que pide mucha
memoria puede costar más que uno lento y chico. Lo informa el ResourceManager.

### JobHistory y Spark History

Los historiales de los trabajos que ya terminaron, con sus contadores: lo
leído de HDFS, el shuffle, las tareas. JobHistory es el de MapReduce
(`localhost:19888`) y Spark History el de Spark (`localhost:18080`). Tez no
tiene uno propio sin el Timeline Server.

## Procesamiento: los motores

Quién hace la cuenta. Casi todo parte de la idea de MapReduce: repartir
(*map*), agrupar por clave (*shuffle*) y combinar (*reduce*). **Hive y Pig son
lenguajes; MapReduce, Tez y Spark son motores.**

### Motor

Lo que ejecuta el trabajo en el cluster, con sus fases y sus contenedores. En
YARN es la columna Application Type: MAPREDUCE, TEZ o SPARK. El mismo lenguaje
puede correr en más de un motor (Hive en Tez o en MapReduce).

### MapReduce

El motor original de Hadoop: dos fases fijas, map y reduce, con un shuffle en
el medio. Entre un trabajo y el siguiente escribe todo en HDFS, así que una
cuenta de varios pasos son varios trabajos y mucho disco.

### Map

La primera fase: cada tarea lee un bloque y, por cada registro, emite pares
clave y valor (por ejemplo, producto e importe).

### Shuffle

El paso del medio: ordenar los pares por clave y mandarlos por la red, para
que todo lo de un mismo producto llegue a la misma tarea de reduce. Suele ser
lo más caro de un trabajo.

### Reduce

La última fase: recibe todos los valores de una clave juntos y los combina
(suma, cuenta, promedio) en una fila del resultado.

### Combiner

Un reduce chico que corre en cada mapper antes del shuffle: suma lo que puede
ahí mismo y manda menos por la red. Spark, Hive y Pig lo hacen solos cuando la
cuenta lo permite; con Hadoop Streaming hay que pedirlo.

### Spill

Lo que un mapper escribe en su disco local cuando se le llena la memoria de
salida. No va a HDFS: es disco de la máquina, y se vuelve a leer para el
shuffle.

### Tez

Un motor que arma el trabajo como un grafo de pasos (un DAG) y los encadena
sin pasar por HDFS entre uno y otro. Es el que usa Hive en el sandbox: la misma
consulta tarda menos que con MapReduce.

### DAG

Grafo dirigido sin ciclos: los pasos de un trabajo y qué paso le pasa datos a
cuál. Tez lo llama vértices (Map 1, Reducer 2); Spark, etapas.

### Spark

Un motor que arma un DAG y lo corre en memoria cuando entra. Brilla en lo que
repite pasos sobre los mismos datos (ML, grafos) y en lo interactivo. No
guarda nada: lee y escribe en HDFS.

### Driver y executors

En Spark, el driver es el programa que arma el plan y reparte el trabajo; los
executors son los contenedores que hacen las tareas y guardan datos en memoria
mientras dura el programa.

### Etapa

Un tramo de un trabajo de Spark que corre sin shuffle. Cada shuffle corta una
etapa de la siguiente. En Spark History aparecen numeradas (Stage 0, Stage 1…)
y las que reusan un shuffle anterior, como SKIPPED.

### Tarea

La unidad más chica de trabajo: un pedazo de los datos (un bloque, una
partición) procesado en un contenedor. Un map de 6 bloques son 6 tareas.

### Acción y transformación

En Spark, una transformación (`filter`, `groupBy`, `withColumn`) solo anota
qué hacer; una acción (`show`, `count`, `write`) lo corre. Cada acción vuelve a
leer la entrada, salvo que se guarde con `cache()`.

### Cache

Guardar un DataFrame en la memoria de los executors para que la próxima acción
no lo vuelva a leer de HDFS. Es la razón por la que Spark gana en lo
iterativo.

## Procesamiento: los lenguajes

Cómo le pedís la cuenta al cluster. El lenguaje se traduce a trabajos de un
motor: lo que escribís no es lo que corre.

### Lenguaje

La forma de escribir el trabajo: SQL (Hive, Spark SQL), pasos de un flujo
(Pig Latin), Python (PySpark) o un map y un reduce a mano. Cambia cuánto
escribís y cuánto decidís vos; el motor decide cómo corre.

### MapReduce a mano

Escribir vos el map y el reduce. En Java, o en Python con Hadoop Streaming: el
mapper lee líneas por la entrada estándar y escribe `clave<TAB>valor`; el
reducer recibe las líneas ya ordenadas por clave. Es el que más se escribe y el
que mejor muestra el modelo.

### Hive

SQL (HiveQL) sobre las tablas del Metastore, es decir, sobre archivos de HDFS.
Se usa con `beeline`. Si hay que agrupar, unir u ordenar, lanza un trabajo de
Tez en YARN; un `SELECT` con `LIMIT` lo lee directo.

### Pig

Un lenguaje de pasos (Pig Latin): `LOAD`, `FILTER`, `GROUP`, `FOREACH`,
`STORE`. Cada script se traduce a uno o más trabajos de MapReduce. No usa el
Metastore: lee la carpeta y hay que decirle el separador y el esquema.

### Spark SQL y DataFrames

La forma de escribir Spark con tablas: SQL o funciones sobre DataFrames
(`groupBy`, `agg`). Usa el mismo Metastore que Hive, así que lee sus tablas por
el nombre.

### PySpark

Spark desde Python. Lo que se escribe con DataFrames corre igual de rápido que
en Scala, porque Spark lo traduce a su propio plan y lo hacen los executors; lo
lento son las funciones propias en Python (UDF), que corren fila por fila.

### MLlib

La librería de machine learning de Spark: entrena repartiendo los datos entre
los executors, con todos los datos de HDFS.

### scikit-learn

La librería de machine learning de Python para una sola máquina: rápida y
completa, pero los datos tienen que entrar en memoria. Corre fuera de YARN.

### Plan

Lo que el motor va a hacer para resolver una consulta, sin correrla: `EXPLAIN`
en Hive y en MariaDB, `explain()` en MongoDB y en Spark. Ahí se ve si usa un
índice, cuántos pasos arma y dónde hay un shuffle.

## Ingesta: cómo entran y salen los datos

El puente entre el cluster y el resto: archivos de la compu, bases de datos y
de vuelta.

### Ingesta

Traer datos al lake desde afuera: archivos, una base o un flujo de eventos.

### Subir archivos (put)

`hdfs dfs -put archivo /carpeta` copia un archivo de la compu a HDFS, que lo
corta en bloques y lo replica. La interfaz hace lo mismo desde el navegador.

### Sqoop

Copia tablas entre una base relacional (MariaDB) y HDFS o Hive, en los dos
sentidos (`import` y `export`). Por adentro lanza un trabajo de MapReduce que
lee la tabla en partes.

### ETL

Extraer, transformar y cargar: limpiar y dar forma a los datos crudos para que
queden listos para consultar. Pig y Spark lo escriben como pasos; Hive, como
`INSERT … SELECT`.

### Pipeline

Una cadena de pasos que lleva los datos de la fuente al resultado (ingesta,
limpieza, tabla, análisis, modelo), cada uno con su herramienta.

## Coordinación y alta disponibilidad

Lo que hace que el cluster siga andando cuando se cae una pieza central.

### ZooKeeper

Un servicio chico de coordinación: guarda pocos datos, muy replicados, y avisa
cuando cambian. Hadoop lo usa para elegir cuál de los NameNodes está activo.

### Alta disponibilidad

Tener dos o tres NameNodes: uno activo y los otros en espera, listos para
tomar su lugar. Sin eso, el NameNode es un punto único de falla.

### JournalNode

Los procesos que guardan el registro de cambios del NameNode activo, para que
los que esperan estén al día y puedan tomar su lugar sin perder nada.

### Failover

El cambio de NameNode activo cuando el que estaba se cae: ZooKeeper lo nota y
promueve a uno de los que esperaban.

## La misma tarea, con varias herramientas

Casi cualquier cuenta se puede escribir con más de una herramienta. Lo que
cambia es cuánto escribís, qué motor la corre y cuánto mueve. La pantalla
Comparar de `full` corre ventas por producto con las cuatro y las pone una al
lado de la otra.

| Tarea | MapReduce a mano | Pig | Hive | Spark | Qué cambia |
|---|---|---|---|---|---|
| Contar o agrupar | Streaming, con mapper y reducer en Python | `GROUP … BY` y `SUM` | `SELECT … GROUP BY` | `groupBy().agg()` o SQL | Cuánto código hay, qué motor corre y cuánto pasa por el shuffle |
| Unir dos datasets | A mano, un join del lado del reduce | `JOIN` | `JOIN` | `df.join()` | Cuántos shuffles hay y cuánto viaja por la red |
| Limpiar y transformar | Posible, pero largo | Pensado para esto | `INSERT … SELECT` | DataFrames | Pig y Spark escriben pasos; Hive, consultas |
| SQL sobre una tabla | No | No | Sí, con Tez | Sí, con Spark SQL | Misma tabla del Metastore, distinto motor |
| Traer una tabla de MariaDB | No | No | Con Sqoop | Por JDBC | Sqoop es un comando; en Spark es código que sigue procesando |
| Entrenar un modelo | No | No | No | MLlib | Contra scikit-learn: todos los datos repartidos, o una muestra en una máquina |
| Algo que repite pasos | Cada vuelta va a disco | Igual | Igual | En memoria, con `cache()` | Por esto existe Spark |
