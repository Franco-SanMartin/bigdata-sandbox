# Fixtures

Salidas de Hadoop 3.3.6, Spark 3.5 y Hive 3.1 que usan los tests. Las que
dicen **sintética** están armadas a mano copiando el formato exacto que
devuelve cada servicio (mismos campos, mismos nombres y la misma forma de
las líneas), con números inventados: los tests no levantan un cluster.

| Archivo | De dónde sale | Tipo |
|---|---|---|
| `fsck.txt` | `hdfs fsck / -files -blocks -locations` | sintética |
| `fsck_escribiendo.txt` | `hdfs fsck / -files -blocks -locations -openforwrite` con un `-put` a medias | sintética |
| `dfsadmin_report.txt` | `hdfs dfsadmin -report` | sintética |
| `jps.txt` | `jps -l` | sintética |
| `nn_jmx*.json`, `nn_status_*.json` | `:9870/jmx?qry=Hadoop:service=NameNode,name=*` | sintética |
| `webhdfs_*.json` | `:9870/webhdfs/v1/<ruta>?op=LISTSTATUS`, `GETFILESTATUS`, `GETCONTENTSUMMARY` y un 404 | sintética |
| `rm_metrics.json`, `rm_apps.json`, `rm_app_*.json`, `rm_nodes.json`, `rm_scheduler.json` | `:8088/ws/v1/cluster/...` | sintética |
| `rm_conf.json` | `:8088/conf?format=json` (recortado a las claves que se usan) | sintética |
| `nm_containers.json` | `:8042/ws/v1/node/containers` | sintética |
| `jhs_tasks.json`, `jhs_counters.json` | `:19888/ws/v1/history/mapreduce/jobs/<job>/tasks` y `/counters` | sintética |
| `shs_stages.json`, `shs_jobs.json` | `:18080/api/v1/applications/<app>/stages` y `/jobs` | sintética |
| `yarn_logs.txt`, `yarn_logs_info.txt` | `yarn logs -applicationId ... -containerId ...` y `-show_application_log_info` | sintética |
| `beeline_tez.txt` | `beeline -f ventas.hql` (las líneas de avance de Tez) | sintética |
| `ui_cluster.json` | lo que calcula la interfaz (`ui/src/lib/cluster.ts`) para comparar | generada con la interfaz |
| `proc/` | un `/proc` de mentira para `scan_proc` | sintética |
| `entrypoint_falso.sh` | reemplazo del entrypoint para los tests de arranque | — |

Cuando haya una corrida contra la imagen (`tests/humo`, `SANDBOX_HUMO=1`),
conviene reemplazar las sintéticas por salidas reales y ver que los tests
sigan pasando.
