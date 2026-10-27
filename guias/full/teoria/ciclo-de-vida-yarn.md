# El ciclo de vida de una aplicación en YARN

Qué pasa entre que tocás **Lanzar** (o escribís `hadoop jar …`) y que el
trabajo dice *terminó*: quién pide memoria, por qué a veces espera en la
cola, qué es un contenedor y dónde quedan los logs. Es la teoría detrás de
[Trabajos en YARN](../04-trabajos-yarn.md) y de la
[guía 4 de la materia](../../04-yarn-mapreduce.md).

[← Teoría](README.md) · [Índice de full](../README.md)

## Los actores

| Actor | Dónde corre | Qué hace |
|---|---|---|
| Cliente | Donde escribís el comando (o el servidor de la interfaz) | Arma el pedido y lo manda al ResourceManager |
| **ResourceManager** (RM, `:8088`) | Un proceso por cluster | Lleva la cuenta de la memoria y los vcores de todos los nodos y decide a quién darle qué, con su **scheduler** |
| **NodeManager** (NM, `:8042`) | Uno por máquina | Lanza y vigila los contenedores en su máquina y le cuenta al RM cuánto tiene libre |
| **ApplicationMaster** (AM) | En un contenedor, uno por aplicación | El "jefe" de esa aplicación: pide contenedores para sus tareas y las sigue |
| Contenedor | En un NodeManager | Un pedazo de memoria y CPU con un proceso adentro (una tarea map, un executor de Spark...) |

La clave es que el RM **no** sabe nada de MapReduce, Tez ni Spark: solo
reparte recursos. Lo específico de cada motor lo hace su ApplicationMaster.
Por eso el mismo YARN corre los tres.

## Los estados

| Estado en YARN | Cómo lo dice la interfaz | Qué está pasando |
|---|---|---|
| NEW, NEW_SAVING, SUBMITTED | (pasa rápido) | El RM recibió el pedido y lo anota |
| ACCEPTED | *en cola* | El scheduler lo aceptó, pero todavía no hay memoria para el contenedor del AM ("Esperando memoria para el ApplicationMaster") |
| RUNNING | *corriendo* | El AM arrancó y está pidiendo contenedores y corriendo tareas |
| FINISHED | *terminó* | El AM avisó que terminó; el resultado final (*finalStatus*) dice si fue SUCCEEDED |
| FAILED | *falló* | El AM falló (o falló tantas veces que YARN dejó de reintentar) |
| KILLED | *cancelado* | Alguien lo canceló (`yarn application -kill`, o **Cancelar** en la interfaz) |

Un trabajo que queda en ACCEPTED no está colgado: está esperando que se
libere memoria. Es lo que la pantalla muestra en el número **En cola**.

## La cuenta de memoria del sandbox

La configuración de la imagen (`conf/yarn-site.xml` y `conf/mapred-site.xml`):

| Parámetro | Valor | Qué es |
|---|---|---|
| `yarn.nodemanager.resource.memory-mb` | 4096 | Lo que el NodeManager ofrece para contenedores |
| `yarn.scheduler.minimum-allocation-mb` | 512 | El contenedor más chico que se reparte |
| `yarn.scheduler.maximum-allocation-mb` | 4096 | El más grande |
| `yarn.app.mapreduce.am.resource.mb` | 512 | El contenedor del AM de MapReduce |
| `mapreduce.map.memory.mb`, `mapreduce.reduce.memory.mb` | 512 | Cada tarea map y reduce |
| `tez.am.resource.memory.mb`, `tez.task.resource.memory.mb` (`conf/tez-site.xml`) | 1024 | El AM y cada tarea de Tez |
| `spark.yarn.am.memory`, `spark.executor.memory`, `spark.executor.instances` (`conf/spark-defaults.conf`) | 512m, 512m, 2 | El AM de Spark y sus 2 executors (YARN les suma un margen y redondea el contenedor) |

Entonces entran **8 contenedores de 512 MB** a la vez. Un wordcount ocupa uno
para el AM y uno por tarea. Los vcores no se fijan en la imagen y quedan en
el valor de fábrica de Hadoop: 8. Lo que reporta el ResourceManager en las
pruebas de la imagen (`:8088/ws/v1/cluster/metrics`) es `totalMB` 4096 y
`totalVirtualCores` 8.

Hay un segundo tope, menos visible: el scheduler deja usar para
ApplicationMasters solo el **10 %** de la cola (`maxAMLimitPercentage` 10 en
`:8088/ws/v1/cluster/scheduler`). El 10 % de 4096 MB redondeado al contenedor
mínimo da `AMResourceLimit` de **512 MB**: entra **un AM por vez**. Si lanzás
varios trabajos juntos, el primero corre y los otros esperan en ACCEPTED
aunque haya memoria libre para sus tareas. Es un límite pensado para clusters
grandes (que los AM no se coman la memoria de las tareas) que en una sola
máquina se nota.

<!-- prueba: adentro | espera: totalMB -->
```bash
curl -s http://localhost:8088/ws/v1/cluster/metrics
curl -s http://localhost:8088/ws/v1/cluster/scheduler | grep -o '"AMResourceLimit":{"memory":[0-9]*'
```

## Paso a paso

