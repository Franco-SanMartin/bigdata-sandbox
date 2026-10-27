# Evaluación: YARN y los trabajos

Sobre la [guía 4](../04-trabajos-yarn.md) y la teoría del
[ciclo de vida en YARN](../teoria/ciclo-de-vida-yarn.md).

[← Evaluación](README.md) · [Índice de full](../README.md)

## Opción múltiple

### 1. Un trabajo dice *en cola*. ¿En qué estado está para YARN?

- a) NEW
- b) ACCEPTED
- c) RUNNING
- d) FAILED

<details><summary>Respuesta</summary>

**b) ACCEPTED.** El scheduler lo aceptó pero todavía no hay memoria para el
contenedor de su ApplicationMaster; la barra dice "Esperando memoria para el
ApplicationMaster".

- a) NEW pasa en un instante, mientras el ResourceManager anota el pedido.
- c) RUNNING es *corriendo*: el AM ya arrancó.
- d) FAILED es *falló*.
</details>

### 2. ¿Qué hace el ResourceManager con un trabajo de Spark?

- a) Arma las etapas de Spark y decide qué executor corre cada tarea.
- b) Solo reparte memoria y vcores: lo específico de Spark lo hace su ApplicationMaster.
- c) Lo pasa a MapReduce, porque YARN solo corre MapReduce.
- d) Nada: Spark no usa YARN.

<details><summary>Respuesta</summary>

**b).** El RM no sabe de MapReduce, Tez ni Spark: lleva la cuenta de los
recursos y le da contenedores a quien los pide. Por eso el mismo YARN corre
los tres motores.

- a) Eso lo hace el driver de Spark.
- c) YARN corre cualquier aplicación que traiga su ApplicationMaster.
- d) En la imagen, `spark-defaults.conf` tiene `spark.master yarn`.
</details>

### 3. Con la configuración de la imagen, ¿cuántos contenedores de 512 MB entran a la vez en el NodeManager?

- a) 4
- b) 8
- c) 16
- d) Depende de los vcores

<details><summary>Respuesta</summary>

**b) 8.** `yarn.nodemanager.resource.memory-mb` es 4096 y el contenedor
mínimo 512: 4096 / 512 = 8.

- a) Serían contenedores de 1024 MB, como los de Tez.
- c) Haría falta el doble de memoria.
- d) Los vcores quedan en 8 (valor de fábrica) y no son el límite acá: lo es
  la memoria.
</details>

### 4. Lanzás un wordcount sobre una salida que ya existe, sin tildar *pisar la salida*. ¿Qué pasa?

- a) Escribe encima y se mezclan los resultados.
- b) Agrega un `part-r-00001` al lado del anterior.
- c) No se lanza: el servidor revisa antes que la salida no exista.
- d) YARN lo deja en cola hasta que borres la carpeta.

<details><summary>Respuesta</summary>

**c).** Antes de mandarlo a YARN, el servidor mira si la salida existe y
contesta "Ya existe …: tildá «pisar la salida» o elegí otra carpeta". Y
aunque se lanzara con `hadoop jar`, MapReduce se niega a escribir sobre una
carpeta que existe (el trabajo falla al enviarse), justamente para no
mezclar resultados.

- a), b) MapReduce nunca escribe sobre una salida existente.
- d) La cola de YARN es por memoria, no por archivos.
</details>

### 5. En el panel de logs, ¿qué contenedor es el ApplicationMaster?

- a) El `_000001`.
- b) El último.
- c) El que tiene más líneas.
- d) Ninguno: el AM no tiene logs.

<details><summary>Respuesta</summary>

**a).** El primer contenedor que YARN le da a una aplicación es el de su
ApplicationMaster: `container_…_01_000001`. En la interfaz figura como
**AM**.

- b), c) El orden y el tamaño no lo dicen.
- d) El AM tiene `stdout`, `stderr` y `syslog` como cualquier contenedor.
</details>

