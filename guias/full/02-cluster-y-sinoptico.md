# 2. El panel del cluster y el sinóptico

La pantalla **Cluster** (`G C`) es el tablero de control: qué procesos hay,
cuáles responden, cómo arrancó cada uno y qué está fallando. En el centro
está el **sinóptico**, un dibujo del cluster con una lámpara por proceso, como
el panel de una central eléctrica.

[← 1. Arrancar y primer recorrido](01-arrancar-y-recorrido.md) · [Índice de full](README.md) · Siguiente: [3. HDFS desde la interfaz →](03-hdfs.md)

Los comandos equivalentes van **adentro** del contenedor
(`docker exec -it bigdata-full bash`).

## Paso 1. Con el cluster apagado: la vista previa

**Qué hacer.** Con el cluster apagado, abrí Cluster.

**Qué se ve.** El título dice *Apagado · la próxima vez arranca con: 1
NameNode · 3 DataNodes · réplica 2 · bloque 1 MB · todo* (o lo que tengas
configurado). Tres paneles:

- **Arquitectura** ("lo que va a levantar esta configuración"): el sinóptico,
  todo con lámparas apagadas.
- **Configuración**: DataNodes, Réplicas por bloque, Tamaño de bloque,
  NameNodes ("1 + Secondary" o "2 (alta disponibilidad)"), Servicios, MongoDB
  y JupyterLab, con el botón **Editar**.
- **Memoria** ("estimada para Docker"): cuántos GB va a pedir sobre 7,7 GB, con
  un medidor y una frase: *Entra con margen*, *Entra justo: cerrá programas
  pesados antes de arrancar* o *No entra: bajá DataNodes o servicios, o dale
  más memoria a Docker*.

Si el volumen está vacío aparece *Primer arranque: formatea HDFS y carga las
bases de ejemplo. Tarda unos 2 minutos; después, menos de uno.*

**Qué significa.** Todo esto se calcula **antes** de prender nada: el
sinóptico se dibuja con la configuración y la memoria se estima sumando lo que
pide cada parte (ver [9. Configuración](09-configuracion-y-compose.md)).

## Paso 2. El arranque paso a paso

**Qué hacer.** Tocá **Iniciar cluster** y quedate en Cluster.

