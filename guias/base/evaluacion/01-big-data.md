# Evaluación 1. Big Data y el ecosistema Hadoop

[Evaluación](README.md) · Teoría: [Introducción a Big Data](../teoria/01-big-data.md) · Guías: [1](../../01-instalacion.md) y [2](../../02-arrancar-y-apagar.md) · Siguiente: [2. HDFS →](02-hdfs.md)

## Opción múltiple

**1.** ¿Cuál es la mejor definición de Big Data?

- a) Cualquier conjunto de datos de más de 1 TB.
- b) Datos que, por su volumen, su velocidad o su variedad, no se pueden
  guardar o procesar en tiempo útil en una sola máquina.
- c) Los datos que se guardan en Hadoop.
- d) Datos no estructurados, como imágenes y audio.

<details><summary>Respuesta</summary>

**b)** Lo que define el problema es que una máquina no alcanza para lo que
hay que hacer en el tiempo que hace falta.

- a) No hay un número mágico: mil millones de filas son poco para un informe
  mensual y mucho para responder en un segundo.
- c) Confunde el problema con una herramienta: hay Big Data sin Hadoop
  (Spark sobre S3, BigQuery) y se puede usar Hadoop con datos chicos (como en
  esta imagen).
- d) La variedad es una de las V, pero un conjunto enorme de datos
  estructurados (transacciones de un banco) también es Big Data.

</details>

**2.** Un sistema de detección de fraude tiene que decidir si aprueba un pago
mientras el cliente espera en la caja. ¿Qué V describe mejor su dificultad
principal?

- a) Volumen
- b) Velocidad
- c) Variedad
- d) Valor

<details><summary>Respuesta</summary>

**b)** El desafío es responder en milisegundos a eventos que llegan sin parar.

- a) Puede haber mucho volumen histórico, pero lo que define el problema es el
  tiempo de respuesta.
- c) Los pagos son datos estructurados y de forma conocida.
- d) El valor es claro (evitar fraudes); no es la dificultad técnica.

</details>

**3.** ¿Por qué Hadoop escala **horizontalmente** en vez de verticalmente?

- a) Porque las máquinas grandes no pueden correr Java.
- b) Porque una máquina tiene un techo y su precio crece más rápido que su
  capacidad, mientras que agregar máquinas comunes no tiene ese techo.
- c) Porque así no hace falta red.
- d) Porque las máquinas comunes no se rompen.

<details><summary>Respuesta</summary>

**b)** Escalar hacia los costados permite crecer de a una máquina barata, sin
techo práctico.

- a) Falso: Java corre en cualquier servidor.
- c) Al revés: repartir entre máquinas exige red, y mover datos por ella es lo
  que más cuesta.
- d) Al revés: con miles de máquinas comunes las fallas son de todos los días,
  y por eso Hadoop replica datos y reintenta tareas.

</details>

**4.** "Llevar el cómputo a los datos" (*data locality*) significa:

- a) Copiar todos los datos a un servidor potente antes de procesarlos.
- b) Mandar el programa a las máquinas que ya tienen los bloques, para que
  cada una procese los suyos y solo viajen los resultados.
- c) Guardar los datos en la memoria del NameNode.
- d) Procesar los datos en la compu del usuario.

<details><summary>Respuesta</summary>

**b)** El programa pesa KB y los datos, TB: conviene que viaje el programa.
Por eso HDFS y YARN están en las mismas máquinas.

- a) Es el modelo tradicional, donde la red se vuelve el cuello de botella.
- c) El NameNode guarda metadatos, no los datos.
- d) Es el modelo tradicional llevado al extremo.

</details>

**5.** En la arquitectura maestro-trabajador de HDFS, ¿cuál es el maestro?

- a) El DataNode 1
- b) El ResourceManager
- c) El NameNode
- d) El Secondary NameNode

<details><summary>Respuesta</summary>

