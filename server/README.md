# Servidor de la versión `full`

Es el backend de la interfaz web de la imagen `franki678/bigdata-sandbox:full`. Con

```bash
docker run -p 8080:8080 franki678/bigdata-sandbox:full
```

el contenedor arranca **solo este servidor**. Abrís `http://localhost:8080`,
elegís la configuración y tocás *Iniciar*. Ahí el servidor prende Hadoop y el
resto adentro del mismo contenedor y te va mostrando el progreso. No usa
`docker.sock` ni levanta contenedores: todo pasa en el contenedor en el que ya
estás.

## Stack: Starlette + uvicorn

| | Starlette 1.9 + uvicorn 0.54 | aiohttp | stdlib (`http.server`) | FastAPI |
|---|---|---|---|---|
| Dependencias | 8 wheels, **todo Python puro** | 6 libs en C (multidict, yarl, frozenlist…) | ninguna | + pydantic-core (Rust, ~5 MB) |
| amd64 y arm64 | el mismo wheel `py3-none-any` | un wheel por arquitectura | — | un wheel por arquitectura |
| SSE y procesos en asyncio | `StreamingResponse` + `asyncio.subprocess` | sí | a mano, con hilos | sí |
| Archivos estáticos con fallback | `StaticFiles(html=True)` | sí | a mano | sí |

- **Por qué este:** son ~170 KB de framework y servidor, sin compilar nada (el
  build multi-arquitectura no cambia). Además `anyio`, `h11` e `idna` ya vienen
  en la imagen `ml` a través de JupyterLab.
- **Por qué no los otros:** FastAPI agrega pydantic, que es compilado y que acá
  no aporta nada. aiohttp agrega C. La stdlib obliga a escribir a mano los hilos
  y el SSE.
- **python-multipart:** es lo que usa Starlette para leer `multipart/form-data`
  (`request.form()`), o sea, la subida de un archivo desde tu compu a HDFS
  (`POST /api/hdfs/upload`). Es un wheel `py3-none-any` de ~25 KB y va
  volcando el archivo a disco mientras llega, así que una subida de 1 GB no
  ocupa 1 GB de memoria. Escribir un parser de multipart a mano no valía la pena.
- **Resuelve junto con la imagen `ml`:** `requirements.txt` más
  `conf/requirements-ml.txt` (JupyterLab y compañía) resuelven sin conflictos en
  Python 3.12 (`pip install --dry-run -r ... -r ...`), así que no hizo falta
  aflojar los pins de `anyio`, `h11` ni `idna`.
- **uvicorn sin `[standard]`:** se usa h11 en Python puro (sin uvloop ni
  httptools). Para un solo usuario en localhost sobra.

Fuentes:

- Starlette, [StreamingResponse](https://www.starlette.io/responses/#streamingresponse) y [StaticFiles](https://www.starlette.io/staticfiles/);
- uvicorn, [instalación mínima vs. `standard`](https://www.uvicorn.org/#quickstart) y [señales y apagado](https://www.uvicorn.org/deployment/);
- Python, [asyncio.subprocess](https://docs.python.org/3/library/asyncio-subprocess.html);
- tini, [por qué un init en contenedores](https://github.com/krallin/tini#why-tini);
- Docker, [`docker stop` y el período de gracia](https://docs.docker.com/reference/cli/docker/container/stop/);
- MDN, [Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

## Cómo funciona

```
tini (PID 1)
 └─ python3 -m sandbox_server          ← escucha en :8080 desde el segundo 0
     └─ /opt/entrypoint.sh             ← lo lanza al tocar "Iniciar" (sesión propia)
         ├─ NameNode, DataNodes, YARN, Hive, Spark, MySQL, JupyterLab...
         └─ tail -F de los logs
```

- **Se reusa el arranque.** No hay una segunda forma de prender el cluster. El
  servidor corre el mismo `entrypoint.sh` de las otras imágenes, con las
  variables de siempre (`DATANODES`, `REPLICATION`, `BLOCK_SIZE`, `NAMENODES`,
  `SERVICIOS`, `MONGODB`, `JUPYTER`, `PIG_HEAPSIZE`), como si fuera
  `docker run -e`.
- **El progreso sale de la salida del entrypoint.** El servidor lee la salida
  (las líneas `[sandbox] ...`). `boot.py` arma los pasos que la interfaz muestra
  (formatear, NameNode, DataNodes, YARN, Hive...) y los marca a medida que
  aparecen, hasta `Cluster LISTO`. Cada línea de Hadoop queda en el paso en el
  que salió. Si el entrypoint termina antes de `LISTO`, el paso en curso queda
  fallido con su log y el cluster vuelve a apagado.
- **Apagado ordenado.** *Apagar* manda `SIGTERM` al entrypoint, que corre su
  trap `apagar`: primero lo que usa HDFS (Hive, Spark History), después las
  bases y al final los Java. Pasa lo mismo con `docker stop`: tini le da la señal
  al servidor, y el servidor apaga el cluster antes de salir. El orden vive en
  un solo lugar, `apagar_en_orden` de `sandbox/lib.sh`: lo usa el trap del
  entrypoint y lo usa el servidor cuando se apaga en medio del arranque (el trap
  todavía no está) o quedan procesos sueltos. Al final mata todo el grupo de
  procesos, incluido el `tail -F`, así no quedan huérfanos.
- **Estado de cada proceso.** Cada 2 s (1 s durante el arranque), el servidor
  sondea:
  - qué procesos corren, por `/proc/*/cmdline` (lo mismo que `jps`, sin
    gastar una JVM);
  - qué puertos escuchan, por `/proc/net/tcp{,6}`;
  - el JMX de los NameNodes (rol activo/standby, bloques, DataNodes vivos);
  - las métricas del ResourceManager;
  - la memoria del cgroup.

  Un proceso está `up` si corre y su puerto escucha, y `starting` si corre pero
  todavía no abrió el puerto. Si un proceso se cae o vuelve, avisa en la
  consola.
- **Ejecutor de acciones** (`actions.py`). Cualquier comando que la interfaz
  dispara (prender o apagar un proceso, subir, borrar, `fsck`, mandar o
  cancelar un trabajo de YARN; después, los pasos del Pipeline y de ML) pasa
  por `ActionRunner`. Deja registrado *comando → qué entra → qué
  hace → cómo quedan los datos* (una foto antes y otra después) y manda la
  salida en vivo, línea por línea.
- **Comandos de verdad para lo que hacés, REST para lo que se mira.** Lo que
  dispara el usuario corre el CLI real (`hdfs dfs -put`, `hadoop jar`,
  `yarn application -kill`...) por `ActionRunner`, y la interfaz muestra ese
  comando. Los sondeos de cada pocos segundos no levantan una JVM: van por
  WebHDFS del NameNode activo, JMX, el ResourceManager (:8088), JobHistory
  (:19888) y Spark History (:18080). La excepción es `hdfs fsck` (bloques y
  ubicaciones de todo el árbol): no tiene REST, se corre a lo sumo una vez por
  sondeo y solo si algo cambió en el NameNode.
- **AUTOSTART=1** arranca el cluster solo al levantar el servidor, con la
  configuración de las variables de entorno (las mismas de `:base` y `:ml`), como
  si tocaras *Iniciar*. Es lo que trae el compose que arma la interfaz.
- **La configuración se guarda en el volumen** (`/hadoop/interfaz.json`), así
  la próxima vez arranca con la misma.

## Endpoints

El contrato es el de la interfaz (`ui/src/api/types.ts` y `ui/src/api/http.ts`).
Si `GET /api/status` no contesta JSON en 1,5 s, la interfaz pasa al modo demo.

| Método y ruta | Qué hace | Respuesta |
|---|---|---|
| `GET /api/status` | Estado completo (`ClusterStatus`) | 200 JSON |
| `GET /api/activity?limit=N` | Últimas entradas de la consola | 200 `ActivityEntry[]` |
| `GET /api/events` | SSE: `status`, `activity`, `transfer`, `hdfs`, `yarn` y `action` | `text/event-stream` |
| `POST /api/config/validate` | `{config}` → problemas | 200 `ConfigIssue[]` |
| `POST /api/config/estimate` | `{config}` → memoria estimada | 200 `MemoryEstimate` |
| `POST /api/config/compose` | `{config}` → el `docker-compose.yml` para ver o bajar | 200 `text/yaml` |
| `PUT /api/config` | Guarda la configuración sin arrancar | 204 |
| `POST /api/cluster/start` | `{config}` → arranca | 202, 400 si la config no va, 409 si ya corre |
| `POST /api/cluster/stop` | Apaga en orden | 202 |
| `POST /api/cluster/apply` | `{config}` → apaga y arranca con la nueva | 202 |
| `POST /api/cluster/reset` | Borra el volumen (menos la configuración) | 202, 409 si está prendido |
| `POST /api/processes/{id}/{start\|stop}` | DataNode, NameNode, MySQL, MongoDB, HiveServer2, JupyterLab | 202 `{id}` de la acción |
| `GET /api/actions/{id}` | Una acción: estado, salida, antes/después | 200, 404 |
| `WS /api/terminal?cols=C&rows=R` | Una terminal (bash como root en `/datos`). Manda `{t:'i',d}` (lo tipeado) y `{t:'r',c,r}` (tamaño); recibe la salida tal cual. Solo desde `localhost`/`127.0.0.1` (Host y Origin) | 101; cierra con 4403 desde otro host u origen, 4404 con `TERMINAL=0`, 4429 con muchas sesiones, 1000 cuando sale bash |

### HDFS

| Método y ruta | Qué hace | De dónde sale |
|---|---|---|
| `GET /api/hdfs/datanodes` | `DataNode[]` | JMX del NameNode activo (`NameNodeInfo`: `LiveNodes`, `DeadNodes`) |
| `POST /api/hdfs/datanodes` | Agrega el DataNode N+1 en caliente → 202 `{id}` | `/opt/sandbox/bin/datanode start N` (hasta 9) |
| `GET /api/hdfs/files` | `HdfsFile[]`: todo el árbol con bloques y réplicas | `hdfs fsck / -files -blocks -locations -openforwrite` (cacheado) + WebHDFS `LISTSTATUS` para las fechas |
| `PATCH /api/hdfs/files` | `{path, replication}` → 202 `{id}` (la acción, en `GET /api/actions/:id`) | `hdfs dfs -setrep [-w] N <ruta>` |
| `DELETE /api/hdfs/files?path=&recursive=1` | Borra → `ActionResult` | WebHDFS `GETCONTENTSUMMARY` (foto de antes) + `hdfs dfs -rm [-r] -skipTrash` |
| `POST /api/hdfs/put` | `{example}` → 202 `ActionResult` | `hdfs dfs -put` del ejemplo a su carpeta de siempre |
| `GET /api/hdfs/ls?path=` | `HdfsListing` | WebHDFS `LISTSTATUS` del NameNode activo |
| `GET /api/hdfs/file?path=` | `HdfsFileDetail` con vista previa | WebHDFS `GETFILESTATUS` + `OPEN` (primeros 64 KB) + `hdfs fsck <ruta> -files -blocks -locations` |
| `POST /api/hdfs/upload` | JSON `{dest, example, replication?, blockSize?}` o multipart con `file` → 202 `ActionResult` | `hdfs dfs -D dfs.replication=N -D dfs.blocksize=… -put -f <archivo> <dest>/` |
| `POST /api/hdfs/mkdir` | `{path}` → `ActionResult` | `hdfs dfs -mkdir -p <ruta>` |
| `GET /api/hdfs/fsck?path=` | `FsckReport` (con `raw` y `trace`) | `hdfs fsck <ruta> -files -blocks -locations` |
| `GET /api/hdfs/replication` | `ReplicationState` | JMX (`UnderReplicatedBlocks`, `PendingReplicationBlocks`, `MissingBlocks`, DataNodes stale) + el fsck cacheado para las tareas (solo cuenta copias en DataNodes vivos). `noRoom`: bloques sub-replicados que no tienen adónde copiarse (piden más copias que `liveDataNodes`) |

### YARN

| Método y ruta | Qué hace | De dónde sale |
|---|---|---|
| `GET /api/yarn/apps` | `YarnApp[]` | RM `:8088/ws/v1/cluster/apps` + NM `:8042/ws/v1/node/containers` |
| `POST /api/yarn/apps` | `{example}` → 202 `{id}` (espera hasta 120 s a que YARN le dé un id) | `hadoop jar hadoop-streaming…`, `beeline -f ventas.hql` o `spark-submit ejemplos/ventas.py` |
| `GET /api/yarn/cluster` | `YarnCluster` | RM `…/metrics`, `…/nodes`, `…/scheduler`, `:8088/conf` y los contenedores del NM |
| `GET /api/yarn/apps/{id}` | `YarnAppDetail` con DAG y contadores | MapReduce: el AM por el proxy del RM mientras corre, JobHistory `:19888` después. Spark: el driver `:4040`, el proxy del RM o Spark History `:18080`. Tez: ver abajo |
| `POST /api/yarn/apps/{id}/kill` | → 204 | `yarn application -kill <id>` |
| `GET /api/yarn/apps/{id}/logs?container=` | `AppLogs` | Corriendo: NM `:8042/ws/v1/node/containerlogs`. Terminado: `yarn logs -applicationId … -containerId … -size -65536` (los agregados) |

### Pipeline

Seis etapas (ingesta, ETL, almacén, análisis, ML y resultados). Cada paso es
una acción del `ActionRunner`, y corre uno por vez.

| Método y ruta | Qué hace | Respuesta |
|---|---|---|
| `GET /api/pipeline/catalog` | Las etapas con sus herramientas: `input`/`output`, opciones con `min`/`max`, `available` y `unavailableReason` | 200 `PipelineStageInfo[]` |
| `GET /api/pipeline` | El último paso de cada etapa | 200 `PipelineState` |
| `POST /api/pipeline/steps` | `{stage, tool, options}` → corre el paso (también `POST /api/pipeline/step`) | 202 `{id}` |
| `GET /api/pipeline/steps` | El historial, el más nuevo primero | 200 `PipelineStep[]` |
| `POST /api/pipeline/reset` | Vacía el historial (no borra nada de HDFS) | 204 |

Errores del paso: `invalid` (falta la etapa anterior u opción fuera de rango),
`cluster_stopped`, `busy` (ya corre otro paso), `unsupported` (la herramienta
no está en esta configuración o en la imagen) y `failed` (en el paso, con la
última línea del motor).

Qué corre cada herramienta:

| Etapa | Herramienta | Comando |
|---|---|---|
| ingesta | `put` | `hdfs dfs -put -f /datos/ventas_sucias.csv /user/root/ml/` |
| ingesta | `sqoop` | `sqoop import … --table ventas -m N --target-dir /user/root/tienda/ventas` |
| ETL | `pandas` | `python3 ejemplos/ml/etl_pandas.py` + `hdfs dfs -put` del Parquet |
| ETL | `pyspark` | `spark-submit --master yarn ejemplos/ml/etl_spark.py` |
| ETL | `pig`, `hive` | no disponibles: la imagen no trae un script de ETL para `ventas_sucias` |
| almacén | `hivetab` | `beeline -e "CREATE EXTERNAL TABLE … STORED AS PARQUET LOCATION …"` |
| almacén | `parquet` | `hdfs dfs -ls /user/root/ml/ventas_limpias` |
| análisis | `hive` / `sparksql` / `pandas` | `INSERT OVERWRITE DIRECTORY /user/root/resultados/por_<campo> … GROUP BY <campo>` con beeline, `spark-sql` o `jobs/resumen_pandas.py` |
| ML | `sklearn` / `mllib` | lo mismo que `POST /api/ml/train` con el modelo del pipeline; el paso deja `modelId` |
| resultados | `getmerge` | `hdfs dfs -getmerge /user/root/resultados/por_<campo> por_<campo>.csv` |
| resultados | `mysql` | `sqoop export … --table resumen_<campo> --export-dir … -m 1` (crea la tabla antes con `mysql`) |

Sqoop recibe el usuario y la clave por variables de entorno de la acción
(`SQOOP_USER`, `SQOOP_PASS`): el comando que se ve en la consola no trae la
clave.

### Datos

| Método y ruta | Qué hace | De dónde sale |
|---|---|---|
| `GET /api/data/catalog` | `DataTable[]` de Hive, MySQL y MongoDB (las fuentes apagadas no aparecen). Se cachea 20 s y el pipeline lo invalida | `beeline` (`SHOW DATABASES`/`TABLES`, `DESCRIBE FORMATTED`), `mysql` (`information_schema`) y `mongosh` (muestra de documentos) |
| `GET /api/data/schema?source=&name=` | `TableSchema`: columnas, DDL, índices, formato, tamaño y una muestra | Lo mismo, más `SHOW CREATE TABLE`, `SHOW INDEX` y el tamaño (`totalSize` de Hive o WebHDFS `GETCONTENTSUMMARY`) |
| `POST /api/data/query` | `{source, text}` → `QueryResult` (hasta 1000 filas). En Hive, si lanzó un trabajo Tez, trae `appId`. En Hive, MySQL y Pig trae `raw`: la salida del comando como en la terminal (`{stream, text}`, las últimas 60 de stderr y hasta 200 de stdout) | `beeline --outputformat=tsv2`, `mysql --batch`, `mongosh --quiet --eval` |
| `POST /api/data/explain` | `{source, text}` → `QueryPlan` con nodos y `raw` | `EXPLAIN` en Hive y en MySQL, `.explain("executionStats")` en MongoDB |
| `GET /api/data/examples` | Consultas de ejemplo de cada fuente | `ejemplos/` de la imagen |

Una consulta que falla da `failed` con la última línea de error del motor
(`FAILED: SemanticException …`, `ERROR 1146 …`, `SyntaxError: …`). En MongoDB,
una colección que no existe devuelve cero documentos, como el shell.

### Machine Learning

| Método y ruta | Qué hace | Respuesta |
|---|---|---|
| `GET /api/ml/datasets` | `clientes_senal.csv` con filas, columnas, muestra y objetivos | 200 `MlDataset[]` |
| `POST /api/ml/recommend` | `{dataset, task}` → modelos y motores recomendados, con lo esperado | 200 `MlRecommendation` |
| `POST /api/ml/train` | `{dataset, task, model, engine, trainPct, target?, features?, params?}` → entrena | 202 `{id}` |
| `GET /api/ml/models` | Los modelos entrenados, el más nuevo primero | 200 `MlRun[]` |
| `GET /api/ml/models/{id}/viz` | Lo de adentro del modelo para dibujarlo: pesos, nodos, centros o coeficientes, y una muestra con lo que predijo | 200 `Viz` (404 si no hay) |

`train` corre un job de `sandbox_server/jobs/`: `python3 entrenar_sklearn.py
clientes_senal.csv …` (scikit-learn) o `spark-submit --master yarn
entrenar_spark.py hdfs:///user/root/ml/clientes_senal.csv …` (MLlib, que sube el
CSV a HDFS si no está). Si el CSV no existe, lo genera con
`ejemplos/ml/generar_senal.py`. El job imprime su avance (`== mensaje|0.4`) y
al final una línea `@@resultado@@ {json}` con métricas, matriz de confusión y
predicciones. Los modelos son medidos (`reference: false`).

El job además escribe lo de adentro del modelo en un archivo aparte
(`SANDBOX_VIZ`, con `jobs/viz.py`): pesos y sesgos de la red (y los de cada
época en scikit-learn), los nodos del árbol, los centros de KMeans con el
recorrido de Lloyd, coeficientes y escaladores, más una muestra de filas de
prueba con lo que predijo el modelo. Va a un archivo y no a la salida porque
puede pesar cientos de KB (tope 3 MB); el servidor guarda los de los últimos 30
modelos y el run solo lleva `hasViz` (o `vizError` si no se pudo). Con eso la
interfaz rehace la cuenta en el navegador y tiene que dar lo mismo que el
servidor: el humo lo compara con tolerancia 1e-6.

Valida `target` (el del problema; clustering no lleva), `features` (columnas
de entrada, sin el objetivo ni `segmento_real`) y `params` según el modelo, y
devuelve todo con los valores por defecto aplicados.

### Eventos SSE

| Evento | Cuándo |
|---|---|
| `status` | Cambió el estado del cluster (cada sondeo, si algo cambió) |
| `activity` | Una entrada nueva de la consola |
| `transfer` | `{transfer: {block, from: 'client' \| n, to}}`: apareció una copia de un bloque entre dos fsck |
| `hdfs` | `{path}`: se subió, borró o terminó de escribir algo en esa carpeta |
| `yarn` | `{appId}`: una aplicación cambió de estado, de avance o de contenedores |
| `action` | Línea de salida (`{id, t, stream, text}`) o cambio de estado (`{id, state, ...}`) de una acción |
| `step` | `{step}`: un paso del pipeline arrancó, avanzó o terminó |
| `model` | `{run}`: un entrenamiento arrancó, avanzó (`progress`, `message`, `appId`) o terminó |

### Errores

Todos los errores son JSON `{error, code}` con los códigos de
`ui/src/api/errors.ts`:

| `code` | Status | Cuándo |
|---|---|---|
| `cluster_stopped` | 409 | El cluster está apagado |
| `service_down` | 503 | Hace falta un servicio que está caído (NameNode, RM...) |
| `not_found` | 404 | No existe la ruta, el archivo o la aplicación |
| `invalid` | 400 | Parámetros mal (los de validación traen además `issues`) |
| `busy` | 409 | Ya hay algo que lo impide (por ejemplo, ese archivo se está subiendo) |
| `unsupported` | 501 | No está en esta configuración o en esta imagen |
| `failed` | 500 | El comando falló: `error` trae la última línea de su salida |

Todo lo que no es `/api` sirve la interfaz compilada (`UI_DIR`), con
`index.html` como fallback.

### Fuera del contrato original

- el evento SSE `action` y `GET /api/actions/{id}`: la salida en vivo de cada
  comando. La interfaz escucha `action` para saber cuándo terminó cada uno;
  `GET /api/actions/{id}` todavía no lo usa;
- `POST /api/processes/{id}/start|stop` responde 202 con `{id}` de la acción
  (el contrato no dice qué trae el cuerpo).

### Decisiones y aproximaciones

- **Tez sin DAG por REST.** La imagen no tiene Timeline Server, así que no hay
  de dónde sacar los vértices de Tez por REST. Si el trabajo lo mandó la
  interfaz, el DAG sale de las líneas de avance que imprime beeline
  (`Map 1: 6/6  Reducer 2: 1(+1)/2`). Si lo mandaste a mano, queda una sola
  etapa "DAG de Tez" con el avance del RM.
- **Spark.** Por REST, Spark no publica el árbol de etapas ni la lista de
  tareas de cada una. Dentro de un job, cada etapa depende de la anterior, y las
  tareas se arman a partir de los conteos (`numTasks`, `numCompleteTasks`...).
- **Transferencias.** HDFS no avisa cuándo copia un bloque. El servidor compara
  las ubicaciones de cada bloque entre dos `fsck`. Un bloque nuevo es una tubería
  cliente → DN → DN, y una ubicación nueva es una copia desde la primera que ya
  estaba. Es una aproximación, y no ve copias que empiezan y terminan entre dos
  sondeos del mismo bloque.
- **`writtenBy`** sale de la ruta (`/user/hive/warehouse` → Hive,
  `resultados/mr_*` → MapReduce...). HDFS no guarda quién escribió qué.
- **`setrep -w`** solo se usa si hay suficientes DataNodes vivos: con menos,
  esperaría para siempre.
- **Vista previa de Parquet:** no hay pyarrow en la imagen `base`, así que se
  informa el formato sin filas.
- **Archivos escribiéndose** (`OPENFORWRITE` o `._COPYING_`): quedan en estado
  `writing` y no cuentan como sub-replicados.
- **Subidas desde la compu:** el archivo va a una carpeta temporal
  (`SANDBOX_UPLOADS`) que se borra cuando termina el `-put`. El límite es
  `SANDBOX_MAX_UPLOAD_MB`.

## Variables de entorno

| Variable | De fábrica | Para qué |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Dónde escucha |
| `UI_DIR` | `/opt/sandbox/ui` | La interfaz compilada (`ui/dist`) |
| `SANDBOX_ENTRYPOINT` | `/opt/entrypoint.sh` | Qué arranca el cluster |
| `SANDBOX_HADOOP_DIR` | `/hadoop` | El volumen |
| `SANDBOX_BIN` | `/opt/sandbox/bin` | `datanode`, `namenode`, `estado` |
| `SANDBOX_LIB` | `/opt/sandbox/lib.sh` | De donde sale `apagar_en_orden` |
| `SANDBOX_STOP_TIMEOUT` | `18` | Segundos que espera el apagado ordenado antes de matar |
| `SANDBOX_VERSION` | `full` | Tag que muestra la interfaz |
| `LOG_LEVEL` | `warning` | Log de uvicorn |
| `AUTOSTART` | `0` | `1`: arranca el cluster solo, con las variables de `:base`/`:ml` |
| `SANDBOX_DATOS` | `/datos` | Donde están los ejemplos (`ejemplos/`, `ventas_grandes.csv`...) |
| `SANDBOX_UPLOADS` | `$TMPDIR/sandbox-subidas` | Carpeta temporal de las subidas desde la compu |
| `SANDBOX_MAX_UPLOAD_MB` | `2048` | Tamaño máximo de una subida |
| `TERMINAL` | `1` | `0`: apaga la terminal de la interfaz (`/api/terminal`) |
| `TERMINAL_HOSTS` | (vacío) | Otros nombres desde los que se acepta la terminal, separados por coma (además de `localhost`, `127.0.0.1` y `::1`). Ojo: quien llegue por ese nombre tiene una terminal de root |
| `TERMINAL_CWD` | `/datos` | Dónde arranca la terminal |
| `SANDBOX_SQOOP_USER` / `SANDBOX_SQOOP_PASS` | los de `ejemplos/sqoop.sh` | Usuario y clave de MySQL para `sqoop import`/`export`. Le llegan a sqoop por variables de entorno, no en el comando que se muestra |

Si el contenedor se apaga con `docker stop`, conviene darle 20 s
(`stop_grace_period: 20s` en el compose, `docker stop -t 20`). Al salir, el
proceso termina con código 143: uvicorn vuelve a levantar la señal que recibió.

## Probarlo

Sin Hadoop: los tests usan fixtures de Hadoop 3.3.6, Spark 3.5 y Hive 4.0.0
(JMX, `fsck`, WebHDFS, el REST de YARN, JobHistory y Spark History, `yarn logs`,
beeline). Casi todas son salidas reales que tomó el humo de la imagen `full`;
`tests/fixtures/README.md` dice de dónde sale cada una, cuáles siguen
sintéticas y qué cambió al pasar a las reales. También hay un
entrypoint falso (`tests/fixtures/entrypoint_falso.sh`). Ese entrypoint escribe los mismos
mensajes, puede fallar a propósito y tiene el mismo trap de apagado.

```bash
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-test.txt
python3 -m pytest -q
```

Los comandos (`hdfs`, `yarn`, `spark-submit`) se reemplazan por scripts falsos
en el `PATH` que anotan lo que les piden, y WebHDFS/YARN por un `http` que
contesta con las fixtures. El CI (`.github/workflows/server.yml`) corre lo mismo
con Python 3.12 en cada push a `full` o `main` que toque `server/`.

Pipeline, Datos y ML usan `tests/falsos.py`: `hdfs dfs`, `beeline`, `mysql`,
`mongosh`, `sqoop`, `spark-submit` y `spark-sql` falsos que guardan su estado
en una carpeta (HDFS, tablas de Hive y de MySQL, colecciones de MongoDB). Con
eso el pipeline completo corre de punta a punta. Los errores tienen el formato
de cada motor, y con `FALSO_FALLA=<comando>` ese comando falla. Los jobs
reales de entrenamiento se prueban con scikit-learn de verdad solo si está
instalado (`test_job_real_confusion_y_predicciones`; en el CI se saltea).

`tests/fixtures/ui_cluster.json` tiene casos calculados con el `cluster.ts` de
la interfaz. Así la validación, la estimación de memoria y el compose del
servidor dan lo mismo que el modo demo.

Para levantarlo a mano con el entrypoint falso:

```bash
SANDBOX_ENTRYPOINT="bash tests/fixtures/entrypoint_falso.sh" SANDBOX_HADOOP_DIR=/tmp/vol \
  FALSO_VOLUMEN=/tmp/vol PORT=4100 python3 -m sandbox_server
```

**Prueba de humo** contra la imagen real: `tests/humo/humo_full.py`, que corre
el workflow `Full` (`.github/workflows/full.yml`) en cada push a `full`, en amd64
y arm64. Arma el target `full`, levanta el contenedor (espera «Iniciar») y pasa
por todo con la API: arranque y apagado (solo HDFS y todo), HDFS (ls, put, file,
fsck, replicación, DataNodes apagados y prendidos, "put terminado" contra el
archivo real), YARN (apps, submit, kill, logs), el pipeline de seis etapas con
sus eventos `step` y las variantes (sqoop con `SANDBOX_SQOOP_*`, pandas,
sparksql, getmerge, mllib), Datos (catálogo, esquemas, consultas con Tez,
explain y un error de cada motor) y ML (scikit-learn con la matriz de
`ejemplos/ml/modelos_sklearn.py`, MLlib con su `appId`). Después prueba
`AUTOSTART=1` y que `docker stop` apague en orden. No publica nada: deja el
resumen, los tiempos, las respuestas de la API y las salidas crudas en el
artifact `humo-full-<arq>`.

```bash
gh workflow run full.yml --ref full    # o un push a full
gh run download <run> -n humo-full-amd64
```

`tests/humo/test_humo.py` es el humo chico de antes (solo HDFS, a mano):

```bash
docker run -d --name humo -p 8080:8080 franki678/bigdata-sandbox:full
SANDBOX_HUMO=1 python3 server/tests/humo/test_humo.py
```

Tiempos medidos en el CI (runners de GitHub, segundos, amd64 / arm64):

| Qué | amd64 | arm64 |
|---|---|---|
| Arranque solo HDFS / todo | 15 / 39 | 15 / 39 |
| DataNode apagado hasta que el NameNode lo da por muerto | 40 | 40 |
| YARN: MapReduce / Spark / Hive con Tez (total) | 24 / 30 / 26 | 25 / 38 / 31 |
| Pipeline: put, ETL pyspark, tabla en Hive, análisis Hive | 4, 41, 20, 16 | 4, 47, 22, 21 |
| Pipeline: sklearn, sqoop export, sqoop import, ETL pandas | 4, 16, 22, 6 | 4, 16, 22, 8 |
| Pipeline: Spark SQL, pandas, getmerge, MLlib | 24, 8, 2, 30 | 28, 8, 2, 38 |
| Consulta de Hive con Tez en Datos | 12–19 | 13–18 |
| ML: scikit-learn / MLlib | 2 / 28 | 2 / 36 |

El `POST /api/yarn/apps` bloquea hasta tener el `appId`: 8 a 13 s.

## Qué falta

- **Pig y Hive en el ETL:** quedan como no disponibles hasta que la imagen
  traiga un `etl.pig` y un `etl.hql` para `ventas_sucias.csv`.
- **Fixtures que siguen sintéticas:** NameNode en standby (HA) y en modo
  seguro, y el `/proc` de `scan_proc`.