### 6. ¿Por qué Hive sobre Tez tarda más en la primera consulta que lanza trabajo que en las siguientes?

- a) Porque la primera vez compila las tablas.
- b) Porque la primera abre la sesión de Tez (pide el AM y arranca una JVM) y Hive la deja abierta.
- c) Porque YARN guarda los resultados en caché.
- d) No tarda más.

<details><summary>Respuesta</summary>

**b).** Abrir una sesión cuesta 10-20 s; Hive deja el AM de Tez abierto entre
consultas, así que las siguientes se ahorran ese arranque.

- a) No hay tal compilación de tablas.
- c) YARN no guarda resultados.
- d) Se nota en la duración del primer trabajo.
</details>

### 7. Cancelás un trabajo que estaba escribiendo su salida. ¿Qué queda en HDFS?

- a) Nada: YARN deshace lo escrito.
- b) Lo que ya escribió, a medias.
- c) La salida completa, porque cancelar espera a que termine la tarea.
- d) Una copia de seguridad en la papelera.

<details><summary>Respuesta</summary>

**b).** El diálogo lo avisa: "YARN mata sus contenedores y libera la memoria.
Lo que ya escribió en HDFS queda a medias." YARN reparte recursos, no maneja
transacciones sobre los archivos.

- a) YARN no deshace escrituras.
- c) `-kill` no espera.
- d) Matar un trabajo no mueve nada a la papelera.
</details>

### 8. ¿De dónde sale el DAG de un trabajo de Hive sobre Tez en la interfaz?

- a) Del Timeline Server de Tez.
- b) De JobHistory (`:19888`).
- c) De lo que imprime `beeline`, que dibuja una tabla por vértice.
- d) De Spark History (`:18080`).

<details><summary>Respuesta</summary>

**c).** La imagen no levanta un Timeline Server; la interfaz arma el DAG con
la tabla de vértices que imprime `beeline` mientras corre.

- a) No está en la imagen.
- b) JobHistory es de MapReduce.
- d) Spark History es de Spark.
</details>

## Desarrollo

### 1. Describí qué pasa entre que tocás **Lanzar** en un wordcount y que la interfaz dice *terminó*. Nombrá los actores.

<details><summary>Respuesta modelo</summary>

El cliente (el servidor de la interfaz, que corre `hadoop jar`) sube el jar
y la configuración y le pide al **ResourceManager** una aplicación nueva:
recibe un id `application_…`. El scheduler busca un **NodeManager** con
memoria para el contenedor del **ApplicationMaster** (512 MB); si no hay,
el trabajo queda en ACCEPTED. Cuando arranca el AM (RUNNING), calcula un map
por bloque de entrada y los reduce, y le pide al RM un **contenedor** por
tarea, de preferencia donde están los bloques. Las tareas corren, el AM las
sigue y reintenta las que fallan. Al final el AM avisa al RM (FINISHED,
SUCCEEDED), se liberan los contenedores, los logs se agregan en HDFS y
JobHistory guarda contadores y tareas.

Rúbrica: los cuatro actores (2 puntos), el orden (2), ACCEPTED por falta de
memoria (1), localidad de datos (1), agregación de logs o JobHistory (1).
</details>

### 2. Lanzás tres trabajos juntos y uno queda *en cola* aunque el indicador de memoria no está al 100 %. ¿Qué puede estar pasando?

<details><summary>Respuesta modelo</summary>

Además de la memoria total, el CapacityScheduler limita cuánta memoria de la
cola pueden ocupar los ApplicationMasters: `maxAMLimitPercentage` 10, que en
el sandbox da un `AMResourceLimit` de 512 MB (se ve en
`:8088/ws/v1/cluster/scheduler`). Con esa configuración, mientras un AM
ocupa ese cupo los otros trabajos esperan en ACCEPTED aunque haya memoria
para sus tareas. También puede ser que la memoria libre esté repartida y no
alcance para el contenedor que pide ese AM (por ejemplo, 1024 MB de Tez).