**c)** El NameNode lleva los metadatos (qué bloques tiene cada archivo y
dónde están); los DataNodes guardan los bloques.

- a) Todos los DataNodes son trabajadores e intercambiables, también el 1.
- b) Es el maestro de **YARN**, no de HDFS.
- d) Solo hace checkpoints de los metadatos; no atiende a los clientes ni
  reemplaza al NameNode si se cae.

</details>

**6.** ¿Cuál de estos procesos de la imagen es un **trabajador**?

- a) NodeManager
- b) ResourceManager
- c) HiveServer2
- d) Metastore de Hive

<details><summary>Respuesta</summary>

**a)** El NodeManager corre los contenedores que le asigna el
ResourceManager.

- b) Es el maestro de YARN.
- c) y d) Son la parte "maestra" de Hive: reciben el SQL y guardan el
  esquema; el trabajo lo hacen las tareas de Tez en contenedores de YARN.

</details>

**7.** Todo lo que se hace en las guías de la versión `base` es procesamiento:

- a) En streaming, porque los datos se procesan a medida que llegan.
- b) Batch: se procesa un conjunto de datos ya guardado, completo.
- c) Transaccional (OLTP).
- d) Lambda, porque combina MapReduce y Spark.

<details><summary>Respuesta</summary>

**b)** Se sube un archivo (o una tabla) y se lo procesa entero.

- a) Ninguna guía procesa eventos que llegan sin fin.
- c) OLTP son las operaciones chicas de un sistema de gestión (la base MySQL
  `tienda` lo representa), no el procesamiento del cluster.
- d) Lambda combina una capa **batch** con una de **velocidad**
  (streaming); MapReduce y Spark son los dos batch acá.

</details>

**8.** ¿Qué diferencia a un **data lake** de un **data warehouse**?

- a) El lake guarda datos crudos y les da forma al leerlos (*schema on
  read*); el warehouse guarda datos limpios con esquema fijo validado al
  cargar (*schema on write*).
- b) El lake es más chico.
- c) El warehouse no admite SQL.
- d) El lake solo guarda imágenes.

<details><summary>Respuesta</summary>

**a)** Es la diferencia de fondo. HDFS + tablas externas de Hive es un data
lake: los CSV quedan como están.

- b) El tamaño no define nada: suelen ser al revés.
- c) El warehouse es justamente el lugar del SQL de negocio.
- d) Guarda cualquier formato, también tablas y CSV.

</details>

**9.** ¿Cuál de estas es una **limitación** del enfoque Hadoop?

- a) No tolera la caída de un disco.
- b) Solo procesa datos estructurados.
- c) La latencia alta: está pensado para procesar mucho, no para responder
  rápido una consulta chica.
- d) Exige hardware especial.

<details><summary>Respuesta</summary>

**c)** Hasta la consulta más simple que agrupa lanza un trabajo en YARN, que
tarda segundos.

- a) Es al revés: replica los bloques para tolerarlo.
- b) Guarda cualquier formato y decide el esquema al leer.
- d) Está pensado para máquinas comunes.

</details>

**10.** Los dos papers de Google que dieron origen a Hadoop describen:

- a) BigQuery y Spanner
- b) El Google File System y MapReduce
- c) Bigtable y Dynamo
- d) Kubernetes y TensorFlow

<details><summary>Respuesta</summary>

**b)** GFS (2003) dio origen a HDFS, y MapReduce (2004) al motor del mismo
nombre.

- a) Son servicios posteriores de Google.
- c) Bigtable inspiró a HBase y Dynamo es de Amazon: los dos influyeron en las
  bases NoSQL, no en Hadoop.
- d) No tienen relación con el origen de Hadoop.

</details>

## Desarrollo

**1.** Explicá por qué en Hadoop "las fallas son normales" y qué dos
mecanismos de diseño se desprenden de esa idea.

<details><summary>Respuesta modelo</summary>

