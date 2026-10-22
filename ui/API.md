# API de la interfaz

Contrato entre la interfaz (`ui/`) y el backend que corre adentro del contenedor `:full`, en el puerto 8080.
Los tipos exactos están en [`src/api/types.ts`](src/api/types.ts): este documento los explica, dice qué ruta HTTP
respalda cada método y qué comando real corre el backend para responderlo.

Hay dos implementaciones de la misma interfaz `SandboxApi`:

| Implementación | Archivo | Cuándo se usa |
|---|---|---|
| `HttpApi` | `src/api/http.ts` | Si `GET /api/status` responde. Habla con el backend real. |
| Demo | `src/api/demo/` | Si no hay backend, o con `?demo` en la URL. Simula el cluster en el navegador (tiempos ×5) con datos medidos en la imagen. |

Las pantallas solo conocen `SandboxApi`, así que todo lo que funciona en el demo tiene que funcionar igual contra el backend.

## Convenciones

- Todas las rutas cuelgan de `/api` y hablan JSON (`Content-Type: application/json`), salvo `compose` (devuelve `text/yaml`) y la subida de archivos propios (`multipart/form-data`).
- Fechas: epoch en milisegundos. Tamaños: MB (con decimales; un archivo de 138 bytes es `0.000132`).
- Las acciones largas responden **202** y el avance llega por SSE (`GET /api/events`). Si el 202 trae cuerpo JSON (por ejemplo un `ActionResult` o `{ id }`), la interfaz lo usa; si viene vacío, también está bien.
- Las rutas de HDFS van siempre absolutas (`/user/root/...`).
- Las acciones nuevas devuelven un **`ActionTrace`**, el patrón que usa toda la interfaz para enseñar qué pasó:

  ```
  comando  →  qué entra  →  qué hace  →  cómo quedan los datos (con antes y después)
  ```

  ```ts
  interface ActionTrace {
    command: string;   // el comando exacto (hdfs dfs -put …, beeline -e …, spark-submit …)
    input: string;     // archivo, tabla o parámetros que entran
    action: string;    // qué hace, en una línea
    output: string;    // cómo quedan los datos
    engine?: 'hdfs' | 'mr' | 'tez' | 'spark' | 'uno';
    before?: DataSample;  // primeras filas antes
    after?: DataSample;   // primeras filas después
    appIds?: string[];    // trabajos de YARN que lanzó
  }
  ```

  `engine` dice quién hace el trabajo: `hdfs` el cliente de HDFS, `mr` MapReduce (también Pig y Sqoop), `tez` Hive sobre Tez, `spark` Spark sobre YARN y `uno` una sola máquina (pandas, scikit-learn, MySQL, MongoDB).

## Errores

Toda respuesta 4xx/5xx trae este cuerpo:

```json
{ "error": "El cluster está apagado: prendelo desde Cluster.", "code": "cluster_stopped" }
```

| `code` | Status | Cuándo |
|---|---|---|
| `cluster_stopped` | 409 | El cluster no está en marcha. |
| `service_down` | 503 | El servicio que hace falta está apagado: HiveServer2, MySQL, MongoDB, YARN… |
| `not_found` | 404 | Ruta de HDFS, tabla, aplicación o paso que no existe. |
| `invalid` | 400 | Parámetros inválidos: ruta fuera de HDFS, SQL vacío, porcentaje fuera de rango, falta la etapa anterior del pipeline. |
| `busy` | 409 | Ya hay algo corriendo que lo impide: otro paso del pipeline, el mismo archivo escribiéndose. |
| `unsupported` | 501 | No está en esta versión de la imagen (por ejemplo, ML en `:base`). |
| `failed` | 500 | El comando falló; `error` trae la última línea de su salida. |

En la interfaz llegan como `ApiFailure` (`src/api/errors.ts`), con `.code` y `.status`. El demo usa los mismos códigos.

## Eventos en vivo (SSE)

`GET /api/events` es un stream `text/event-stream`. Cada evento tiene nombre (`event:`) y un JSON en `data:`. La interfaz
le suma el `type` con el nombre del evento.

