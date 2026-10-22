# 2. Arrancar y apagar el cluster

Crear el cluster (una vez), prenderlo y apagarlo (cada clase), entrar a la
consola de adentro y cambiar su arquitectura.

[← 1. Instalación](01-instalacion.md) · [Índice](README.md) · Siguiente: [3. HDFS →](03-hdfs.md)

## Dos terminales: tu compu y adentro

Todo lo que empieza con `docker` va en la terminal de **tu compu**. El resto
(`hdfs`, `pig`, `beeline`, `mysql`, `mongosh`, `estado`...) va **adentro** del
contenedor, después de `docker exec -it bigdata bash`. En cada bloque de estas
guías dice dónde va.

| Cuándo | Comando (en tu compu) |
|---|---|
| **Una sola vez** | el `docker run` de abajo |
| **Cada clase**, al empezar | `docker start bigdata` y esperar el cartel *Cluster LISTO* |
| Para entrar (todas las veces que quieras, varias terminales a la vez) | `docker exec -it bigdata bash` |
| **Cada clase**, al terminar | `exit` y `docker stop bigdata` |

## Crear el cluster (una sola vez)

**1. Una carpeta de trabajo.** Creá una carpeta vacía donde quieras y abrí una
terminal parada ahí. En Windows: por ejemplo `C:\bigdata`; en el Explorador,
clic en la barra de dirección, escribir `cmd` y Enter abre una consola ahí.

<!-- prueba: compu -->
```bash
mkdir bigdata
cd bigdata
```

**2. El `docker run`.** Elegí el de **tu** consola. Arma un cluster con 3
DataNodes, cada bloque guardado 2 veces, bloques de 1 MB (para ver muchos con
archivos chicos) y MongoDB prendido.

Mac / Linux:

<!-- prueba: compu -->
```bash
docker run -d --name bigdata --stop-timeout 20 \
  -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si \
  -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 \
  -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 \
  -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 \
  -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 \
  -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 \
  -v bigdata_hadoop:/hadoop -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox
```

Windows, PowerShell (una sola línea):

<!-- prueba: no (PowerShell; es el mismo comando que el de Mac/Linux) -->
```powershell
docker run -d --name bigdata --stop-timeout 20 -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 -v bigdata_hadoop:/hadoop -v "${PWD}/datos:/datos" franki678/bigdata-sandbox
```

Windows, CMD (la que muestra `C:\...>`, una sola línea):

<!-- prueba: no (CMD de Windows; es el mismo comando que el de Mac/Linux) -->
```bat
docker run -d --name bigdata --stop-timeout 20 -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 -v bigdata_hadoop:/hadoop -v "%cd%\datos:/datos" franki678/bigdata-sandbox
```

La única diferencia es cómo se escribe "la carpeta actual": `$(pwd)`,
`${PWD}` o `%cd%`. Si usás el de otra consola, Docker dice `invalid characters
for a local volume name`.

Qué es cada parte:

| Parte | Qué hace |
|---|---|
| `-d` | Corre en segundo plano: te devuelve la consola |
| `--name bigdata` | El nombre del contenedor: con ese lo prendés, apagás y entrás |
| `--stop-timeout 20` | Le da 20 s para apagarse en orden (MySQL, MongoDB, HDFS). Sin esto, algunos Docker Desktop cortan todo a los 3 s |
| `-e DATANODES=3` ... | La arquitectura del cluster (tabla de abajo) |
| `-p 127.0.0.1:9870:9870` ... | Cada página web (y MySQL y MongoDB) en tu compu: `localhost:9870`, etc. El `127.0.0.1` hace que solo se vean desde **tu** compu y no desde la red del aula |
| `-v bigdata_hadoop:/hadoop` | El **volumen**: el disco del cluster. HDFS, Hive, MySQL y MongoDB viven ahí y sobreviven a apagar y a borrar el contenedor |
| `-v "$(pwd)/datos:/datos"` | Tu carpeta `datos/` aparece adentro como `/datos`: así se pasan archivos |
| `franki678/bigdata-sandbox` | La imagen |

Los parámetros (`-e`), todos opcionales:

| Parámetro | Qué elige | Por defecto | Valores |
|---|---|---|---|
| `DATANODES` | Cuántos DataNodes (los que guardan los bloques) | 1 | 1 a 9 |
| `REPLICATION` | Cuántas copias de cada bloque, cada una en un DataNode distinto | 1 | 1 a 9 |
| `BLOCK_SIZE` | Tamaño de bloque: los archivos se parten en pedazos de este tamaño | 128m | `1m`, `32m`, `128m`, `1g`... (mínimo `1m`) |
| `NAMENODES` | Cuántos NameNodes: con 2 o 3 hay **alta disponibilidad** ([guía 9](09-zookeeper-ha.md)). Queda fijo al crear el volumen | 1 | 1 a 3 |
| `SERVICIOS` | Qué se prende además de HDFS: `hdfs` (solo HDFS, 4 GB de RAM), `mapreduce` (+ YARN, Pig, Sqoop y MySQL, 5 GB), `todo` (+ Hive y Spark, 6 GB) | todo | `hdfs`, `mapreduce`, `todo` |
| `MONGODB` | Prender MongoDB con la base de ejemplo `tienda` (+1 GB de RAM) | no | `si`, `no` |

Si un valor está mal escrito, el contenedor se apaga y `docker logs bigdata`
dice cuál (`[sandbox] ERROR: ...`).

**3. Esperar el cartel "Cluster LISTO".** La primera vez tarda 2-3 min
(formatea HDFS, carga las bases de ejemplo); después, 1-2 min. Para mirarlo:

<!-- prueba: no (sigue el log hasta Ctrl+C; la prueba espera el cartel sola) -->
```bash
docker logs -f bigdata
```

Cuando aparece **Cluster LISTO**, abajo se ve cada proceso con su estado y su
página web. `Ctrl+C` sale del log; el cluster sigue prendido.

<!-- prueba: esperar listo -->

**4. Mirar el estado.** El comando `estado` (de adentro) lista cada proceso,
si está arriba y su página web. Se puede correr desde tu compu sin entrar:

<!-- prueba: compu | espera: NameNode -->
```bash
docker exec bigdata estado
```

## Entrar al cluster

<!-- prueba: no (abre una consola interactiva) -->
```bash
docker exec -it bigdata bash
```

El prompt cambia a `root@...:/datos#`: estás **adentro**, parado en `/datos`
(tu carpeta `datos/`). Ahí están los ejemplos:

<!-- prueba: adentro | espera: ventas.csv | espera: tienda_mongo.js -->
```bash
ls ejemplos
estado
jps
```

`jps` lista los procesos Java: uno por nodo (`NameNode (nn1)`, `DataNode
(dn2)`...). Para volver a tu compu: `exit` (el cluster sigue prendido). Podés
abrir varias terminales adentro a la vez, con el mismo `docker exec`.

## Las páginas web

Con el cluster prendido, en el navegador de tu compu:

| Componente | Dirección | Qué mirar |
|---|---|---|
| NameNode (HDFS) | http://localhost:9870 | *Datanodes*: los nodos vivos. *Utilities → Browse the file system*: cada archivo, su replicación y en qué DataNodes está cada bloque |
| Secondary NameNode | http://localhost:9868 | El último *checkpoint* de los metadatos |
| DataNode N | http://localhost:9901 ... 9909 | DataNode 1 → 9901, DataNode 2 → 9902... |
| YARN | http://localhost:8088 | Todos los trabajos: MapReduce, Pig, Hive (TEZ), Spark, Sqoop |
| NodeManager | http://localhost:8042 | Los contenedores de YARN corriendo |
| JobHistory | http://localhost:19888 | Trabajos MapReduce terminados y sus logs |
| HiveServer2 | http://localhost:10002 | Sesiones y consultas de Hive |
| Spark History | http://localhost:18080 | Trabajos de Spark terminados |
| Spark activo | http://localhost:4040 | Solo mientras corre un trabajo de Spark |
| MySQL | `localhost:3306` | No es web: para DBeaver o Workbench (usuario `alumno`, clave `alumno`, base `tienda`) |
| MongoDB | `localhost:27017` | No es web: para MongoDB Compass ([guía 10](10-mongodb.md#desde-tu-compu-compass)) |

## Apagar y volver a prender

Al terminar la clase, desde tu compu:

<!-- prueba: compu -->
```bash
docker stop bigdata
```

Tarda hasta 20 s: apaga cada servicio en orden. Los datos quedan en el
volumen. La clase siguiente:

<!-- prueba: compu -->
```bash
docker start bigdata
```

<!-- prueba: esperar listo -->

y esperar otra vez el cartel *Cluster LISTO* (`docker logs -f bigdata`).
**No** repitas el `docker run`: crearía otro contenedor y falla con
`the container name "/bigdata" is already in use`.

Al prender, HDFS se queda unos segundos en *safe mode* revisando los bloques:
es normal, el arranque espera solo.

## Cambiar los parámetros

Para tener otra arquitectura (más DataNodes, otra replicación, otro tamaño de
bloque, otros servicios) se borra el **contenedor** y se crea de nuevo con
otros `-e`. El **volumen** no se borra: HDFS, las tablas de Hive y las bases
MySQL y MongoDB siguen ahí. Por ejemplo, de 3 a 4 DataNodes:

<!-- prueba: compu -->
```bash
docker rm -f bigdata
docker run -d --name bigdata --stop-timeout 20 \
  -e DATANODES=4 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si \
  -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 \
  -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 \
  -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 \
  -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 \
  -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 \
  -v bigdata_hadoop:/hadoop -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox
```

<!-- prueba: esperar listo -->

<!-- prueba: compu | espera: dn4 -->
```bash
docker exec bigdata datanode
```

- `DATANODES`, `REPLICATION`, `BLOCK_SIZE`, `SERVICIOS` y `MONGODB` se
  cambian cuando quieras. La replicación y el bloque nuevos valen para lo que
  subas desde ese momento (a lo ya subido se le cambia la replicación con
  `hdfs dfs -setrep`, [guía 3](03-hdfs.md#cambiar-la-replicación)).
- `NAMENODES` no: queda fijo cuando se crea el volumen. Para probar alta
  disponibilidad se usa otro volumen ([guía 9](09-zookeeper-ha.md)).
- Lo mismo para pasar a una imagen nueva: `docker pull` (o el archivo del
  aula), `docker rm -f bigdata` y el mismo `docker run`.

## Con docker compose (opcional)

En el repo hay un [`docker-compose.yml`](../docker-compose.yml) con el mismo
cluster. Si lo bajás a tu carpeta de trabajo:

<!-- prueba: no (necesita el archivo del repo; es el mismo cluster que el docker run de arriba) -->
```bash
docker compose up -d      # crear y prender
docker compose stop       # apagar
docker compose start      # prender
docker compose down       # borrar el contenedor (el volumen queda)
```

Los parámetros se cambian editando el archivo y con otro `docker compose
up -d`. Usa el mismo contenedor (`bigdata`) y el mismo volumen
(`bigdata_hadoop`) que el `docker run`: o uno o el otro. Para pasar de uno al
otro, antes `docker rm -f bigdata` (los datos quedan).