1. **Envío.** El cliente sube a HDFS lo que necesita el trabajo (el jar, la
   configuración) y le pide al RM una aplicación nueva: recibe un id
   `application_<arranque del RM>_<número>`.
2. **El contenedor del AM.** El scheduler busca un NodeManager con 512 MB
   libres. Si no hay, el trabajo queda en ACCEPTED.
3. **El AM arranca** (RUNNING) y calcula cuántas tareas hacen falta: en
   MapReduce, un map por bloque de entrada (*split*), y los reduce que se
   pidan.
4. **Pide contenedores** al RM para sus tareas, preferentemente en los nodos
   que tienen los bloques (*localidad de datos*: mover el cálculo y no los
   datos).
5. **Las tareas corren** en sus contenedores; el AM las sigue y reintenta
   las que fallan.
6. **Termina.** El AM le avisa al RM, libera sus contenedores, y los logs de
   cada contenedor se juntan en HDFS (*log aggregation*, activada en la
   imagen). Para MapReduce, el JobHistory Server (`:19888`) guarda los
   contadores y las tareas para consultarlos después.

## Los logs: un archivo por contenedor

Cada contenedor tiene su `stdout`, su `stderr` y su `syslog`. Con la
agregación activada, al terminar se juntan y se leen con `yarn logs`. Esta es
una salida real de las pruebas de la imagen, de un MapReduce de ventas: el
contenedor `_000001` es el del ApplicationMaster y los otros tres, las
tareas.

```text
Application State: Completed.
Container: container_1792695340081_0001_01_000001 on localhost_39943
Container: container_1792695340081_0001_01_000002 on localhost_39943
Container: container_1792695340081_0001_01_000003 on localhost_39943
Container: container_1792695340081_0001_01_000004 on localhost_39943
WARNING: YARN_CONF_DIR has been replaced by HADOOP_CONF_DIR. Using value of YARN_CONF_DIR.
2026-10-22 18:57:56,216 INFO client.DefaultNoHARMFailoverProxyProvider: Connecting to ResourceManager at localhost/127.0.0.1:8032
```

Cuando un trabajo falla, el diagnóstico del RM suele decir solo "falló el
AM"; el porqué está en el `syslog` o el `stderr` del contenedor que falló.
Por eso la pantalla de Trabajos tiene una pestaña de logs por contenedor.

<!-- prueba: no (necesita el id de un trabajo terminado) -->
```bash
yarn logs -applicationId application_XXXXXXXXXXXXX_0001 -show_application_log_info
yarn logs -applicationId application_XXXXXXXXXXXXX_0001 -containerId container_XXXXXXXXXXXXX_0001_01_000002
```

## Tres motores, un mismo YARN

| Motor | Su AM | Sus contenedores | Lo que se ve en el DAG |
|---|---|---|---|
| MapReduce | `MRAppMaster` | Una tarea map o reduce cada uno; entre fase y fase escribe a disco | Dos fases: map y reduce |
| Tez (Hive) | El AM de Tez, que Hive deja abierto como **sesión** entre consultas | Tareas de cada vértice; se pasan los datos sin escribir en HDFS entre pasos | Un vértice por paso (`Map 1`, `Reducer 2`...) |
| Spark | El AM de Spark (con `deployMode client`, el driver corre afuera, en el proceso que lanzó el trabajo) | Los **executors**, que viven todo el trabajo y guardan datos en memoria | Etapas (*stages*) |

Abrir una sesión nueva (de Tez o de Spark) cuesta 10-20 s: pedir el
contenedor del AM y arrancar una JVM. Por eso las consultas cortas de Hive
que no lanzan trabajo (una *fetch task*) son mucho más rápidas, y por eso
Spark MLlib tarda decenas de segundos aunque el modelo sea chico (ver
[interpretabilidad](interpretabilidad.md) y la [guía 7](../07-machine-learning.md)).

![La pantalla de Trabajos en YARN](../../../docs/capturas/yarn.png)

## Las colas

El scheduler de la imagen es el **CapacityScheduler** con una sola cola,
`default`. En un cluster compartido hay varias colas (por equipo, por
prioridad), cada una con un porcentaje garantizado de la memoria; si una
cola no usa lo suyo, otra lo puede tomar prestado. Es la forma de que un
trabajo enorme de un equipo no deje sin recursos a todos los demás.

## En la industria

YARN sigue siendo el gestor de recursos de los clusters Hadoop en las
empresas y en **EMR**, **Dataproc** y **HDInsight**. Las ideas (un gestor
central que reparte, un jefe por aplicación que pide, contenedores con un
tope de memoria) son las mismas de **Kubernetes**, donde hoy corren muchos
trabajos de Spark: el *driver* pide *pods* como acá el AM pide contenedores.

## Para pensar

- Si lanzás 5 wordcount a la vez en el sandbox, ¿cuántos pueden estar en
  RUNNING? ¿Qué los limita: la memoria del NodeManager o el tope de los AM?
- ¿Por qué un trabajo de Spark sigue ocupando contenedores aunque no esté
  calculando nada en ese momento?
- ¿Qué se pierde si se desactiva la agregación de logs?

Hay preguntas sobre esto en la [evaluación de YARN](../evaluacion/yarn.md).