| Evento | `data` | Cuándo se manda |
|---|---|---|
| `status` | `{}` | Cambió algo del estado general: fase, procesos, memoria. La interfaz vuelve a pedir `/api/status`. |
| `activity` | `{ "entry": Activity }` | Cada línea nueva de la consola (comando, entrada, qué hizo, salida). |
| `transfer` | `{ "transfer": { "block": 1073741830, "from": "client" \| 2, "to": 3 } }` | Se copió un bloque (subida o re-replicación). Sirve para animar el rack. |
| `yarn` | `{ "appId": "application_…_0003" }` | Cambió una aplicación de YARN (estado, avance, contenedores). |
| `hdfs` | `{ "path": "/user/root/ml" }` | Se subió, borró o terminó de escribir algo en esa carpeta. |
| `step` | `{ "step": StepRun }` | Avance de un paso del pipeline (progreso, mensaje, salida, error). |
| `model` | `{ "run": ModelRun }` | Avance de un entrenamiento. |

El backend lo arma mirando sus propios procesos y, cada 2 s, el JMX del NameNode y la REST del ResourceManager. Si se
pierde un evento no pasa nada: la interfaz además vuelve a pedir el estado cada 2 s.

## Rutas

### Estado y actividad

| Método | Ruta | Respuesta | Qué consulta el backend |
|---|---|---|---|
| `status()` | `GET /api/status` | `ClusterStatus` | Sus procesos (pid, puertos), `free -m` y cgroup para la memoria, JMX del NameNode (`/jmx?qry=Hadoop:service=NameNode,name=FSNamesystem*`) y `GET :8088/ws/v1/cluster/metrics`. |
| `activity()` | `GET /api/activity?limit=200` | `Activity[]` | Su propio registro de comandos. |
| `subscribe(fn)` | `GET /api/events` | SSE (ver arriba) | — |

### Configuración y ciclo de vida

| Método | Ruta | Cuerpo → respuesta | Comando real |
|---|---|---|---|
| `validate(c)` | `POST /api/config/validate` | `{ config }` → `ConfigIssue[]` | Mismas reglas que `sandbox/lib.sh`. |
| `estimate(c)` | `POST /api/config/estimate` | `{ config }` → `RamEstimate` | RAM medida por proceso en la imagen. |
| `compose(c)` | `POST /api/config/compose` | `{ config }` → `text/yaml` | Arma el `docker-compose.yml` (ver abajo). |
| `saveConfig(c)` | `PUT /api/config` | `{ config }` → 204 | Guarda sin aplicar. |
| `start(c)` | `POST /api/cluster/start` | `{ config }` → 202 | Arranque de `sandbox/`; el avance va en `status().boot`. |
| `stop()` | `POST /api/cluster/stop` | → 202 | Apagado en orden, como `docker stop` (servicios, YARN, HDFS). |
| `apply(c)` | `POST /api/cluster/apply` | `{ config }` → 202 | Apaga y vuelve a arrancar con la nueva configuración. |
| `resetVolume()` | `POST /api/cluster/reset` | → 202 | Borra el volumen, como `docker compose down -v`. |
| `processAction(id, a)` | `POST /api/processes/:id/start` o `/stop` | → 202 | `hdfs --daemon start\|stop datanode`, `namenode`, `hiveserver2`, `mongod`… |

**La imagen `:full` arranca esperando «Iniciar».** Con la variable `AUTOSTART=1` el servidor arranca solo con la
configuración de las variables. El compose que genera `compose()` usa `franki678/bigdata-sandbox:full`, las variables
elegidas, `AUTOSTART: "1"`, el puerto 8080 y `stop_grace_period: 20s`. Las mismas variables sirven con `:base` y `:ml`,
que no tienen interfaz y arrancan siempre solas.

**Puertos** (los mismos que usa `sandbox/lib.sh`): NameNode `n` RPC `8999+n` (9000, 9001, 9002) y web `9869+n` (9870…);
DataNode `n` web `9900+n`; JournalNode `k` RPC `8484+k` y web `8479+k`; ZKFC `8018+n`; Secondary NameNode 9868; ZooKeeper 2181.

### HDFS

