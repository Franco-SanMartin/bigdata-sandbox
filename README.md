# BigData Sandbox

**Castellano** · [English](README.en.md)

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
- **[Demo de la interfaz `full`](https://franki-678.github.io/bigdata-sandbox/demo/)**:
  la interfaz web en el navegador, con un cluster simulado (sin Docker).

![La interfaz de la versión full: el cluster en marcha con su arquitectura en vivo](docs/capturas/cluster.png)

## Arranque rápido

Con Docker instalado y 7 GB de RAM para Docker
([guía 1](guias/01-instalacion.md)), en una terminal parada en una carpeta
vacía (Mac/Linux; para PowerShell y CMD, ver la
[guía 2](guias/02-arrancar-y-apagar.md)):

```bash
docker pull franki678/bigdata-sandbox:base
docker run -d --name bigdata --stop-timeout 20 \
  -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si \
  -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 \
  -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 \
  -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 \
  -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 \
  -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 \
  -v bigdata_hadoop:/hadoop -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox:base
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
| `full` | Publicada | `ml` + una interfaz web en el puerto 8080 para prender, configurar y mirar el cluster desde el navegador ([abajo](#la-versión-full)) |
| `empresa` | En desarrollo | Un cluster repartido entre varias compus por red, con seguridad, ingesta en tiempo real y métricas |

- Las guías y el mapa son de `base`. Con `ml` y `full` valen igual (son `base`
  con agregados); `empresa` va a tener su propia documentación cuando se
  publique.
- Las publicadas sirven para Intel/AMD (amd64) y ARM (Mac M1–M4): Docker baja
  sola la que corresponde.
- Hasta octubre de 2026, `latest` era una imagen anterior sobre Ubuntu 20.04,
  sin MongoDB. Si la tenés, ver
  [Venís de la imagen anterior](guias/11-problemas.md#venís-de-la-imagen-anterior).

### La versión `full`

```bash
docker run -d --name bigdata-full --stop-timeout 20 \
  -p 127.0.0.1:8080:8080 -v bigdata_full:/hadoop -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox:full
```

Abrís http://localhost:8080. Como en `base`, la carpeta `datos/` de tu compu
aparece adentro como `/datos` (en PowerShell, `"${PWD}/datos:/datos"`; en CMD,
`"%cd%\datos:/datos"`): al iniciar el cluster se copian ahí los ejemplos
(`/datos/ejemplos`), las Prácticas suben desde ahí a HDFS y lo que bajás con
`hdfs dfs -get` aparece en tu carpeta. Sin ese `-v` todo funciona igual, pero
los archivos quedan solo adentro del contenedor. El contenedor arranca solo la interfaz: el
cluster se elige y se prende desde ahí (*Iniciar*). Con `-e AUTOSTART=1`
arranca solo, con las variables de siempre (`DATANODES`, `REPLICATION`,
`SERVICIOS`...). Para entrar a las páginas web de cada servicio, agregá sus
puertos como en el [arranque rápido](#arranque-rápido). Detalle del servidor y
su API en [server/README.md](server/README.md). Para mirarla sin instalar nada,
está la [demo](https://franki-678.github.io/bigdata-sandbox/demo/) (un cluster
simulado en el navegador).

La interfaz arranca en **Inicio**: el estado del cluster y qué podés hacer
ahora, con lo que todavía no está disponible, por qué y cómo habilitarlo. Cada
pantalla (HDFS, Trabajos, Consultas, Pipeline, Machine Learning, Cluster)
dice, con el cluster apagado o arrancando, qué vas a poder hacer y cuánto
falta; los botones deshabilitados dicen por qué. En **Prácticas** están las
guías 03 a 10 paso a paso, chequeadas contra el cluster.

| | |
|---|---|
| ![Inicio: el estado del cluster y qué podés hacer ahora, con lo que falta y cómo activarlo](docs/capturas/inicio.png) | ![Trabajos: un wordcount terminado y las plantillas de MapReduce, Tez y Spark](docs/capturas/yarn.png) |
| **Inicio**: qué podés hacer ahora y qué no, con el motivo y el arreglo | **Trabajos**: plantillas con parámetros, avance, contenedores y logs |
| ![Pipeline: la ingesta hecha y la etapa de ETL con sus herramientas](docs/capturas/pipeline.png) | ![Machine Learning: un árbol de decisión entrenado con scikit-learn y su detalle](docs/capturas/ml.png) |
| **Pipeline**: de un CSV sucio a un resumen y un modelo, eligiendo la herramienta de cada etapa | **Machine Learning**: el mismo modelo con scikit-learn o con Spark MLlib, comparados |

#### Por dentro de cada modelo

Abajo del detalle de un modelo entrenado está **por dentro**: el modelo dibujado
en 3D con lo que de verdad aprendió (los pesos, los cortes, los centros) y la
cuenta de una fila hecha delante tuyo. Elegís una fila de prueba o movés las entradas con
deslizadores; arriba, reproducir, pausa, paso a paso y velocidad; la cámara se
gira con el mouse y, al pasar por encima, cada neurona dice su activación y
cada conexión su peso y cuánto aporta.

- **Red neuronal** (las dos, scikit-learn y MLlib): las capas son planos y las
  conexiones, más gruesas cuanto más pesan (petróleo si suman, tinta si
  restan). El dato entra, los pulsos avanzan capa por capa, se encienden las
  neuronas que se activan y a la derecha salen las probabilidades. En «cómo
  aprendió» la red se reacomoda época por época, con la curva de pérdida al lado.
- **Árbol**: la fila baja por el camino, pregunta por pregunta, hasta su hoja.
- **KMeans**: los puntos en 3D (con PCA si hay más de 3 columnas) y los centros
  moviéndose iteración por iteración hasta quedarse quietos.
- **Regresión lineal y logística**: la superficie que aprendió sobre dos
  columnas, con cada punto y su residuo.

La cuenta del navegador da exactamente lo que predijo el servidor (el humo lo
compara fila por fila, con tolerancia 1e-6). Con «reducir movimiento» del
sistema se avanza paso a paso; sin WebGL, dice por qué y la cuenta queda igual
al costado, en texto.

| | |
|---|---|
| ![Por dentro de una red neuronal: las capas, las conexiones según su peso y la salida con sus probabilidades](docs/capturas/ml-red.gif) | ![Por dentro de un árbol: la fila baja por el camino hasta la hoja](docs/capturas/ml-arbol.gif) |
| **Red neuronal**: la pasada de una fila, capa por capa | **Árbol**: el camino de la fila hasta la hoja |
| ![KMeans: los centros moviéndose iteración por iteración](docs/capturas/ml-kmeans.gif) | ![La red época por época, con la curva de pérdida](docs/capturas/ml-entrenamiento.png) |
| **KMeans**: cómo se acomodan los centros | **Cómo aprendió**: los pesos de cada época y la curva de pérdida |

Las capturas son de la [demo](https://franki-678.github.io/bigdata-sandbox/demo/);
el humo del CI (`server/tests/humo/humo_ui.py`) saca las mismas pantallas contra
la imagen de verdad.

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
| `docs/` | El mapa de la arquitectura (GitHub Pages), la demo de la interfaz (`docs/demo/`, se arma con `npm run build:demo` en `ui/`) y las capturas |
| `server/`, `ui/` | El servidor y la interfaz web de la versión `full` |
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
- **`full.yml`** arma `full` y le corre el humo de la API y de la interfaz
  (Playwright, pantalla por pantalla, también con el cluster apagado) contra
  Hadoop, YARN, Hive, MySQL y MongoDB reales. `server.yml` corre los tests del
  servidor.
- **`docs.yml`**: cuando cambian solo las guías o el mapa, revisa los links,
  que la demo de `docs/demo/` sea la de `ui/` y vuelve a correr las guías
  contra la imagen publicada.
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

## Licencia

[Apache 2.0](LICENSE). Los cambios de cada versión, en el
[CHANGELOG](CHANGELOG.md).
