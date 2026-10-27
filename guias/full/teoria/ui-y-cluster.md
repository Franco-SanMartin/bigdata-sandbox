# La interfaz y el cluster: cómo sabe la pantalla lo que pasa adentro

La interfaz de `full` no es parte de Hadoop: es un programa más que corre en
el contenedor y le pregunta a Hadoop lo mismo que le preguntarías vos desde
la terminal. Entender cómo lo hace sirve para dos cosas: confiar en lo que
muestra (o saber cuándo no) y saber dónde mirar en un cluster que no tiene
esta interfaz.

[← Teoría](README.md) · [Índice de full](../README.md)

## Dos programas, un contrato

Hay dos partes:

- **La interfaz** (React, carpeta `ui/`): lo que corre en tu navegador. No
  sabe nada de Hadoop; solo conoce un contrato, la `SandboxApi`, con métodos
  como `status()`, `hdfsList(path)` o `query(source, text)`.
- **El servidor** (Python, `server/sandbox_server`): corre adentro del
  contenedor en el puerto 8080, sirve la interfaz y contesta ese contrato en
  rutas HTTP (`GET /api/status`, `GET /api/hdfs/ls`...). Para contestar, mira
  procesos, lee el JMX y las APIs REST de Hadoop o corre los mismos comandos
  de la terminal.

El contrato está escrito en [`ui/API.md`](../../../ui/API.md). Tiene dos
implementaciones: la real (`HttpApi`, que habla con el servidor) y el **modo
demo**, que simula el cluster en el navegador con datos medidos en la
imagen. Las pantallas no saben cuál están usando: por eso todo lo que anda
en el demo tiene que andar igual contra el servidor.

## Cuatro fuentes de verdad

El servidor junta cada dato de alguna de estas fuentes:

| Fuente | Qué da | Ejemplo |
|---|---|---|
| El sistema operativo | Qué procesos hay y qué puertos escuchan | `/proc/*/cmdline`, `/proc/net/tcp`, el cgroup de memoria |
| JMX | Las métricas internas de cada proceso Java, como JSON por HTTP | `:9870/jmx?qry=Hadoop:service=NameNode,name=FSNamesystemState` |
| APIs REST | Lo que expone cada servicio para que lo consulten otros programas | WebHDFS en `:9870/webhdfs/v1`, el ResourceManager en `:8088/ws/v1/cluster`, JobHistory en `:19888`, Spark History en `:18080` |
| Comandos | Lo que no tiene API o es más fácil así | `hdfs fsck`, `hdfs dfsadmin -report`, `beeline`, `mysql`, `mongosh`, `yarn logs` |

Cuando la interfaz muestra un comando "equivalente", es literalmente lo que
el servidor corrió o lo que daría el mismo dato. Ver la tabla completa en la
[referencia](../referencia.md).

## Proceso vivo no es servicio listo

La lámpara de cada proceso tiene cuatro estados (*apagado*, *arrancando*,
*arriba*, *caído*) porque "está el proceso" y "atiende" son cosas distintas.
Un NameNode recién lanzado tarda unos segundos en abrir su puerto; un
HiveServer2 puede tardar un minuto. Por eso el servidor mira dos cosas: que
el proceso esté en `/proc` y que su puerto aparezca escuchando en
`/proc/net/tcp`. Es la misma distinción que hace Kubernetes entre una
*liveness probe* (el proceso vive) y una *readiness probe* (ya puede recibir
pedidos).

`jps` solo resuelve la primera mitad: lista los procesos de Java, pero no
dice si ya atienden.

## Preguntar seguido o que te avisen

Hay dos formas de enterarse de un cambio:

- **Sondeo (polling)**: preguntar cada tanto. El servidor lee el JMX del
  NameNode y la REST del ResourceManager **cada 2 s**, y la interfaz vuelve a
  pedir el estado cada 2 s.
- **Eventos (push)**: que el otro te avise. El servidor manda eventos por
  **SSE** (*Server-Sent Events*, `GET /api/events`): `status`, `activity`,
  `transfer`, `yarn`, `hdfs`, `step`, `model`, `action`. La interfaz los usa
  para refrescar solo lo que cambió.

Se usan las dos a la vez a propósito: si se pierde un evento, el sondeo lo
corrige a los 2 s. Es un patrón común en sistemas distribuidos: avisar para
ser rápido y sondear para no quedar desactualizado.

## Lo que la interfaz deduce (y Hadoop no sabe)

Algunas cosas que se ven en pantalla no las guarda Hadoop: las arma la
interfaz o el servidor.

- **Lo escribió**, en el detalle de un archivo de HDFS: se deduce por la
  ruta (`/user/hive/warehouse/…` es Hive, `part-r-00000` es MapReduce). HDFS
  no guarda qué programa escribió un archivo.
- **Los carteles Degradado / Con fallas**: los arma la interfaz con el
  estado de cada proceso y los números de HDFS, según qué depende de qué.
- **La memoria estimada** en Configuración: una suma fija por parte, medida
  en la imagen. No es lo que va a usar de verdad (eso lo dice `docker
  stats`).
- **El DAG de Tez**: sale de las tablas que imprime `beeline` mientras corre
  la consulta, porque la imagen no tiene Timeline Server.

Saber qué es dato y qué es deducción evita conclusiones falsas: si un
archivo dice *Lo escribió: MapReduce* pero lo subiste a mano con ese nombre,
la interfaz se equivoca y HDFS no tiene la culpa.

## Cada botón es un comando

Toda acción de la interfaz termina en un comando de Hadoop (o en una
llamada a su API) y queda registrada con un **ActionTrace**: el comando,
qué entra, qué hace y qué sale. Ese registro es lo que muestra la
[Consola](../10-consola.md). La idea es que la interfaz no esconda Hadoop:
que muestre el comando para que la próxima vez lo puedas escribir vos.

![La pantalla Cluster con el sinóptico](../../../docs/capturas/cluster.png)

## En la industria

Las consolas de gestión de clusters (**Apache Ambari**, **Cloudera
Manager**) funcionan igual: un agente en cada máquina que mira procesos y
puertos, y un servidor central que junta el JMX de cada servicio y lo
muestra con alertas. Las plataformas de nube (**EMR**, **Dataproc**,
**HDInsight**) hacen lo mismo detrás de sus consolas web. Y todas exponen
también una API, porque lo que se puede hacer con un botón se tiene que
poder automatizar.

## Para pensar

- Si el servidor de la interfaz se cae, ¿se cae Hadoop? ¿Qué dejás de ver?
- ¿Por qué no alcanza con `jps` para saber si el cluster está listo?
- ¿Qué pasaría si la interfaz solo usara eventos y no sondeara nunca?

Hay preguntas sobre esto en la
[evaluación de operación](../evaluacion/operacion.md).