| Método | Ruta | Cuerpo → respuesta | Comando real |
|---|---|---|---|
| `dataNodes()` | `GET /api/hdfs/datanodes` | `DataNode[]` | JMX del NameNode, `LiveNodes` / `DeadNodes` de `NameNodeInfo`, y `hdfs dfsadmin -report`. |
| `files()` | `GET /api/hdfs/files?recursive=1` | `HdfsFile[]` | `hdfs fsck / -files -blocks -locations`. |
| `putExample(x)` | `POST /api/hdfs/put` | `{ example: "ventas" \| "numeros" \| "sucias" }` → 202 | `hdfs dfs -put /datos/ejemplos/… /user/root/…` (sucias: `ml/ventas_sucias.csv`, generado con `ejemplos/ml/generar_sucios.py`). |
| `setReplication(p, n)` | `PATCH /api/hdfs/files` | `{ path, replication }` → 204 | `hdfs dfs -setrep -w N <ruta>`. |
| `addDataNode()` | `POST /api/hdfs/datanodes` | → 202 | Arranca el DataNode N+1 en caliente con su propio `dfs.datanode.data.dir` y sus puertos. |
| `hdfsList(path)` | `GET /api/hdfs/ls?path=/user/root` | `HdfsListing` | WebHDFS `GET :9870/webhdfs/v1<path>?op=LISTSTATUS` (o `hdfs dfs -ls`). |
| `hdfsFile(path)` | `GET /api/hdfs/file?path=…` | `HdfsFileDetail` | `hdfs fsck <ruta> -files -blocks -locations` + `hdfs dfs -cat <ruta> \| head` (parquet: `pyarrow`). |
| `hdfsUpload(r)` | `POST /api/hdfs/upload` | JSON `{ dest, example, replication?, blockSize? }` o multipart con `file` → 202 `ActionResult` | `hdfs dfs -D dfs.replication=N -D dfs.blocksize=… -put <archivo> <dest>`. Avanza por `transfer` y `hdfs`. |
| `hdfsMkdir(path)` | `POST /api/hdfs/mkdir` | `{ path }` → `ActionResult` | `hdfs dfs -mkdir -p <ruta>`. |
| `hdfsDelete(p, r)` | `DELETE /api/hdfs/files?path=…&recursive=1` | → `ActionResult` | `hdfs dfs -rm -r -skipTrash <ruta>`. |
| `fsck(path)` | `GET /api/hdfs/fsck?path=/` | `FsckReport` | `hdfs fsck <ruta>`; `raw` trae la salida tal cual. |
| `replication()` | `GET /api/hdfs/replication` | `ReplicationState` | JMX del NameNode (`UnderReplicatedBlocks`, `PendingReplicationBlocks`, `MissingBlocks`, `StaleDataNodes`) y el log del NameNode para las copias recientes. |

Ejemplo de `hdfsUpload`:

```json
POST /api/hdfs/upload
{ "dest": "/user/root/ml", "example": "sucias", "replication": 2 }

202
{ "id": "up_7", "state": "running",
  "trace": { "command": "hdfs dfs -D dfs.replication=2 -put /datos/ejemplos/ml/ventas_sucias.csv /user/root/ml",
             "input": "ventas_sucias.csv · 4,5 MB · 103.000 filas",
             "action": "Lo corta en bloques de 1 MB y manda cada bloque a 2 DataNodes",
             "output": "/user/root/ml/ventas_sucias.csv · 5 bloques",
             "engine": "hdfs" } }
```

### YARN

| Método | Ruta | Cuerpo → respuesta | Comando real |
|---|---|---|---|
| `apps()` | `GET /api/yarn/apps` | `YarnApp[]` | `GET :8088/ws/v1/cluster/apps` + `…/apps/:id/appattempts` para los contenedores. |
| `submitExample(j)` | `POST /api/yarn/apps` | `{ example: "mr-ventas" \| "hive-ventas" \| "spark-ventas" }` → `{ id }` | `hadoop jar hadoop-streaming-3.3.6.jar -mapper mapper.py -reducer reducer.py …`, `beeline -f ventas.hql`, `spark-submit ejemplos/ventas.py`. |
| `killApp(id)` | `POST /api/yarn/apps/:id/kill` | → 204 | `yarn application -kill <id>` (o `PUT …/apps/:id/state {"state":"KILLED"}`). |
| `yarnCluster()` | `GET /api/yarn/cluster` | `YarnCluster` | `GET :8088/ws/v1/cluster/nodes`, `…/scheduler` y `…/metrics`. |
| `app(id)` | `GET /api/yarn/apps/:id` | `YarnAppDetail` | REST del RM + JobHistory (`:19888/ws/v1/history/mapreduce/jobs/:job/counters`), Tez (DAG del `tez.history.logging`) o Spark History (`:18080/api/v1/applications/:id/stages`). |
| `appLogs(id, c?)` | `GET /api/yarn/apps/:id/logs?container=…` | `AppLogs` | `yarn logs -applicationId <id> -containerId <c>` (o los archivos de `userlogs/` mientras corre). |