Hadoop escala con muchas máquinas comunes. Con miles de discos y servidores,
la probabilidad de que alguno falle en un día dado es alta, así que el sistema
no puede tratar la falla como una excepción. De ahí salen dos mecanismos:

1. **HDFS replica** cada bloque en varios DataNodes (`REPLICATION`). Si uno se
   cae, el bloque se lee de otro, y el NameNode vuelve a copiar los bloques
   que quedaron con menos copias.
2. **YARN y los motores reintentan** las tareas que fallan, en otro nodo, sin
   reiniciar el trabajo entero.

La tolerancia a fallas está en el software, no en hardware caro.

</details>

**2.** Compará escalar verticalmente y horizontalmente: ventajas y
desventajas de cada uno.

<details><summary>Respuesta modelo</summary>

- **Vertical** (una máquina más grande): el programa no cambia y no hay que
  coordinar nada. Pero tiene techo (la máquina más grande que existe), el
  precio crece más rápido que la capacidad y la máquina es un punto único de
  falla.
- **Horizontal** (más máquinas): crece de a una máquina común, sin techo
  práctico, y una falla afecta solo a una parte. Pero exige software
  distribuido: repartir datos y trabajo, coordinar, tolerar fallas parciales y
  mover datos por la red, que es lento.

Big Data elige la horizontal y paga su costo con diseño: bloques, réplicas,
maestro-trabajador y llevar el cómputo a los datos.

</details>

**3.** Ubicá en las capas del ecosistema (datos, recursos, motores, acceso)
estas piezas de la imagen: HDFS, YARN, Tez, Hive, Spark, Pig, MapReduce.
¿Dónde quedan Sqoop, ZooKeeper, MySQL y MongoDB?

<details><summary>Respuesta modelo</summary>

- **Datos**: HDFS.
- **Recursos**: YARN.
- **Motores**: MapReduce, Tez y Spark.
- **Acceso**: Pig (flujo de datos), Hive (SQL) y Spark, que es motor y a la
  vez tiene su API de DataFrames y SQL.

Sqoop y ZooKeeper están al costado: Sqoop integra con las bases relacionales
y ZooKeeper coordina (alta disponibilidad). MySQL y MongoDB están afuera del
cluster: MySQL representa la base de los sistemas de la empresa, y MongoDB es
una base NoSQL independiente de Hadoop.

</details>

**4.** ¿Qué es la arquitectura Lambda y qué problema intenta resolver la
arquitectura Kappa?

<details><summary>Respuesta modelo</summary>

**Lambda** combina una capa **batch** (procesa todo el historial, exacta pero
lenta) con una capa de **velocidad** (procesa lo que va llegando, inmediata
pero aproximada) y une los resultados al consultar. El problema es que la
misma lógica se programa y se mantiene dos veces, con dos herramientas.

**Kappa** trata todo como un flujo: hay un solo camino de procesamiento, y para
recalcular el historial se lo vuelve a pasar por el mismo flujo. Se programa
una sola vez, a cambio de depender de que el historial se pueda reproducir
(por ejemplo, guardado en Kafka).

</details>

## Ejercicios sobre la imagen

### Ejercicio 1. Maestros y trabajadores

Con el cluster de la guía 2 prendido, adentro del contenedor, listá los
procesos Java y armá una tabla con tres columnas: proceso, sistema (HDFS,
YARN, Hive, Spark) y rol (maestro o trabajador). ¿Cuántos DataNodes hay y por
qué?

<details><summary>Solución</summary>

<!-- prueba: adentro | espera: NameNode | espera: DataNode | espera: ResourceManager -->
```bash
jps
estado
```

