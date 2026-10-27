# 4. YARN y los trabajos

Lanzar un trabajo de MapReduce, Hive sobre Tez o Spark, seguir cómo pide
memoria, cuántos contenedores usa, cómo avanza y qué dice cada log. Es la
[guía 4 de la materia](../04-yarn-mapreduce.md) (y parte de la
[8](../08-spark.md)) mirada desde el ResourceManager.

[← 3. HDFS desde la interfaz](03-hdfs.md) · [Índice de full](README.md) · Siguiente: [5. Consultas →](05-consultas.md)

La pantalla es **Trabajos en YARN** (`G Y`). Necesita `SERVICIOS=mapreduce` o
`todo`; con `SERVICIOS=hdfs` dice "El cluster está prendido solo con HDFS.
Cambialo a MapReduce o a todo desde Configuración para tener YARN." Los
comandos equivalentes van **adentro** del contenedor, parado en `/datos`.

![Trabajos: un wordcount terminado y las plantillas de MapReduce, Tez y Spark](../../docs/capturas/yarn.png)

## Paso 1. La pantalla vacía

**Qué se ve.** El título *Trabajos* con una etiqueta (**listo**, **N
corriendo**, **N en cola** o **ResourceManager no responde**) y el subtítulo
"N NodeManager · 4 GB y N vcores para contenedores". Una línea de ayuda: "Cada
trabajo pide contenedores a YARN: uno para su ApplicationMaster y uno por
tarea. Si no hay memoria libre en los NodeManagers, espera en la cola."

