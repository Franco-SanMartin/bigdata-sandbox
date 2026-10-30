# Referencia de la interfaz, pantalla por pantalla

Para consultar, no para leer de corrido. Por cada pantalla: qué muestra cada
parte, **de dónde sale el dato** (la ruta de la API que la alimenta y lo que
esa ruta le pregunta a Hadoop), el **comando equivalente** para hacerlo en la
terminal y dónde aparece lo mismo en la industria. El paso a paso está en las
guías [1](01-arrancar-y-recorrido.md) a [10](10-consola.md); el contrato
completo de la API, con los tipos, en [`ui/API.md`](../../ui/API.md).

[← 10. Consola](10-consola.md) · [Índice de full](README.md) · [Teoría →](teoria/README.md)

Cómo leer las tablas:

- **De dónde sale**: `MÉTODO /api/...` es la ruta del servidor de la
  interfaz (el que corre adentro del contenedor, en el 8080); después de la
  flecha, lo que esa ruta consulta o corre.
- **Comando equivalente**: va **adentro** del contenedor
  (`docker exec -it bigdata-full bash`), salvo los de `docker`, que van en tu
  compu.
- Todas las pantallas se refrescan solas: el servidor manda eventos por SSE
  (`GET /api/events`) y, además, la interfaz vuelve a pedir el estado cada
  2 s.

## Global: barra lateral, barra de arriba, paleta y ayuda

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Barra lateral | Las pantallas por capa: Empezar (Inicio, Prácticas), Almacenamiento (HDFS, Tablas, Bases), Recursos (Trabajos), Procesamiento (Lenguajes, Comparar, Machine Learning), Ingesta (Pipeline), Operar (Cluster, Consola, Configuración) | Fija, en la interfaz | — |
| Estado arriba | *Apagado*, *Arrancando · Paso N de M*, en marcha, *Degradado* o *Con fallas* | `GET /api/status` → procesos propios, JMX del NameNode, REST del ResourceManager | `estado` |
| Consola (`Ctrl+J`) | El cajón con los eventos | `GET /api/activity?limit=200` + SSE `activity` | `docker logs bigdata-full` |
| Paleta (`Ctrl+K`) | Buscar pantallas y acciones | Fija, en la interfaz | — |
| Ayuda (`?`) | Qué es cada pantalla y los atajos | Fija, en la interfaz | — |
| Direcciones | `#hdfs`, `#yarn/application_…`, `#cluster/dn2`... | La interfaz | — |

Atajos: `G` y después la letra. `G I` Inicio, `G R` Prácticas, `G H` HDFS,
`G T` Tablas, `G B` Bases, `G Y` Trabajos, `G L` Lenguajes, `G K` Comparar,
`G P` Pipeline, `G M` Machine Learning, `G C` Cluster, `G O` Consola,
`G S` Configuración. La dirección vieja `#datos` (Consultas) lleva a Lenguajes.

Si no hay servidor (o se abre con `?demo` en la dirección), la interfaz usa
el **modo demo**: simula el cluster en el navegador con datos medidos en la
imagen y los tiempos acelerados. Sirve para mirar las pantallas sin Docker.

**En la industria.** La barra de estado global y la paleta de comandos son el
patrón de las consolas de nube (AWS, GCP, Azure) y de **Ambari** / **Cloudera
Manager**: un indicador de salud siempre visible y un buscador para saltar a
cualquier recurso.

## Inicio