| Proceso | Sistema | Rol |
|---|---|---|
| NameNode | HDFS | maestro |
| DataNode (3) | HDFS | trabajadores |
| SecondaryNameNode | HDFS | auxiliar del maestro (checkpoints) |
| ResourceManager | YARN | maestro |
| NodeManager | YARN | trabajador |
| JobHistoryServer | MapReduce | servicio de historial |
| HiveServer2 y metastore | Hive | parte maestra de Hive |
| HistoryServer de Spark | Spark | servicio de historial |

Hay 3 DataNodes porque el `docker run` de la guía 2 tiene `-e DATANODES=3`:
`jps` los muestra como `DataNode (dn1)`, `DataNode (dn2)` y `DataNode (dn3)`.
`jps` muestra la clase principal de cada proceso, así que algunos no se
reconocen por el nombre (los servicios de Hive se lanzan con `hadoop jar` y
aparecen como `RunJar`): para esos sirve `estado`, que los lista por nombre y
puerto. Ver la [referencia](../referencia.md#jps).

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| Corre `jps` o `estado` y lista los procesos | 2 |
| Identifica bien los maestros (NameNode, ResourceManager) | 3 |
| Identifica bien los trabajadores (DataNodes, NodeManager) | 3 |
| Explica la cantidad de DataNodes por el parámetro `DATANODES` | 2 |

### Ejercicio 2. Bloques y réplicas, en papel

Una empresa guarda 1 TB de logs por día en HDFS, con bloques de 128 MB y
replicación 3.

1. ¿En cuántos bloques queda un día de logs?
2. ¿Cuánto disco ocupa, sumando las réplicas?
3. Si cada bloque se procesa con un mapper, ¿cuántos mappers tiene un trabajo
   que lee un día entero?
4. Hacé las mismas cuentas para `ventas_grandes.csv` (6.213.191 bytes) en el
   cluster de la guía 2 (`BLOCK_SIZE=1m`, `REPLICATION=2`).

<details><summary>Solución</summary>

1. 1 TB = 1.048.576 MB; 1.048.576 / 128 = **8192 bloques**.
2. 1 TB × 3 = **3 TB** de disco. La replicación multiplica el espacio, no la
   cantidad de bloques lógicos.
3. **8192 mappers** (uno por bloque), que YARN corre de a tantos como entren
   en el cluster a la vez.
4. 6.213.191 / 1.048.576 = 5,9, así que **6 bloques** (5 llenos y uno de
   970.311 bytes); con replicación 2 son 12 copias de bloque y unos 12 MB de
   disco. Es lo que muestra `hdfs fsck` en la
   [guía 3](../../03-hdfs.md#bloques-y-réplicas), y el trabajo de Streaming de
   la [guía 4](../../04-yarn-mapreduce.md#ventas-por-producto-con-hadoop-streaming)
   tiene 6 mappers (`number of splits:6`).

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| Cantidad de bloques del caso de 1 TB | 2 |
| Espacio con réplicas (distingue bloques lógicos de copias) | 3 |
| Mappers = bloques | 2 |
| Cuentas correctas para `ventas_grandes.csv`, con el último bloque parcial | 3 |

### Ejercicio 3. Las páginas web de la arquitectura

Para cada página web de la imagen, decí qué proceso la sirve y si es un
maestro o un trabajador: http://localhost:9870, http://localhost:9901,
http://localhost:8088, http://localhost:8042. En la de 9870, ¿cuántos
DataNodes figuran como vivos (*Live*)?

<details><summary>Solución</summary>

| Página | Proceso | Rol |
|---|---|---|
| 9870 | NameNode | maestro de HDFS |
| 9901 | DataNode 1 | trabajador de HDFS |
| 8088 | ResourceManager | maestro de YARN |
| 8042 | NodeManager | trabajador de YARN |

En *Datanodes* figuran 3 vivos (`DATANODES=3`). La tabla completa de puertos
está en la [referencia](../referencia.md#puertos-y-páginas-web).

</details>

**Rúbrica (6 puntos)**: 1 punto por cada página bien asignada (4) y 2 por la
cantidad de DataNodes vivos.