### Pipeline

Seis etapas en orden: `ingesta` → `etl` → `almacen` → `analisis` → `ml` → `resultados`. En cada una se elige una
herramienta; cada herramienta dice cuándo conviene (`whenToUse`), cuándo no (`whenNot`), si se puede usar con lo que está
corriendo (`available` + `unavailableReason`) y cuál se sugiere (`recommended`).

| Método | Ruta | Cuerpo → respuesta | Qué hace |
|---|---|---|---|
| `pipelineCatalog()` | `GET /api/pipeline/catalog` | `PipelineStageInfo[]` | Etapas y herramientas, con las opciones de cada una. |
| `pipelineState()` | `GET /api/pipeline` | `PipelineState` | El riel: etapa actual, qué sigue, motor trabajando, dato que viaja. |
| `runStep(r)` | `POST /api/pipeline/steps` | `{ stage, tool, options }` → `{ id }` | Corre el paso; avanza por SSE `step`. Falla con `invalid` si falta la etapa anterior y con `busy` si ya corre otro. |
| `steps()` | `GET /api/pipeline/steps` | `StepRun[]` | Los pasos corridos, con su `trace` y su salida. |
| `pipelineReset()` | `POST /api/pipeline/reset` | → 204 | Vuelve a la primera etapa (no borra lo que hay en HDFS). `busy` si hay un paso corriendo. |

Herramientas y comando que corre cada una:

| Etapa | `tool` | Motor | Comando real |
|---|---|---|---|
| ingesta | `put` | hdfs | `hdfs dfs -put /datos/ejemplos/ml/ventas_sucias.csv /user/root/ml/` |
| ingesta | `sqoop` | mr | `sqoop import --connect jdbc:mysql://localhost/tienda --table ventas --target-dir /user/root/ml/ventas_mysql` (`ejemplos/sqoop.sh`) |
| etl | `pandas` | uno | `python3 ejemplos/ml/etl_pandas.py` |
| etl | `pyspark` | spark | `spark-submit ejemplos/ml/etl_spark.py` |
| etl | `pig`, `hive` | — | No disponibles: no hay script de ETL para `ventas_sucias` en la imagen. |
| almacen | `hivetab` | tez | `beeline -e "CREATE EXTERNAL TABLE ventas_limpias … STORED AS PARQUET LOCATION '…'"` |
| almacen | `parquet` | hdfs | Deja el parquet en HDFS sin tabla. |
| analisis | `hive` | tez | `beeline -e "SELECT sucursal, SUM(…) FROM ventas_limpias GROUP BY sucursal"` |
| analisis | `sparksql` | spark | `spark-sql -e "…"` |
| analisis | `pandas` | uno | `pandas.read_parquet(…).groupby(…)` |
| ml | `sklearn` | uno | `python3 ejemplos/ml/modelos_sklearn.py` |
| ml | `mllib` | spark | `spark-submit ejemplos/ml/modelos_spark.py` |
| resultados | `getmerge` | hdfs | `hdfs dfs -getmerge /user/root/resultados/por_<x> /datos/por_<x>.csv` |
| resultados | `mysql` | mr | `sqoop export --table resumen_<x> --export-dir /user/root/resultados/por_<x>` |

Lo que deja cada paso va en `StepRun.output`: ruta, filas, tamaño y un resumen. Por ejemplo, el ETL de `ventas_sucias`
(103.000 filas) deja `ventas_limpias` con 97.200: saca duplicados, normaliza las fechas en tres formatos y los precios
con coma, y descarta los faltantes.

### Datos: Hive, MySQL y MongoDB