Cuatro números: **Memoria en uso** (%), **Corriendo**, **En cola** ("esperando
memoria") y **Terminados** (con los fallidos o cancelados). Sin trabajos:
"Todavía no corrió ningún trabajo", con **Contar palabras de texto.txt** y
**Elegir otro trabajo** ("El texto de ejemplo se sube solo a HDFS si falta.").

**Qué significa.** El NodeManager ofrece 4096 MB
(`yarn.nodemanager.resource.memory-mb`); los vcores quedan en el valor por
defecto de Hadoop. Todo sale de la API REST del ResourceManager.

**En la terminal.**

<!-- prueba: adentro | espera: RUNNING -->
```bash
yarn node -list
```

<!-- prueba: adentro | espera: totalMB -->
```bash
curl -s http://localhost:8088/ws/v1/cluster/metrics
```

## Paso 2. Elegir un trabajo

**Qué hacer.** **Nuevo trabajo**.

**Qué se ve.** La hoja "Nuevo trabajo" con **Qué querés correr**: una tarjeta
por plantilla con su motor y cuántos parámetros tiene. Las que no se pueden
lanzar ahora dicen por qué (por ejemplo, las de Tez y Spark con
`SERVICIOS=mapreduce`).

| Plantilla | Motor | Parámetros |
|---|---|---|
| Contar palabras (wordcount) | MapReduce | entrada, salida, pisar la salida |
| Estimar π (pi) | MapReduce | maps (1-16), muestras (10-100000) |
| Buscar un patrón (grep) | MapReduce | entrada, salida, patrón, pisar la salida |
| Ventas por producto (MapReduce) | MapReduce (streaming) | — |
| Ventas por producto (Hive sobre Tez) | Tez | — |
| Estimar π (SparkPi) | Spark | particiones (1-16) |
| Ventas por producto (Spark) | Spark | — |

Abajo, **Parámetros** y **Lo mismo en la terminal**, que se actualiza
mientras escribís.

**Qué significa.** Los parámetros se validan con las mismas reglas que el
servidor: la salida tiene que ser una carpeta nueva dentro de `/user` o
`/tmp`, no puede ser la entrada ni estar adentro de ella, y no puede pisar
carpetas del sistema (`/user/root`, `/apps`, `/spark-logs`...). Con un error,
el pie dice "Hay un parámetro para corregir" y **Lanzar** queda deshabilitado.
Con todo bien, dice "Corre en YARN; lo seguís en vivo en el detalle".

## Paso 3. Lanzar un wordcount

**Qué hacer.** Elegí **Contar palabras (wordcount)**, dejá los valores
(`/user/root/texto.txt` → `/user/root/resultados/wordcount`, con *pisar*
tildado) y **Lanzar**.

**Qué se ve.** Un aviso "Contar palabras (wordcount): enviado a YARN" y se
abre el detalle del trabajo (`#yarn/application_…`).

**En la terminal.** Lo que mostraba *Lo mismo en la terminal*:

<!-- prueba: no (lanza un trabajo en YARN; la guía 4 de la materia lo corre) -->
```bash
hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar \
  wordcount /user/root/texto.txt /user/root/resultados/wordcount
```

**Qué significa.** *Pisar la salida si ya existe* está porque MapReduce no
escribe sobre una carpeta que ya existe (el trabajo falla al enviarse): si
está tildado, la carpeta se borra antes.

## Paso 4. El detalle: avance y resumen

**Qué se ve.**

- Una barra de avance que cuenta lo que pasa: "Esperando memoria para el
  ApplicationMaster", "Corriendo map: n de m tareas" (con el nombre de la fase o etapa que corre), "Terminó bien en …",
  "Lo cancelaron" o "Falló: mirá el diagnóstico y el syslog del contenedor".
- El estado: *en cola* (ACCEPTED), *corriendo* (RUNNING), *terminó*
  (FINISHED), *falló* (FAILED) o *cancelado* (KILLED). Si YARN dejó un
  diagnóstico, aparece en un cartel.
- El panel **Resumen**: Cola (cola · usuario), Enviado (· arrancó, o
  "esperando memoria"), Terminó, Memoria (contenedores vivos · AM), Resultado, Entra, Sale, Seguimiento (el enlace a la
  página del trabajo en YARN o en JobHistory) y el **Comando**. Si el trabajo
  dejó una salida en HDFS, el botón **Ver resultado** te lleva a la carpeta.

**En la terminal.**

<!-- prueba: no (necesita el id de un trabajo) -->
```bash
yarn application -list -appStates ALL
yarn application -status application_XXXXXXXXXXXXX_0001
hdfs dfs -cat /user/root/resultados/wordcount/part-r-00000 | head
```

## Paso 5. El DAG

**Qué se ve.** El panel **DAG**: los vértices (Tez), etapas (Spark) o fases
(MapReduce: map y reduce) con sus tareas y su estado (*en cola*, *corriendo*,
*terminada*, *falló*). Pasando el mouse por una tarea de lectura, de qué
DataNode leyó.

**Qué significa.** Un DAG es el plan del trabajo: qué pasos hay y qué espera a
qué. MapReduce tiene siempre dos fases; Tez y Spark arman grafos más largos
y evitan escribir en HDFS entre paso y paso. En Spark la interfaz avisa
"Etapas en el orden en que arrancaron: Spark History no informa de qué etapa
depende cada una."

**De dónde sale.** MapReduce: el ApplicationMaster mientras corre y JobHistory
(`:19888`) después. Spark: el driver (`:4040`) o Spark History (`:18080`).
Tez: lo que imprime `beeline`, que dibuja una tabla por vértice.

## Paso 6. Los logs de cada contenedor

**Qué se ve.** El panel **Logs** ("se actualizan solos mientras corre"). A la
izquierda, los contenedores: **AM** (el ApplicationMaster), **T** (tareas de
MapReduce o Tez), **EX** (executors de Spark) y **$** (el cliente, con los
contadores del final). Arriba, el archivo (*stdout*, *stderr*, *syslog*), el
nivel (*Todo*, *WARN+*, *ERROR*), el buscador, **Pausar** / **Seguir** y **Ir
al final**.

**Qué significa.** Cada contenedor escribe sus propios logs en el NodeManager.
Mientras el trabajo corre se leen de ahí; cuando termina, YARN los **agrega**
(los junta en HDFS) y se leen con `yarn logs`.

**En la terminal.**

<!-- prueba: no (necesita el id de un trabajo terminado) -->
```bash
yarn logs -applicationId application_XXXXXXXXXXXXX_0001 | less
```

Así empieza el log agregado de un ApplicationMaster en las pruebas de la
imagen:

```text
Container: container_1792695340081_0001_01_000001 on localhost_39943
LogAggregationType: AGGREGATED
====================================================================
LogType:stderr
LogLastModifiedTime:Thu Oct 22 18:56:49 +0000 2026
LogLength:1724
LogContents:
```

El contenedor `_000001` es siempre el ApplicationMaster.

## Paso 7. Contadores

**Qué se ve.** Abajo, plegable: **Contadores** ("N · lo que midió Hadoop" o
"Spark"), con Contador, Grupo y Valor (registros leídos y escritos, bytes de HDFS,
registros del shuffle...).

**Qué significa.** Son los números que imprime `hadoop jar` al terminar. Sirven
para ver si el trabajo leyó lo que esperabas y cuánto movió entre map y
reduce.

## Paso 8. Memoria y contenedores

**Qué hacer.** Volvé a **← Trabajos** y abrí el plegable **Memoria y
contenedores**. Lanzá dos o tres trabajos seguidos (por ejemplo, Pi con 8
maps).

**Qué se ve.** Una tira por NodeManager con cada contenedor dibujado según su
memoria, del color de su motor, y lo libre al final ("… libres"); pasando
el mouse, si es ApplicationMaster, tarea o executor, de qué trabajo y cuánta
memoria pide. Al lado, las **Colas** con Usado, Corren y Esperan. Cuando no
entra más, los trabajos nuevos quedan *en cola* ("esperando memoria").

**Qué significa.** Con 4096 MB y contenedores de 512 MB (MapReduce) o
1024 MB (Tez), entran pocos a la vez. Un trabajo con 8 maps no corre las 8 a
la vez: YARN le da contenedores a medida que se liberan. Ver
[teoría: ciclo de vida en YARN](teoria/ciclo-de-vida-yarn.md).

## Paso 9. Filtrar y cancelar

**Qué se ve.** Los filtros *todos*, *activos*, *terminados*, *fallidos*, el
buscador "Buscar por nombre o id" y la tabla con Trabajo, Motor, Estado,
Avance, Contenedores, Enviado y Duración. En los que corren, un botón para
cancelar, que confirma: "YARN mata sus contenedores y libera la memoria. Lo
que ya escribió en HDFS queda a medias."

**En la terminal.**

<!-- prueba: no (cancela un trabajo) -->
```bash
yarn application -kill application_XXXXXXXXXXXXX_0001
```

## Paso 10. El mismo cálculo en tres motores

**Qué hacer.** Lanzá, uno después del otro, **Ventas por producto
(MapReduce)**, **(Hive sobre Tez)** y **(Spark)**, y compará duración,
contenedores y DAG.

**Qué significa.** Los tres resuelven lo mismo sobre `/user/root/ventas`. Las
diferencias que vas a ver (cuánto tarda en arrancar cada uno, cuántos
contenedores pide, cuántos pasos tiene el DAG) son las que se discuten en la
materia entre MapReduce, Tez y Spark.

<!-- prueba: no (lanza tres trabajos; las guías 4, 6 y 8 de la materia los corren) -->
```bash
beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql
spark-submit ejemplos/ventas.py
```

## Dónde se usa esto en la industria

Es lo que muestra la **UI del ResourceManager** (`:8088`) y la de
**JobHistory** (`:19888`), y lo que ofrecen **Cloudera Manager** (pantalla
*YARN Applications*) y **Ambari** (*YARN Queue Manager*). Spark History
(`:18080`) es la herramienta de siempre para ver etapas de Spark. En
producción se suma una pila de métricas (Prometheus + **Grafana**) con la
memoria de las colas a lo largo del día.