Rúbrica: menciona el tope de AM (2 puntos), sabe dónde verlo (1), menciona
el tamaño del contenedor pedido (1).
</details>

### 3. ¿Para qué sirve la agregación de logs y qué se pierde sin ella?

<details><summary>Respuesta modelo</summary>

Cada contenedor escribe sus logs en el disco del NodeManager donde corrió.
Con la agregación (activada en la imagen) al terminar se juntan en HDFS y se
leen todos con `yarn logs -applicationId …`, aunque los contenedores ya no
existan. Sin ella, los logs quedan desparramados en cada nodo y se borran
con el tiempo: para entender por qué falló una tarea habría que entrar al
nodo justo.

Rúbrica: dónde escribe cada contenedor (1), qué hace la agregación (2), qué
se pierde (1).
</details>

## Ejercicios sobre la interfaz

### Ejercicio 1. Un trabajo de punta a punta

Lanzá el wordcount con los valores por defecto. Anotá: (a) el id del
trabajo, (b) cuántos contenedores usó y cuál era el AM, (c) dos contadores
que digan cuánto leyó y cuánto escribió, (d) el comando que figura en el
Resumen y (e) qué hay en la carpeta de salida.

<details><summary>Solución</summary>

(a) `application_<arranque del RM>_<número>`, en el título y la dirección
(`#yarn/application_…`). (b) Los de la lista del panel Logs: el **AM**
(`_000001`) y una **T** por tarea; el Resumen da contenedores vivos · AM
mientras corre. (c) En **Contadores**, por ejemplo los registros de entrada
del map y los bytes escritos en HDFS. (d)
`hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar wordcount /user/root/texto.txt /user/root/resultados/wordcount`.
(e) Con **Ver resultado**: `_SUCCESS` y `part-r-00000` con palabra y cantidad.

Rúbrica: cada punto, 1. Los números exactos dependen de la corrida: se
corrige que salgan de la pantalla correcta.
</details>

### Ejercicio 2. Llenar el NodeManager

Abrí **Memoria y contenedores** y lanzá seguidos tres **Estimar π (pi)** con
8 maps. Describí la tira del NodeManager y las Colas mientras corren. ¿Cuántos
están *corriendo* y cuántos *en cola*? ¿Por qué?

<details><summary>Solución</summary>

La tira se llena de contenedores de 512 MB del color de MapReduce, con lo
libre al final. En Colas, **Corren** y **Esperan** cuentan los trabajos. Lo
esperable es que no corran los tres a la vez: el primero ocupa su AM y
tantas tareas como entren en 4096 MB, y los otros esperan *en cola*
("esperando memoria"), por la memoria o por el tope de ApplicationMasters
de la cola. A medida que terminan tareas, YARN les da contenedores a los que
esperan.

Rúbrica: describe la tira (1), lee Corren y Esperan (1), explica la espera
con memoria o tope de AM (2). Como no se verificó en vivo cuántos corren a
la vez, vale cualquier número si la explicación es coherente con lo que se
ve.
</details>

### Ejercicio 3. Tres motores, un cálculo

Lanzá **Ventas por producto** con MapReduce, con Hive sobre Tez y con Spark,
uno después del otro. Armá una tabla con duración, contenedores y pasos del
DAG de cada uno, y explicá las diferencias.

<details><summary>Solución</summary>

Los valores salen de la tabla de trabajos (Duración, Contenedores) y del
panel DAG. Lo que se tiene que ver: MapReduce con dos fases (map y reduce) y
escritura a disco entre ellas; Tez con vértices (`Map 1`, `Reducer 2`) y la
sesión que tarda la primera vez; Spark con etapas y executors que viven todo
el trabajo, y el costo fijo de arrancar la sesión. Con datos tan chicos, el
arranque pesa más que el cálculo en los tres.

Rúbrica: la tabla completa (3), la forma del DAG de cada motor (2), la
conclusión sobre el costo de arranque (1).
</details>