**Qué se ve.** El panel **Arranque** ("paso por paso, con el comando y el log
de cada uno"): una barra arriba con *N de M pasos*, el tiempo que va contra el
esperado y *primer arranque: formatea HDFS y carga las bases* o *los datos del
volumen quedan como estaban*. A la izquierda, la lista de pasos; a la derecha,
el paso elegido con su descripción, sus **comandos** y su **log en vivo**.

Los pasos que puede haber, en orden:

| Paso | Comandos que muestra | Cuándo se saltea |
|---|---|---|
| ZooKeeper y JournalNodes | `zkServer.sh start`, `hdfs --daemon start journalnode` | sin alta disponibilidad no aparece |
| Formatear HDFS | `hdfs namenode -format -force -nonInteractive` (en HA, más `-bootstrapStandby` y `hdfs zkfc -formatZK`) | "el volumen ya tiene datos" |
| NameNode y Secondary (o NameNodes) | `hdfs --daemon start namenode`, `secondarynamenode` o `zkfc` | — |
| DataNodes | `datanode start N` y `hdfs dfsadmin -safemode wait` | — |
| Carpetas en HDFS | `hdfs dfs -mkdir -p` de `/tmp`, `/user/hive/warehouse`, `/user/root`, `/apps/tez`, `/apps/spark`, `/spark-logs` | "ya existen" |
| YARN y JobHistory | `yarn --daemon start resourcemanager` y `nodemanager`, `mapred --daemon start historyserver` | con `SERVICIOS=hdfs` no aparece |
| MySQL | `mysqld`, `mysqladmin ping` y, la primera vez, la base `tienda` | con `SERVICIOS=hdfs` no aparece |
| MongoDB | `mongod` y, la primera vez, la carga de `tienda_mongo.js` | sin MongoDB no aparece |
| Librerías de Tez y Spark | `hdfs dfs -put` de `tez.tar.gz` y `spark-libs.jar` | "ya están en HDFS"; sin `SERVICIOS=todo` no aparece |
| Hive | `schematool` (la primera vez), `hive --service metastore`, `hive --service hiveserver2` | sin `SERVICIOS=todo` no aparece |
| Spark History Server | `start-history-server.sh` | sin `SERVICIOS=todo` no aparece |
| JupyterLab | `jupyter lab` | sin JupyterLab no aparece |
| Esta interfaz | `estado` | — |

Cada paso está *en espera*, *corriendo*, *listo*, *salteado* (con el motivo) o *falló*. Al
lado, el sinóptico ("se prende cada proceso cuando responde") va encendiendo
lámparas.

**Qué significa.** El servidor no inventa los pasos: lee lo que imprime
`/opt/entrypoint.sh` (las líneas `[sandbox] ...`) hasta *Cluster LISTO*. Es el
mismo log que verías con `docker logs` en `base`.

**En la terminal.** El log crudo del arranque:

<!-- prueba: no (necesita el contenedor bigdata-full) -->
```bash
docker logs bigdata-full 2>&1 | grep '\[sandbox\]'
```

## Paso 3. Las lámparas

**Qué se ve.** Con el cluster en marcha, el sinóptico agrupa los procesos por
capa:

- **METADATOS** ("qué bloque está dónde"): el NameNode (`nn1 · :9870 · RPC
  :9000`) y el Secondary NameNode (`:9868 · copia cada 5 min`). Con alta
  disponibilidad, los NameNodes con su rol **ACTIVO** o **EN ESPERA**, y una
  fila **COORDINACIÓN** ("elige al activo") con ZooKeeper (`:2181`) y los
  JournalNodes.
- **DATOS** ("los bloques, en HDFS"): un módulo por DataNode, con los bloques
  que guarda dibujados como fichas.
- **CÓMPUTO** ("YARN reparte 4 GB"): ResourceManager, NodeManager y
  JobHistory, con los trabajos que corren marcados por motor.
- **SERVICIOS** ("consultas y bases"): Hive, MySQL, MongoDB, Spark History,
  JupyterLab.

Arriba está la leyenda: **apagado**, **arrancando**, **arriba**, **caído**, y
los colores de motor **MapReduce**, **Tez** y **Spark**.

**Qué significa cada lámpara.**

| Lámpara | Qué quiere decir | Cómo lo sabe el servidor |
|---|---|---|
| arriba | El proceso corre **y** su puerto escucha | está en `/proc/*/cmdline` y su puerto aparece en `/proc/net/tcp` |
| arrancando | El proceso corre pero su puerto todavía no escucha | está el proceso, falta el puerto |
| caído | Debería estar y no está | el cluster está en marcha y el proceso no aparece (o ya había estado arriba en este arranque) |
| apagado | El cluster está apagado, o en el arranque todavía no le tocó | no hay proceso y no le corresponde estar |

Lo que la configuración no incluye (por ejemplo, MongoDB con `MONGODB=no`) se
dibuja apagado con *no incluido*.

Es lo mismo que hace `jps` (mirar qué procesos de Java hay) más mirar si el
puerto escucha, que es lo que distingue un proceso que arrancó de uno que ya
atiende.

**En la terminal.**

<!-- prueba: adentro | espera: NameNode -->
```bash
jps
estado
```

## Paso 4. Los números de arriba

**Qué se ve.** Seis indicadores:

- **Procesos**: cuántos están arriba sobre el total, y *todos responden* o
  *N con problemas*.
- **DataNodes vivos**: vivos sobre el total; abajo, *N sin latidos*, *N muerto*
  o el bloque y la réplica.
- **Bloques**: cuántos hay; abajo, *N perdidos*, *N con copias de menos* o
  cuántas copias y archivos.
- **YARN**: memoria usada sobre la total, *N corriendo · N en cola* (o
  *apagado (SERVICIOS=hdfs)*).
- **Memoria**: lo que usa el contenedor sobre su tope, con su historia; *casi
  sin memoria* pasando el 90 %.
- **En marcha**: desde cuándo.

**De dónde sale.** Los DataNodes y los bloques, del JMX del NameNode
(`FSNamesystemState`: `NumLiveDataNodes`, `UnderReplicatedBlocks`,
`MissingBlocks`...); YARN, de `:8088/ws/v1/cluster/metrics`; la memoria, del
cgroup del contenedor. Se sondea cada 2 s.

**En la terminal.**

<!-- prueba: adentro | espera: Live datanodes -->
```bash
hdfs dfsadmin -report | head -25
```

<!-- prueba: adentro | espera: activeNodes -->
```bash
curl -s http://localhost:8088/ws/v1/cluster/metrics
```

## Paso 5. Elegir un proceso

**Qué hacer.** Hacé clic en el NameNode del sinóptico (o en su fila de la
tabla **Procesos**).

**Qué se ve.** El panel **Detalle**: Estado, Capa, Puertos, Página, PID,
Memoria y *Arriba desde*. Si es un DataNode, además Bloques, Último latido y
Carpeta (`/hadoop/dfs/dn1`...). Botones: **Abrir su página** (la interfaz web
del propio Hadoop, por ejemplo `localhost:9870`), **Actividad** y **Apagar**
o **Prender**. Los que no se pueden manejar solos dicen *Se maneja con el
cluster*.

La dirección cambia a `#cluster/nn1`: se puede compartir.

**Qué significa.** Se pueden apagar y prender sueltos los DataNodes, el
NameNode, MySQL, MongoDB, HiveServer2 y JupyterLab. El resto se maneja con el
cluster entero.

**Ojo con *Abrir su página*.** Las páginas de Hadoop (9870, 8088...) solo se
abren si publicaste sus puertos en el `docker run`; el de la guía 1 publica
solo el 8080. El `docker-compose.yml` que arma la interfaz ya los trae (ver
[9. Configuración](09-configuracion-y-compose.md)).

## Paso 6. La tabla de procesos

**Qué se ve.** Columnas Proceso, Capa, Estado, Puertos, PID, Memoria, Arriba y
un menú de tres puntos (*Abrir su página*, *Copiar el PID*, *Ver su
actividad*, *Apagar* o *Prender*). Arriba, el buscador ("Buscar por nombre o
puerto") y los filtros Todos, Con problemas, HDFS, YARN, Servicios.

El Estado dice *arriba*, *arrancando*, *apagando*, *abajo* o *apagado*; en HA,
además *· activo* o *· en espera*; en un DataNode que dejó de latir, *sin
latidos · muerto en N s*.

**En la terminal.**

<!-- prueba: adentro | espera: 9870 -->
```bash
netstat -ltn | grep -E ':(9870|9000|8088|10000|3306) '
```

## Paso 7. Una falla a propósito

**Qué hacer.** En la tabla, menú del DataNode 2 → **Apagar**.

**Qué se ve.**

1. La lámpara de dn2 pasa a *caído* enseguida (el proceso ya no está), pero
   el NameNode todavía no se enteró: la fila dice *sin latidos · muerto en
   N s* y arriba aparece el cartel **Degradado** con *DataNode 2 no manda
   latidos. El NameNode lo da por muerto en N s; ahí copia sus bloques a otros
   nodos.*
2. A los 40 s, el NameNode lo da por **muerto**. El cartel cambia a
   *DataNode 2 caído. Re-replicando: N bloques con copias de menos…* y en el
   sinóptico las fichas de bloques "vuelan" de un DataNode vivo a otro.
3. Cuando todo tiene sus copias: *Sus bloques ya tienen todas las copias en
   los otros DataNodes: no se perdió nada.*

**Qué significa.** Un DataNode avisa que está vivo cada 3 s
(`dfs.heartbeat.interval`). El NameNode lo marca *stale* a los 30 s sin
latidos y *muerto* a los 2 × 5 s + 10 × 3 s = 40 s
(`dfs.namenode.heartbeat.recheck-interval` = 5000 ms). Recién ahí encola sus
bloques para copiarlos. El por qué está en
[teoría: salud de HDFS](teoria/salud-hdfs.md).

**En la terminal.** Lo mismo con el script del sandbox:

<!-- prueba: no (apaga un DataNode del cluster) -->
```bash
datanode stop 2
hdfs dfsadmin -report | grep -E 'Live|Dead'
datanode start 2
```

Para volver, **Prender** en la misma fila.

## Paso 8. Los carteles de problemas

**Qué se ve.** Cuando algo falla, arriba del sinóptico aparece un cartel
**Degradado** (ámbar) o **Con fallas** (rojo) con una lista:

- *HDFS no responde.* El NameNode está apagado (o, con HA, ZooKeeper está
  eligiendo uno nuevo).
- *N bloques perdidos.* Su única copia estaba en un DataNode muerto.
- *DataNode N no manda latidos* / *DataNode N caído*.
- *ResourceManager caído*, *MySQL caído*... Lo que depende de ese proceso no
  anda hasta que vuelva.

**Qué significa.** Con fallas (rojo) es cuando se cae algo que otros
necesitan: el NameNode, el ResourceManager, el NodeManager, Hive, el
Metastore, MySQL o MongoDB, o cuando hay bloques sin ninguna copia.
Degradado (ámbar) es cuando el cluster sigue sirviendo: un DataNode caído con
las copias a salvo, bloques con copias de menos, un servicio opcional
apagado. La barra de arriba muestra lo mismo en todas las pantallas.

## Paso 9. Actividad reciente

**Qué se ve.** Al pie, las últimas 8 entradas de la actividad y el botón
**Abrir la consola**.

**Qué significa.** Es un adelanto de la [Consola](10-consola.md): ahí está cada
evento con su comando.

## Paso 10. Reiniciar y detener

**Qué se ve.** Arriba a la derecha: **docker-compose.yml**, **Reiniciar** y
**Detener**.

- **Reiniciar** apaga en orden y vuelve a arrancar con la misma
  configuración.
- **Detener** apaga en orden y deja el contenedor esperando.

**En la terminal.** El equivalente de Reiniciar en `base`:

<!-- prueba: no (reinicia el contenedor) -->
```bash
docker restart bigdata-full
```

Con una diferencia: `docker restart` reinicia el contenedor entero (y en
`full` el cluster no vuelve solo salvo con `AUTOSTART=1`); el botón reinicia
solo el cluster.

## Dónde se usa esto en la industria

El sinóptico y la tabla de procesos son lo que hacen **Apache Ambari** y
**Cloudera Manager** en un cluster de verdad: una vista por host y por
servicio, con su estado, sus alertas y botones para arrancar o parar cada
componente. Las páginas de cada proceso (NameNode en 9870, ResourceManager en
8088) son las mismas que trae Hadoop. Ver la [referencia](referencia.md#cluster).
