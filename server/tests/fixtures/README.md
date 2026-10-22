# Fixtures

Salidas que usan los tests. Las **reales** las tomó el humo de la versión full
(`tests/humo/humo_full.py`, workflow `Full`) contra la imagen de verdad:
Hadoop 3.3.6, Spark 3.5, Hive 4.0.0 con Tez, MariaDB y MongoDB, en amd64.
Salen del artifact `humo-full-amd64` (carpeta `crudas/`, con el comando
exacto de cada una en `crudas/comandos.txt`) y se copian tal cual, sin
retocar. Las que dicen **sintética** siguen armadas a mano con el formato de
cada servicio; las **derivadas** se arman en el test a partir de una real
cuando el humo no pasó por ese estado.

| Archivo | De dónde sale | Tipo |
|---|---|---|
| `fsck.txt` | `hdfs fsck / -files -blocks -locations` | real |
| `fsck_escribiendo.txt` | lo mismo con `-openforwrite`, durante un `-put` de 300 MB | real |
| `fsck_dn_muerto.txt` | lo mismo, con dn2 apagado y ya dado por muerto | real |
| `dfsadmin_report.txt` | `hdfs dfsadmin -report` | real |
| `jps.txt` | `jps -l` | real |
| `nn_jmx.json` | `:9870/jmx?qry=Hadoop:service=NameNode,name=` `FSNamesystemState`, `FSNamesystem` y `NameNodeInfo` (los tres `beans` juntos en uno) | real |
| `nn_jmx_dn_muerto.json` | `NameNodeInfo` con dn2 muerto | real |
| `nn_status_active.json` | `name=NameNodeStatus` | real |
| `nn_status_standby.json`, `nn_jmx_safemode.json` | lo mismo en standby (HA) y en modo seguro | sintética |
| `webhdfs_*.json` | `:9870/webhdfs/v1/<ruta>?op=LISTSTATUS`, `GETFILESTATUS`, `GETCONTENTSUMMARY` y un 404 | real |
| `webhdfs_ls_humo_escribiendo.json` | `LISTSTATUS` de la carpeta durante el `-put` | derivada de `webhdfs_status_archivo.json` y del largo que dio el humo (22 MB); el próximo humo la captura cruda |
| `rm_metrics.json`, `rm_apps.json`, `rm_app_{mr,spark,tez}.json`, `rm_nodes.json`, `rm_scheduler.json` | `:8088/ws/v1/cluster/...` con las tres apps terminadas | real |
| `rm_conf.xml` | `:8088/conf?format=json`: el RM de 3.3.6 contesta XML igual | real |
| `nm_containers.json` | `:8042/ws/v1/node/containers` | real (vacío: sin apps corriendo) |
| `jhs_tasks.json`, `jhs_counters.json` | `:19888/ws/v1/history/mapreduce/jobs/<job>/tasks` y `/counters` | real |
| `shs_stages.json`, `shs_jobs.json` | `:18080/api/v1/applications/<app>/stages` y `/jobs` | real |
| `yarn_logs.txt`, `yarn_logs_info.txt` | `yarn logs -applicationId ... -containerId ...` y `-show_application_log_info` | real |
| `beeline_tez.txt` | `beeline -u jdbc:hive2://localhost:10000 --outputformat=tsv2 -e "SELECT producto, COUNT(*) ... GROUP BY producto"` (con el avance de Tez) | real |
| `error_{hive,mysql,mongodb}.txt` | una consulta a una tabla que no existe en cada motor | real |
| `ui_cluster.json` | lo que calcula la interfaz (`ui/src/lib/cluster.ts`) para comparar | generada con la interfaz |
| `proc/` | un `/proc` de mentira para `scan_proc` | sintética |
| `entrypoint_falso.sh` | reemplazo del entrypoint para los tests de arranque | — |

Derivadas en los tests (`test_yarn.py`, `conftest.py`): la app de Spark
corriendo, cancelada y en espera (de `rm_app_spark.json`), sus contenedores en
el NodeManager, las etapas del driver con una en marcha (de `shs_stages.json`)
y el fsck con un bloque perdido (de `fsck.txt`).

## Lo que cambió al pasar de sintéticas a reales

- `Connecting to namenode via ...` del fsck sale por stderr, no por stdout.
- El archivo que se está escribiendo aparece como `<nombre>._COPYING_ 0 bytes
  ... OPENFORWRITE:  OK`, con una línea `Under Construction Block:` y el bloque
  con `Expected_repl=` en vez de `Live_repl=`. WebHDFS, en cambio, ya cuenta
  los bloques completos (22 MB en el mismo momento).
- Apenas el NameNode da por muerto a un DataNode, el fsck lo sigue listando
  como ubicación (y en `Live_repl`) un rato, aunque JMX ya lo da muerto.
- `/conf?format=json` del ResourceManager devuelve XML.
- `yarn logs` deja una línea en blanco antes de `End of LogType:`.
- El trabajo de MapReduce (streaming) corre 2 maps y 1 reduce, y se llama
  `streamjob<n>.jar`. Spark History lista etapas `SKIPPED` (shuffles reusados)
  y, sin ellas, las etapas de cada job quedan sueltas: el DAG de Spark sale
  sin aristas.
- La app de Tez trae `diagnostics` aunque terminó bien (`Session stats:...`).
- Hive 4.0 con beeline no imprime `Map 1: 0(+3)/6  Reducer 2: 0/2` como Hive 3:
  dibuja una tabla con una fila por vértice (`Map 1 .......... container
  SUCCEEDED 1 1 0 0 0 0`), con códigos ANSI aunque la salida no sea una terminal.
- Si el ETL con pandas reescribe el Parquet después de crear la tabla con el de
  Spark, Hive no puede leerla (`ClassCastException: TimestampWritableV2 cannot be
  cast to DateWritableV2`): el ETL ahora vuelve a declarar la tabla si existe.
- `hdfs dfs -put` renombra el `._COPYING_` cuando el archivo ya está cerrado (con
  todos los bytes); el proceso tarda unos 2 s más en salir.

Pipeline, Datos y ML siguen con `tests/falsos.py`: CLIs falsas (`hdfs dfs`,
`beeline`, `mysql`, `mongosh`, `sqoop`, `spark-submit`, `spark-sql`) con su
estado en una carpeta. Los mensajes de error que imprimen copian los reales de
`error_*.txt` y el avance de Tez copia el formato de `beeline_tez.txt`.