| Método | Ruta | Cuerpo → respuesta | Comando real |
|---|---|---|---|
| `catalog()` | `GET /api/data/catalog` | `CatalogEntry[]` | `beeline -e "SHOW TABLES; DESCRIBE …"`, `mysql -e "SELECT … FROM information_schema.tables"`, `pymongo`: `list_collection_names()` + `estimated_document_count()`. |
| `schema(src, name)` | `GET /api/data/schema?source=hive&name=default.ventas` | `TableSchema` | `SHOW CREATE TABLE` + `DESCRIBE FORMATTED` + `SELECT … LIMIT 5`; en MySQL `SHOW CREATE TABLE` + `SHOW INDEX`; en MongoDB `index_information()` y la presencia de cada campo en una muestra. |
| `query(src, text)` | `POST /api/data/query` | `{ source, text }` → `QueryResult` | `beeline --outputformat=tsv2 -e "<sql>"`, `mysql --batch -e "<sql>"`, `pymongo` (traduce `db.col.find/aggregate/countDocuments` de `mongosh`). |
| `explain(src, text)` | `POST /api/data/explain` | `{ source, text }` → `QueryPlan` | `EXPLAIN <sql>` en Hive y MySQL; `explain("executionStats")` en MongoDB. |
| `queryExamples()` | `GET /api/data/examples` | `QueryExample[]` | Las consultas de `ejemplos/ventas.hql`, `tienda.hql`, `tienda.sql`, `consultas_mongo.js`. |

`QueryResult.engine` dice quién la resolvió: `tez` si Hive lanzó un trabajo (con `appId`), `uno` si fue una *fetch task*
de Hive, MySQL o MongoDB. `scanned` son las filas que leyó el motor, no las que devolvió.

### Machine Learning

| Método | Ruta | Cuerpo → respuesta | Comando real |
|---|---|---|---|
| `mlDatasets()` | `GET /api/ml/datasets` | `MlDataset[]` | `clientes_senal.csv` (generado con `ejemplos/ml/generar_senal.py`) y lo que dejó el pipeline. |
| `recommend(ds, task)` | `POST /api/ml/recommend` | `{ dataset, task }` → `MlRecommendation` | Reglas fijas con los tiempos y la memoria medidos en la imagen. |
| `train(r)` | `POST /api/ml/train` | `TrainRequest` → `{ id }` | `python3 ejemplos/ml/modelos_sklearn.py [archivo]` o `spark-submit ejemplos/ml/modelos_spark.py [hdfs:///…]`: los scripts entrenan los tres problemas y el backend se queda con el modelo pedido (o corre solo esa parte del script). Avanza por SSE `model`. |
| `models()` | `GET /api/ml/models` | `ModelRun[]` | Los entrenamientos de la sesión. |

Métrica principal por tipo de problema (en `ModelRun.metrics`): `r2` en regresión, `aciertos` en clasificación y
`rand_ajustado` en agrupamiento. Valores medidos en la imagen con `clientes_senal.csv`:

| Modelo | Motor | Métrica |
|---|---|---|
| Regresión lineal | scikit-learn | R² 0,983 |
| Árbol de decisión | scikit-learn | aciertos 90,9 % |
| KMeans (k=3, escalado) | scikit-learn | Rand ajustado 0,83 |

Con Spark MLlib el resultado es el mismo, pero tarda decenas de segundos y pide 3 GB a YARN. En el demo, esos valores
vienen marcados con `reference: true` (son de referencia, no medidos en el momento).

## Modo demo

`src/api/demo/` implementa todos los métodos con un cluster simulado:

| Archivo | Qué simula |
|---|---|
| `engine.ts` | Reloj (tiempos ×5), procesos, arranque, memoria, actividad y eventos SSE. |
| `hdfs.ts` | Árbol de carpetas, bloques y réplicas, fsck, re-replicación al apagar un DataNode. |
| `yarn.ts` | Aplicaciones MapReduce, Tez y Spark con su DAG, contadores y logs. |
| `datos.ts` | Catálogo, esquemas y DDL reales de `ventas.hql`, `tienda.hql` y `tienda.sql`; consultas sobre los datos de ejemplo. |
| `pipeline.ts` | Las 6 etapas, con los prerrequisitos y lo que deja cada herramienta. |
| `ml.ts` | Entrenamientos con las métricas medidas en la imagen. |
| `datasets.ts`, `common.ts` | Datos de ejemplo y ayudas compartidas. |

Los errores del demo usan los mismos `code` que el backend.
