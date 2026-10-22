# BigData Sandbox

Un cluster de Big Data entero en **una imagen de Docker**: Hadoop (HDFS, YARN,
MapReduce), Hive, Spark, Pig, Sqoop con MySQL, ZooKeeper y MongoDB. Cada
componente corre como un proceso aparte, con su propia página web, y la
arquitectura de HDFS **la elegís vos** al crear el contenedor: cuántos
DataNodes y NameNodes, cuántas réplicas, de qué tamaño los bloques. Nada de
caja negra: es el Hadoop de verdad, en tu compu.

- **[Guías paso a paso](guias/README.md)**: de instalar Docker a MongoDB.
- **[Mapa de la arquitectura](https://franki-678.github.io/bigdata-sandbox/)**:
  cada módulo del cluster, qué hace, cómo se conecta con los demás y sus
  comandos (también está en el repo: `docs/index.html`).

## Arranque rápido

Con Docker instalado y 7 GB de RAM para Docker
([guía 1](guias/01-instalacion.md)), en una terminal parada en una carpeta
vacía (Mac/Linux; para PowerShell y CMD, ver la
[guía 2](guias/02-arrancar-y-apagar.md)):

```bash
docker pull franki678/bigdata-sandbox
docker run -d --name bigdata --stop-timeout 20 \
  -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si \
  -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 \
  -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 \
  -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 \
  -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 \
  -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 \
  -v bigdata_hadoop:/hadoop -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox
docker logs -f bigdata
```

Cuando diga *Cluster LISTO* (~1-2 minutos), `Ctrl+C` y a trabajar:

```bash
docker exec -it bigdata bash
```

Adentro: `estado` muestra cada servicio y sus páginas web (HDFS en
http://localhost:9870, YARN en http://localhost:8088). Para apagar, desde tu
compu, `docker stop bigdata`; para volver, `docker start bigdata`. Los datos
quedan en el volumen `bigdata_hadoop`.

## Versiones de la imagen

La versión se elige con el *tag*, lo que va después de los dos puntos:
`franki678/bigdata-sandbox:ml`. Sin tag se usa `latest`.

| Tag | Estado | Qué trae |
|---|---|---|
| `latest` = `base` | **Publicada. La de la materia** | Ubuntu 24.04 + Hadoop, Hive, Spark, Pig, Sqoop, MySQL, ZooKeeper y MongoDB. Es la de las guías |
| `ml` | Publicada | `base` + Python para datos (pandas, numpy, scikit-learn, matplotlib, pymongo) y JupyterLab, para ETL y machine learning |
| `full` | En preparación, no publicada | `ml` + una interfaz web para manejar y mirar el cluster desde el navegador |
| `empresa` | En desarrollo | Un cluster repartido entre varias compus por red, con seguridad, ingesta en tiempo real y métricas |

- Las guías y el mapa son de `base`. Con `ml` valen igual (es `base` con
  agregados); `full` y `empresa` van a tener su propia documentación cuando se
  publiquen.
- Las dos publicadas sirven para Intel/AMD (amd64) y ARM (Mac M1–M4): Docker
  baja sola la que corresponde.
- Hasta octubre de 2026, `latest` era una imagen anterior sobre Ubuntu 20.04,
  sin MongoDB. Si la tenés, ver
  [Venís de la imagen anterior](guias/11-problemas.md#venís-de-la-imagen-anterior).

### Qué hay en `base`

| Componente | Versión | Para qué |
|---|---|---|
| **HDFS**: NameNode(s), Secondary NameNode, 1 a 9 DataNodes | Hadoop 3.3.6 | Sistema de archivos distribuido |
| **YARN** + **MapReduce** + JobHistory | Hadoop 3.3.6 | Reparte CPU y memoria entre los trabajos; el modelo map/reduce, en Java o en Python con Streaming |
| **Pig** | 0.18.0 | Pig Latin: procesar datos paso a paso, se traduce a MapReduce |
| **Hive** (Metastore + HiveServer2, sobre Tez) | 4.0.0 (Tez 0.10.3) | SQL sobre archivos de HDFS |
| **Spark** + PySpark + History Server | 3.5.9 | Procesamiento en memoria, sobre YARN; comparte las tablas con Hive |
| **Sqoop** + **MySQL** (MariaDB) con la base `tienda` | 1.4.7 / MariaDB 10.11 | Copiar tablas entre una base relacional y HDFS |
| **ZooKeeper** + JournalNodes + ZKFC | 3.8.7 | Alta disponibilidad del NameNode (con `NAMENODES=2` o `3`) |
| **MongoDB** + `mongosh` con la base `tienda` | 8.0 | Base NoSQL de documentos (se prende con `MONGODB=si`) |

Además: Java 8 y Python 3.12. Hive y Spark comparten el metastore: una tabla
creada en uno se ve en el otro.

## Requisitos

Medidos por GitHub en cada versión nueva de la imagen (Intel/AMD y ARM):

| | `base` | `base` + MongoDB | `ml` |
|---|---:|---:|---:|
| **RAM para Docker** (lo que hay que darle) | 6 GB | **7 GB** | 7 GB |
| RAM en uso, en reposo | 2,0 GB | 2,1 GB | 2,2 GB |
| RAM en uso, pico con trabajos | 5,8 GB | 5,8 GB | 6,0 GB |
| Descarga (`docker pull` o archivo del aula) | 1,36 GB | 1,36 GB | 1,58 GB |
| Disco, Linux | 2,23 GB | 2,23 GB | 2,93 GB |
| Disco, Docker Desktop (Windows/Mac) | ~3,6 GB | ~3,6 GB | ~4,5 GB |

- Con alta disponibilidad (`NAMENODES=2` o `3`): 8 GB de RAM. Solo HDFS
  (`SERVICIOS=hdfs`): 4 GB; HDFS + YARN (`SERVICIOS=mapreduce`): 5 GB.
- Docker Desktop guarda la imagen comprimida y descomprimida: por eso ocupa
  más que en Linux.
- MongoDB necesita un procesador Intel/AMD con **AVX** (casi todos desde
  2011) o un ARM moderno. Sin AVX anda todo menos MongoDB.
- En Windows, cuánta RAM le toca a Docker se fija en `.wslconfig`
  ([guía 1](guias/01-instalacion.md#windows)).

## Las guías

| # | Guía |
|---|---|
| 1 | [Instalación: Docker y la imagen](guias/01-instalacion.md) (Windows, Mac, Linux; Docker Hub o el archivo del aula) |
| 2 | [Arrancar y apagar el cluster](guias/02-arrancar-y-apagar.md) (y todos los parámetros) |
| 3 | [HDFS](guias/03-hdfs.md) |
| 4 | [YARN y MapReduce](guias/04-yarn-mapreduce.md) |
| 5 | [Pig](guias/05-pig.md) |
| 6 | [Hive](guias/06-hive.md) |
| 7 | [MySQL y Sqoop](guias/07-mysql-sqoop.md) |
| 8 | [Spark](guias/08-spark.md) |
| 9 | [ZooKeeper y alta disponibilidad](guias/09-zookeeper-ha.md) |
| 10 | [MongoDB](guias/10-mongodb.md) |
| 11 | [Problemas, venir de la imagen anterior y empezar de cero](guias/11-problemas.md) |

Los ejemplos (`ventas.csv`, `texto.txt`, los scripts de Pig, Hive, Spark,
Sqoop y MongoDB) vienen adentro de la imagen, en `/datos/ejemplos`: no hace
falta clonar este repo.

## Este repo

| Archivo | Qué es |
|---|---|
| `Dockerfile` | Cómo se arma la imagen, desde los binarios oficiales de Apache y de MongoDB |
| `entrypoint.sh`, `sandbox/` | El arranque: genera la configuración según los parámetros y prende cada proceso. `sandbox/bin/` tiene los comandos `estado`, `datanode`, `namenode` y `jps` |
| `conf/` | Configuración fija (Hive, Spark, MySQL, MongoDB) |
| `datos/ejemplos/` | Los ejemplos que van adentro de la imagen |
| `docker-compose.yml` | El mismo cluster de la guía 2, con `docker compose up -d` |
| `guias/` | Las guías |
| `docs/` | El mapa de la arquitectura (GitHub Pages) |
| `pruebas/` | Lo que corre GitHub antes de publicar |

## Cómo se prueba

Cada cambio pasa por GitHub Actions antes de llegar a Docker Hub:

- **`imagen.yml`** arma la imagen para amd64 y ARM, prende el cluster y
  corre `pruebas/probar.sh` (MapReduce, Pig, Hive, Spark y Sqoop tienen que
  dar los números esperados), `pruebas/probar_mongodb.sh` y los escenarios de
  `pruebas/escenarios.sh`: reinicios, alta disponibilidad, caídas, cortes de
  luz y volúmenes de la imagen anterior. También corre **todos los comandos
  de las guías** (`pruebas/tutoriales.py`) y compara la salida con la que
  muestran. Si algo falla, no se publica.
- **`docs.yml`**: cuando cambian solo las guías o el mapa, revisa los links y
  vuelve a correr las guías contra la imagen publicada.
- **`aula.yml`** deja la imagen como archivo en el release
  [`imagen`](https://github.com/Franki-678/bigdata-sandbox/releases/tag/imagen),
  para repartirla en el aula sin que cada compu la baje de internet.

## Notas

- Es un sandbox para aprender: corre como root, sin permisos en HDFS ni
  seguridad. No es para datos reales.
- Todos los nodos son procesos en la misma máquina y comparten el disco. La
  mecánica de bloques, réplicas, caídas y failover es la real de Hadoop; si
  se apaga la compu, se apaga todo junto.
- Para que entre en una notebook, cada proceso tiene un tope de memoria chico
  (`sandbox/lib.sh`), MySQL y MongoDB usan poca caché (`conf/`) y la imagen
  no trae lo que el cluster no usa.