Guía: [1. Arrancar y primer recorrido](01-arrancar-y-recorrido.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Estado | *El cluster está andando*, *degradado* o *con fallas*, procesos y DataNodes vivos, **Ver qué falla** | `GET /api/status` | `estado`, `jps` |
| Qué podés hacer ahora | Una tarjeta por tema: *Listo*, *Arrancando* o *No disponible* con el motivo y el arreglo | El estado de cada proceso cruzado con la configuración (`SERVICIOS`, `MONGODB`, `JUPYTER`, `NAMENODES`) | `estado` |
| Prácticas sugeridas | Las primeras que se pueden hacer ya | El avance guardado en el navegador + el estado | — |
| Archivos en HDFS | Cuántos, cuánto pesan, el último | `GET /api/hdfs/files` → `hdfs fsck / -files -blocks -locations` | `hdfs dfs -ls -R /` |
| Tablas de Hive | Cuántas y cuáles | `GET /api/data/catalog` → `beeline -e "SHOW TABLES; …"` (solo si Hive está listo) | `beeline -u jdbc:hive2://localhost:10000 -e "SHOW TABLES;"` |
| Trabajos en YARN | Cuántos y el último | `GET /api/yarn/apps` → `:8088/ws/v1/cluster/apps` | `yarn application -list -appStates ALL` |
| Modelos entrenados | Cuántos y el último | `GET /api/ml/models` → los entrenamientos de la sesión | — |
| Últimas acciones | Lo último que pasó, con el comando | `GET /api/activity` | `docker logs bigdata-full` |

**En la industria.** Es la página de inicio de cualquier plataforma de datos
administrada (**Databricks**, **EMR**, **Dataproc**): estado del cluster,
accesos rápidos y lo último que se hizo.

## Cluster

Guía: [2. El panel del cluster y el sinóptico](02-cluster-y-sinoptico.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Vista previa (apagado) | Arquitectura, Configuración y Memoria estimada | `POST /api/config/estimate` → suma fija por parte (ver [Configuración](#configuración)) | — |
| Arranque | *N de M pasos*, cada paso con su comando y su log | `GET /api/status` (campo `boot`) → las líneas `[sandbox] …` de `/opt/entrypoint.sh` | `docker logs bigdata-full 2>&1 \| grep '\[sandbox\]'` |
| Sinóptico (lámparas) | Un módulo por proceso, por capa: Metadatos, Datos, Cómputo, Servicios | `GET /api/status` → `/proc/*/cmdline` (el proceso está) + `/proc/net/tcp` (el puerto escucha) | `jps`, `netstat -ltn` |
| Fichas de bloques | Los bloques de cada DataNode y las copias que viajan | `GET /api/hdfs/files` + SSE `transfer` | `hdfs fsck / -files -blocks -locations` |
| Procesos | Arriba / total, *todos responden* o *N con problemas* | `GET /api/status` | `jps` |
| DataNodes vivos | Vivos / total, *sin latidos*, *muerto* | JMX `FSNamesystemState` (`NumLiveDataNodes`, `NumDeadDataNodes`) | `hdfs dfsadmin -report` |
| Bloques | Total, perdidos, con copias de menos | JMX `FSNamesystem` (`BlocksTotal`, `MissingBlocks`, `UnderReplicatedBlocks`) | `hdfs fsck /` |
| YARN | Memoria usada / total, corriendo y en cola | `GET :8088/ws/v1/cluster/metrics` | `curl -s http://localhost:8088/ws/v1/cluster/metrics` |
| Memoria | Uso del contenedor sobre su tope, con historia | cgroup del contenedor y `free -m` | `free -m` |
| Detalle de un proceso | Estado, Capa, Puertos, Página, PID, Memoria, *Arriba desde*; en un DataNode, Bloques, Último latido y Carpeta | `GET /api/status` + `GET /api/hdfs/datanodes` | `ps -o pid,rss,etime -p <PID>` |
| Apagar / Prender | Un DataNode, el NameNode, MySQL, MongoDB, HiveServer2 o JupyterLab | `POST /api/processes/:id/stop` o `/start` → `GET /api/actions/:id` | `datanode stop 2`, `datanode start 2`, `hdfs --daemon stop namenode` |
| Carteles Degradado / Con fallas | Qué falla y qué depende de eso | Los arma la interfaz con lo que trae `GET /api/status`: el estado de cada proceso y los números de HDFS | `hdfs dfsadmin -report`, `hdfs fsck /` |
| Actividad reciente | Las últimas 8 entradas | `GET /api/activity` | `docker logs bigdata-full` |
| Reiniciar / Detener | Apagado en orden y vuelta a arrancar | `POST /api/cluster/apply` / `POST /api/cluster/stop` | `docker restart bigdata-full` (reinicia el contenedor, no solo el cluster) |

**En la industria.** La vista por host y por servicio de **Apache Ambari** y
**Cloudera Manager**, con sus alertas y sus botones de arrancar y parar. Las
lámparas son un *health check* de dos niveles (proceso vivo y puerto que
atiende), el mismo que hacen las *liveness* y *readiness probes* de
Kubernetes. Teoría: [la interfaz y el cluster](teoria/ui-y-cluster.md),
[salud de HDFS](teoria/salud-hdfs.md).

## HDFS

Guía: [3. HDFS desde la interfaz](03-hdfs.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Etiqueta de salud | *sano*, *N bloques sub-replicados*, *N DataNodes caídos*, *N bloques perdidos*, *safe mode*, *NameNode no responde* | `GET /api/hdfs/replication` → JMX (`UnderReplicatedBlocks`, `MissingBlocks`...) + `GET /api/hdfs/datanodes` → JMX `NameNodeInfo` | `hdfs dfsadmin -report`, `hdfs dfsadmin -safemode get` |
| Archivos: lista | Nombre, Tamaño, Réplica, Bloques, Estado, Modificado | `GET /api/hdfs/ls?path=…` → WebHDFS `:9870/webhdfs/v1<ruta>?op=LISTSTATUS` | `hdfs dfs -ls <ruta>` |
| Crear carpeta | — | `POST /api/hdfs/mkdir` | `hdfs dfs -mkdir -p <ruta>` |
| Subir | Ejemplos o un archivo de tu compu, con réplica y bloque | `POST /api/hdfs/upload` (o `POST /api/hdfs/put` para los ejemplos) | `hdfs dfs -D dfs.replication=N -D dfs.blocksize=X -put <archivo> <ruta>` |
| Detalle y mapa de bloques | Ruta, Tamaño, Bloques, Copias, Lo escribió, Permisos; una fila por bloque y una columna por DataNode | `GET /api/hdfs/file?path=…` → `hdfs fsck <ruta> -files -blocks -locations` | `hdfs fsck <ruta> -files -blocks -locations` |
| Ver | Los primeros 64 KB, en tabla o texto | `GET /api/hdfs/cat?path=…&offset=…&length=…` | `hdfs dfs -cat <ruta> \| head` |
| Bajar | El archivo en el navegador | `GET /api/hdfs/download?path=…` | `hdfs dfs -get <ruta> /datos/` |
| Mover | Nueva ruta | `POST /api/hdfs/move` | `hdfs dfs -mv <origen> <destino>` |
| Borrar | Sin papelera | `DELETE /api/hdfs/files?path=…&recursive=1` | `hdfs dfs -rm -r -skipTrash <ruta>` |
| Réplica | Copias antes → después | `PATCH /api/hdfs/files` → `hdfs dfs -setrep -w N <ruta>` (sin `-w` si no hay N DataNodes vivos) | `hdfs dfs -setrep N <ruta>` |
| Salud: fsck | HEALTHY o CORRUPT, copias de menos y de más, perdidos, la salida cruda | `GET /api/hdfs/fsck?path=…` → `hdfs fsck <ruta>` | `hdfs fsck /` |
| Salud: re-replicación | Curva, sub-replicados, en cola, perdidos, copias de más; la cola de tareas y las copias recientes | `GET /api/hdfs/replication` → JMX (`UnderReplicatedBlocks`, `PendingReplicationBlocks`, `MissingBlocks`...) + SSE `transfer` | `hdfs fsck / \| grep -E 'Under-replicated\|queued'` |
| DataNodes | Estado, latido, bloques, ocupado; Sumar, apagar y prender | `GET /api/hdfs/datanodes` → JMX `NameNodeInfo` + `hdfs dfsadmin -report`; `POST /api/hdfs/datanodes` para sumar | `datanode`, `datanode start N` |

**En la industria.** El *Browse the file system* del NameNode
(`localhost:9870`), el explorador de **Hue** y el *Files View* de **Ambari**;
las alertas de *under-replicated* y *missing blocks* de **Cloudera Manager**.
Teoría: [salud de HDFS](teoria/salud-hdfs.md).

## Trabajos en YARN

Guía: [4. YARN y los trabajos](04-trabajos-yarn.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Etiqueta y subtítulo | *listo*, *N corriendo*, *N en cola*; NodeManagers, memoria y vcores | `GET /api/yarn/cluster` → `:8088/ws/v1/cluster/nodes`, `…/scheduler`, `…/metrics` | `yarn node -list` |
| Números | Memoria en uso, Corriendo, En cola, Terminados | `GET /api/yarn/cluster` | `curl -s http://localhost:8088/ws/v1/cluster/metrics` |
| Lista de trabajos | Nombre, motor, estado, avance | `GET /api/yarn/apps` → `:8088/ws/v1/cluster/apps` + `:8042/ws/v1/node/containers` | `yarn application -list -appStates ALL` |
| Nuevo trabajo | Las 7 plantillas con sus parámetros y *Lo mismo en la terminal* | `GET /api/yarn/templates`; lanzar: `POST /api/yarn/apps` | `hadoop jar …/hadoop-mapreduce-examples-3.3.6.jar wordcount <entrada> <salida>` |
| Detalle: avance y resumen | Estado (ACCEPTED, RUNNING, FINISHED, FAILED, KILLED), Cola, Enviado, Memoria, Entra, Sale, Comando | `GET /api/yarn/apps/:id` → REST del ResourceManager | `yarn application -status <id>` |
| DAG | Fases (MapReduce), vértices (Tez) o etapas (Spark) | MapReduce: el ApplicationMaster y JobHistory (`:19888`); Tez: las tablas que imprime `beeline`; Spark: el driver (`:4040`) o Spark History (`:18080`) | `mapred job -status <job>` |
| Logs | Un log por contenedor (stdout, stderr, syslog) | `GET /api/yarn/apps/:id/logs?container=…` → `yarn logs` | `yarn logs -applicationId <id>` |
| Contadores | Lecturas, escrituras, registros | JobHistory `:19888/ws/v1/history/mapreduce/jobs/:job/counters` | `mapred job -status <job>` |
| Cancelar | — | `POST /api/yarn/apps/:id/kill` | `yarn application -kill <id>` |

**En la industria.** La interfaz del ResourceManager (`localhost:8088`), la de
Spark (`:4040` y Spark History), el **Tez UI** y, en la nube, las vistas de
trabajos de **EMR** y **Dataproc**. Teoría:
[ciclo de vida de una aplicación en YARN](teoria/ciclo-de-vida-yarn.md).

## Consultas

Guía: [5. Consultas](05-consultas.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Selector de motor | Hive, MariaDB, MongoDB, Pig, con su lámpara | `GET /api/status` | `estado` |
| Tablas (catálogo) | Tablas de Hive y MariaDB y colecciones de MongoDB, con filas | `GET /api/data/catalog` → `beeline -e "SHOW TABLES; DESCRIBE …"`, `information_schema.tables` de MySQL, MongoDB | `beeline -u jdbc:hive2://localhost:10000 -e "SHOW TABLES;"`, `mysql --batch tienda -e "SHOW TABLES;"` |
| Esquema | Columnas, formato, ubicación | `GET /api/data/schema?source=…&name=…` → `SHOW CREATE TABLE` + `DESCRIBE FORMATTED` | `beeline … -e "DESCRIBE FORMATTED ventas;"` |
| Ejemplos | Las consultas de cada motor | `GET /api/data/examples` → `ejemplos/ventas.hql`, `tienda.hql`, `tienda.sql`, `consultas_mongo.js` | `cat /datos/ejemplos/ventas.hql` |
| Correr | Resultado (hasta 1000 filas), motor, tiempo, id de YARN | `POST /api/data/query` → `beeline --outputformat=tsv2 -e`, `mysql --batch -e`, `mongosh --eval`, `pig` | `beeline -u jdbc:hive2://localhost:10000 --outputformat=tsv2 -e "<sql>"` |
| Plan | El plan del motor | `POST /api/data/explain` → `EXPLAIN` en Hive y MySQL, `explain("executionStats")` en MongoDB | `mysql --batch tienda -e "EXPLAIN SELECT …"` |
| Guardadas, historial, pestañas | Lo tuyo | `localStorage` del navegador | — |

**En la industria.** Los editores SQL de **Hue**, **DBeaver**, **Apache
Superset (SQL Lab)**, **Databricks SQL**, **Athena** o **BigQuery**: catálogo
a la izquierda, editor, resultado y plan. Teoría:
[la interfaz y el cluster](teoria/ui-y-cluster.md).

## Pipeline

Guía: [6. Pipeline de punta a punta](06-pipeline.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Riel | Las 6 etapas con su estado, herramienta y salida; el dato que viaja | `GET /api/pipeline` | — |
| Etapa elegida y herramientas | Entra → sale, qué necesita, cuándo conviene cada herramienta | `GET /api/pipeline/catalog` | — |
| Correr | La corrida con su avance, motor, YARN, Dejó y el trace | `POST /api/pipeline/steps` + SSE `step` | Según la herramienta, abajo |
| Historial | Todas las corridas | `GET /api/pipeline/steps` | — |
| Empezar de nuevo | El riel a la primera etapa | `POST /api/pipeline/reset` (no borra datos) | — |

Comandos por etapa y herramienta:

| Etapa | Herramienta | Motor | Comando |
|---|---|---|---|
| Ingesta | `hdfs dfs -put` | HDFS | `hdfs dfs -put /datos/ejemplos/ml/ventas_sucias.csv /user/root/ml/` |
| Ingesta | Sqoop | MapReduce | `sqoop import --connect jdbc:mysql://localhost/tienda --table ventas -m N --target-dir /user/root/tienda/ventas` |
| ETL | pandas | una máquina | `python3 ejemplos/ml/etl_pandas.py` |
| ETL | PySpark | Spark | `spark-submit ejemplos/ml/etl_spark.py` |
| Almacenamiento | Tabla de Hive | una máquina | `beeline -e "CREATE EXTERNAL TABLE ventas_limpias … STORED AS PARQUET LOCATION '…'"` |
| Almacenamiento | Parquet en HDFS | HDFS | (deja el Parquet sin tabla) |
| Análisis | Hive | Tez | `beeline -e "SELECT … FROM ventas_limpias GROUP BY …"` |
| Análisis | Spark SQL | Spark | `spark-sql -e "…"` |
| Análisis | pandas | una máquina | `pandas.read_parquet(…).groupby(…)` |
| ML | scikit-learn | una máquina | `python3 server/sandbox_server/jobs/entrenar_sklearn.py` |
| ML | MLlib | Spark | `spark-submit server/sandbox_server/jobs/entrenar_spark.py` |
| Resultados | getmerge | HDFS | `hdfs dfs -getmerge /user/root/resultados/por_<x> /datos/por_<x>.csv` |
| Resultados | MySQL | MapReduce | `sqoop export --table resumen_<x> --export-dir /user/root/resultados/por_<x>` |

**En la industria.** Los orquestadores (**Apache Airflow**, **Dagster**,
**Prefect**, **Oozie** en Hadoop) y las vistas de *data lineage*. Teoría:
[pipelines de datos](teoria/pipelines.md).

## Machine Learning

Guía: [7. Machine Learning](07-machine-learning.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Dataset y columnas | `clientes_senal.csv` y lo que dejó el pipeline | `GET /api/ml/datasets` | `hdfs dfs -ls /user/root/ml` |
| Qué modelo conviene | Recomendación con tiempo y memoria esperados | `POST /api/ml/recommend` → reglas fijas con lo medido en la imagen | — |
| Entrenar | Avance, métricas, referencia | `POST /api/ml/train` → `python3 server/sandbox_server/jobs/entrenar_sklearn.py` o `spark-submit …/jobs/entrenar_spark.py` + SSE `model` | `python3 ejemplos/ml/modelos_sklearn.py`, `spark-submit ejemplos/ml/modelos_spark.py` |
| Modelos | Los entrenamientos de la sesión | `GET /api/ml/models` | — |
| El modelo por dentro | Árbol, red, KMeans, recta, en 3D y paso a paso | `GET /api/ml/models/{id}/viz` → lo que escribió `jobs/viz.py` al entrenar | — |

Entrenar necesita `SERVICIOS=todo` ("Machine Learning necesita los servicios
completos (Spark y Python)"); con MLlib, además el ResourceManager y HDFS. Se
entrena un modelo por vez.

**En la industria.** El seguimiento de experimentos de **MLflow**, los
*AutoML* de **SageMaker**, **Vertex AI** y **Azure ML**, y las
visualizaciones de **TensorBoard** y **SHAP**. Teoría:
[interpretabilidad](teoria/interpretabilidad.md).

## Prácticas

Guía: [8. Prácticas guiadas](08-practicas.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Lista | Las 9 prácticas con su estado y avance | Fija en la interfaz + el avance en `localStorage` (`bds.practicas.v1`) | — |
| Antes de empezar | Cada servicio que necesita, con su lámpara | `GET /api/status` | `estado` |
| Pregunta | 4 opciones, por qué sí y por qué no | Fija en la interfaz | — |
| Ejecutar | Salida, código de salida, trace, *Dónde quedó* | No tiene ruta propia: usa las mismas que las pantallas (`/api/hdfs/mkdir`, `/api/hdfs/upload`, `/api/data/query`, `/api/yarn/apps`, `/api/processes/:id/stop`...) | El comando del paso |
| Verificar | Si dio lo esperado | Lecturas: `/api/hdfs/ls`, `/api/hdfs/fsck`, `/api/yarn/apps/:id`, `/api/status`... | El comando de verificación del paso |

**En la industria.** Los labs con validación automática de **Databricks
Academy**, **Google Cloud Skills Boost** y **AWS Skill Builder**, y los
*runbooks* de operación.

## Configuración

Guía: [9. Configuración y docker-compose.yml](09-configuracion-y-compose.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| HDFS | `DATANODES`, `REPLICATION`, `BLOCK_SIZE`, `NAMENODES` | La configuración guardada en el volumen | `docker run -e DATANODES=3 -e REPLICATION=2 …` |
| Servicios | `SERVICIOS`, `MONGODB`, `JUPYTER`, `PIG_HEAPSIZE` | Ídem | `docker run -e SERVICIOS=todo …` |
| Errores y avisos | Lo que está mal en cada campo | `POST /api/config/validate` → las mismas reglas que `sandbox/lib.sh` | — |
| Memoria | GB estimados sobre 7,7, el cartel y **Ver de dónde sale** | `POST /api/config/estimate` → suma fija por parte | `docker stats bigdata-full` (lo que usa de verdad) |
| Barra de cambios | Antes → después; Guardar, Guardar e iniciar, Aplicar y reiniciar | `PUT /api/config`, `POST /api/cluster/start`, `POST /api/cluster/apply` | `docker compose up -d` con el archivo nuevo |
| docker-compose.yml | El archivo para levantar lo mismo sin la interfaz | `POST /api/config/compose` (devuelve `text/yaml`) | `docker compose up -d` |
| Empezar de cero | Borra el volumen | `POST /api/cluster/reset` | `docker compose down -v` |

La memoria estimada suma, en MB: HDFS y sistema 4096; 256 por cada DataNode
más allá del primero; YARN, MapReduce y MySQL 1024 (si no es `hdfs`); Hive y
Spark 1024 (con `todo`); alta disponibilidad 2048 con 2 NameNodes o 2560 con
3; MongoDB 512; JupyterLab 384; la interfaz 128. El límite es 7884 MB.

**En la industria.** Infraestructura como código (**docker compose**,
**Helm**, **Terraform**) y las pantallas de configuración de **Cloudera
Manager** y **Ambari**, que también marcan qué servicios necesitan reinicio.

## Consola

Guía: [10. Consola](10-consola.md).

| Parte | Qué muestra | De dónde sale | Comando equivalente |
|---|---|---|---|
| Eventos | Hora, gravedad, origen, título | `GET /api/activity?limit=200` + SSE `activity`; el servidor guarda los últimos 1000 en memoria | `docker logs bigdata-full` |
| Filtros | Gravedad (Todo, Problemas, Errores, Listos), Origen, buscador | En la interfaz, sobre la lista | `docker logs bigdata-full \| grep WARN` |
| Detalle | Comando, Entra, Hace, Sale, Log | El `ActionTrace` de cada evento; las acciones largas, `GET /api/actions/:id` | El comando que muestra |

**En la industria.** Logs centralizados (**ELK**, **Grafana Loki**,
**Splunk**, **Datadog**) y logs de auditoría (el *audit log* del NameNode,
**Apache Ranger**). Teoría: [observabilidad](teoria/observabilidad.md).

## La API en una página

Todas las rutas cuelgan de `/api`, hablan JSON y las acciones largas
contestan **202** y avisan el avance por SSE. Los errores traen
`{ "error": "…", "code": "…" }` con estos códigos: `cluster_stopped` (409),
`service_down` (503), `not_found` (404), `invalid` (400), `busy` (409),
`unsupported` (501) y `failed` (500).

| Grupo | Rutas |
|---|---|
| Estado | `GET /api/status`, `GET /api/activity`, `GET /api/events` (SSE), `GET /api/actions/:id` |
| Configuración y ciclo de vida | `POST /api/config/validate`, `POST /api/config/estimate`, `POST /api/config/compose`, `PUT /api/config`, `POST /api/cluster/start`, `POST /api/cluster/stop`, `POST /api/cluster/apply`, `POST /api/cluster/reset`, `POST /api/processes/:id/start` y `/stop` |
| HDFS | `GET /api/hdfs/datanodes`, `POST /api/hdfs/datanodes`, `GET /api/hdfs/files`, `PATCH /api/hdfs/files`, `DELETE /api/hdfs/files`, `POST /api/hdfs/put`, `GET /api/hdfs/ls`, `GET /api/hdfs/file`, `GET /api/hdfs/cat`, `GET /api/hdfs/download`, `POST /api/hdfs/upload`, `POST /api/hdfs/mkdir`, `POST /api/hdfs/move`, `GET /api/hdfs/fsck`, `GET /api/hdfs/replication` |
| YARN | `GET /api/yarn/apps`, `POST /api/yarn/apps`, `GET /api/yarn/apps/:id`, `GET /api/yarn/apps/:id/logs`, `POST /api/yarn/apps/:id/kill`, `GET /api/yarn/cluster`, `GET /api/yarn/templates` |
| Pipeline | `GET /api/pipeline`, `GET /api/pipeline/catalog`, `GET /api/pipeline/steps`, `POST /api/pipeline/steps`, `POST /api/pipeline/reset` |
| Consultas | `GET /api/data/catalog`, `GET /api/data/schema`, `GET /api/data/examples`, `POST /api/data/query`, `POST /api/data/explain` |
| Machine Learning | `GET /api/ml/datasets`, `POST /api/ml/recommend`, `POST /api/ml/train`, `GET /api/ml/models`, `GET /api/ml/models/{id}/viz` |

Eventos SSE: `status`, `activity`, `transfer`, `yarn`, `hdfs`, `step`,
`model` y `action`. El detalle de cada ruta (cuerpo, respuesta y comando
real) está en [`ui/API.md`](../../ui/API.md).
