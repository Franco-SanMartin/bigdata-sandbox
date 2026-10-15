# BigData Sandbox — Hadoop + Pig + Hive + Spark + Sqoop en un solo contenedor

Una **sola imagen** y un **solo contenedor**, pero con un **cluster Hadoop real**
adentro: cada componente corre como proceso separado y tiene su propia página
web. Y la arquitectura de HDFS **la elegís vos** al crear el contenedor:
cuántos DataNodes, cuántos NameNodes, el factor de replicación y el tamaño de
bloque. Nada de caja negra.

| Qué incluye                       | Para qué                                        |
|-----------------------------------|-------------------------------------------------|
| **HDFS**: NameNode(s), Secondary NameNode, 1 a 9 DataNodes | Sistema de archivos distribuido |
| **HDFS HA** (opcional): ZooKeeper, 3 JournalNodes, ZKFC | Alta disponibilidad del NameNode |
| **YARN** (ResourceManager + NodeManager) | Reparte CPU/memoria entre los trabajos   |
| **MapReduce** + JobHistory        | El clásico wordcount y compañía (en Java o en Python con Hadoop Streaming) |
| **Pig**                           | Pig Latin: procesamiento paso a paso, se traduce a trabajos MapReduce |
| **Hive 4** (Metastore + HiveServer2, sobre Tez) | SQL sobre HDFS                    |
| **Spark 3.5** + PySpark + History Server | Procesamiento en memoria, corre sobre YARN |
| **Sqoop** + **MySQL** (MariaDB) con una base de ejemplo | Copiar tablas de una base relacional a HDFS y de vuelta |

Hive y Spark comparten el mismo metastore: una tabla creada en uno se ve en el
otro. Todos los datos viven en HDFS. Sqoop trae datos de afuera (de la base
MySQL `tienda`, que viene cargada) y devuelve resultados.

Versiones: Hadoop 3.3.6 · Pig 0.18.0 · Hive 4.0.0 · Tez 0.10.3 · Spark 3.5.9 ·
Sqoop 1.4.7 · MariaDB 10.3 (compatible MySQL) · ZooKeeper 3.8.7 · Java 8 ·
Python 3.8

**Cómo leer esta guía**

- **Sección 1** es el arranque rápido: de una compu sin nada a tener el cluster
  andando, en 8 pasos.
- **Sección 2** dice qué comando se usa **una sola vez** y cuál **cada vez**.
- **Sección 3** explica qué carpetas y archivos hay, en tu compu y adentro.
- El [**TUTORIAL**](TUTORIAL.md) sigue desde ahí: procesar un dataset de
  200.000 ventas con MapReduce, Pig, Hive y Spark, traer y llevar tablas de
  MySQL con Sqoop, con lo que tiene que salir en cada paso, y cómo hacer lo
  mismo con **tu propio CSV**.
- El resto del README es la referencia: todos los parámetros, todos los
  comandos, experimentos y problemas comunes.

## Índice

1. [Arranque rápido: de cero al cluster andando](#1-arranque-rápido-de-cero-al-cluster-andando)
2. [Qué comando, cuándo](#2-qué-comando-cuándo)
3. [Carpetas y archivos](#3-carpetas-y-archivos)
4. [Requisitos](#4-requisitos)
5. [Conseguir la imagen](#5-conseguir-la-imagen-una-sola-vez)
6. [Crear el contenedor y todos sus parámetros](#6-crear-el-contenedor-y-todos-sus-parámetros)
7. [Uso diario](#7-uso-diario)
8. [Ver la arquitectura](#8-ver-la-arquitectura)
9. [Experimentos de arquitectura](#9-experimentos-de-arquitectura)
10. [Ejemplos: MapReduce, Pig, Hive, Spark y Sqoop](#10-ejemplos-mapreduce-pig-hive-spark-y-sqoop)
11. [Referencia de comandos](#11-referencia-de-comandos)
12. [Empezar de cero](#12-empezar-de-cero)
13. [Problemas comunes](#13-problemas-comunes)
- [Notas](#notas)

---

## 1. Arranque rápido: de cero al cluster andando

No hace falta clonar este repo ni bajar ningún archivo: solo Docker y la
imagen. Los ejemplos vienen adentro de la imagen.

**Paso 1. Instalar Docker** (una sola vez)

Docker Desktop (Windows o Mac) desde https://www.docker.com/products/docker-desktop/,
o Docker Engine en Linux. Abrilo, y en *Settings → Resources → Memory* dale
**6 GB** o más. Comprobá que anda:

```bash
docker version
```

Tienen que aparecer *Client* y *Server*.

**Paso 2. Bajar la imagen de Docker Hub** (una sola vez; ~1,3 GB)

```bash
docker pull franki678/bigdata-sandbox
```

¿Toda un aula a la vez? Mejor que la baje una sola PC y la reparta (sección
5B).

**Paso 3. Crear una carpeta de trabajo y pararte en ella** (una sola vez)

Una carpeta nueva y vacía, donde quieras. Por ejemplo:

```bash
mkdir bigdata
cd bigdata
```

En Windows puede ser `C:\bigdata` (en el Explorador: clic en la barra de
dirección, escribir `cmd` y Enter abre una consola parada ahí).

**Paso 4. Crear el cluster** (una sola vez)

Elegí el comando de **tu** consola. Este arma 3 DataNodes, cada bloque
replicado 2 veces y bloques de 1 MB (los parámetros se explican en la
sección 6):

Mac / Linux:

```bash
docker run -d --name bigdata \
  -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m \
  -p 9870-9872:9870-9872 -p 9868:9868 -p 9901-9909:9901-9909 -p 8480-8482:8480-8482 \
  -p 8088:8088 -p 8042:8042 -p 19888:19888 \
  -p 10000:10000 -p 10002:10002 -p 18080:18080 -p 4040:4040 \
  -v bigdata_hadoop:/hadoop \
  -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox
```

Windows, PowerShell (una sola línea):

```powershell
docker run -d --name bigdata -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -p 9870-9872:9870-9872 -p 9868:9868 -p 9901-9909:9901-9909 -p 8480-8482:8480-8482 -p 8088:8088 -p 8042:8042 -p 19888:19888 -p 10000:10000 -p 10002:10002 -p 18080:18080 -p 4040:4040 -v bigdata_hadoop:/hadoop -v "${PWD}/datos:/datos" franki678/bigdata-sandbox
```

Windows, CMD (el que muestra `C:\...>`, una sola línea):

```bat
docker run -d --name bigdata -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -p 9870-9872:9870-9872 -p 9868:9868 -p 9901-9909:9901-9909 -p 8480-8482:8480-8482 -p 8088:8088 -p 8042:8042 -p 19888:19888 -p 10000:10000 -p 10002:10002 -p 18080:18080 -p 4040:4040 -v bigdata_hadoop:/hadoop -v "%cd%\datos:/datos" franki678/bigdata-sandbox
```

Docker crea solo la carpeta `datos/` adentro de tu carpeta de trabajo.

**Paso 5. Esperar el cartel "Cluster LISTO"** (~1-2 min)

```bash
docker logs -f bigdata
```

Cuando aparece **Cluster LISTO**, abajo se ve cada proceso con su estado y su
página web. `Ctrl+C` para salir del log (el cluster sigue prendido).

**Paso 6. Abrir las páginas web**

http://localhost:9870 (HDFS) y http://localhost:8088 (YARN, donde aparecen
todos los trabajos). Las demás, en la sección 8.

**Paso 7. Entrar al cluster y probar**

```bash
docker exec -it bigdata bash
```

El prompt cambia a `root@...:/datos#`: estás **adentro**. Probá:

```bash
estado                                  # todos los procesos y su web
ls ejemplos                             # los ejemplos
hdfs dfs -put -f ejemplos/texto.txt /user/root/
hdfs dfs -ls /user/root
pig -x local -param entrada=ejemplos/texto.txt ejemplos/wordcount.pig
exit                                    # volver a tu compu
```

De acá en adelante, el [TUTORIAL](TUTORIAL.md) (desde su paso 5) o la
sección 10.

**Paso 8. Apagarlo cuando termines**

```bash
docker stop bigdata
```

Al otro día: `docker start bigdata`, esperar el LISTO, y `docker exec -it
bigdata bash`. **No** repetir el `docker run`.

## 2. Qué comando, cuándo

Los comandos `docker ...` van en la terminal de **tu compu**. El resto
(`hdfs`, `pig`, `beeline`, `sqoop`, `mysql`, `estado`...), **adentro** del contenedor, después de
`docker exec -it bigdata bash`.

| Cuándo                                   | Comando                                                      |
|------------------------------------------|--------------------------------------------------------------|
| **Una sola vez** (por compu)             | Instalar Docker · `docker pull franki678/bigdata-sandbox` (o `docker load`, sección 5B) |
| **Una sola vez** (por cluster)           | `docker run ...` (paso 4)                                    |
| **Cada vez** que lo usás                 | `docker start bigdata` → esperar LISTO (`docker logs -f bigdata`) → `docker exec -it bigdata bash` |
| Cada vez que necesites otra terminal     | `docker exec -it bigdata bash` (se pueden abrir varias)      |
| **Cada vez** que terminás                | `exit` (salir) y `docker stop bigdata` (apagar)              |
| Para **cambiar parámetros** (DataNodes, replicación, bloque, servicios) | `docker rm -f bigdata` y de nuevo `docker run` con otros `-e`. HDFS y las tablas se conservan |
| Para **actualizar** la imagen            | `docker pull franki678/bigdata-sandbox` de nuevo, `docker rm -f bigdata` y `docker run`. HDFS y las tablas se conservan |
| Para **empezar de cero** (borrar todo HDFS, Hive y MySQL) | `docker rm -f bigdata` + `docker volume rm bigdata_hadoop` y de nuevo `docker run` |
| Para mirar qué pasa                      | `docker logs bigdata` (arranque) · `docker stats bigdata` (RAM/CPU) · `docker ps -a` (si está prendido) |

Errores típicos:

- Repetir `docker run` todos los días: falla con *the container name
  "/bigdata" is already in use*. El contenedor ya existe: `docker start bigdata`.
- Correr `hdfs` o `pig` en la terminal de tu compu: dice *command not found*.
  Primero `docker exec -it bigdata bash`.
- Correr un `docker ...` adentro del contenedor: lo mismo. Primero `exit`.

## 3. Carpetas y archivos

### En tu compu

```
bigdata/                   <- tu carpeta de trabajo (paso 3), el nombre que quieras
└── datos/                 <- la crea el docker run. Adentro del contenedor es /datos
    ├── ejemplos/          <- aparecen solos al prender el contenedor
    │   ├── ventas.csv          7 ventas para mirar a ojo
    │   ├── generar_ventas.py   genera un dataset de ventas grande
    │   ├── mapper.py           ventas por producto en MapReduce (Python)
    │   ├── reducer.py
    │   ├── ventas.pig          lo mismo en Pig
    │   ├── ventas.hql          lo mismo en Hive (SQL)
    │   ├── ventas.py           lo mismo en Spark (PySpark)
    │   ├── sqoop.sh            Sqoop: MySQL -> HDFS -> Hive -> MySQL
    │   ├── tienda.sql          la base MySQL "tienda" (ya viene cargada)
    │   ├── tienda.hql          JOIN en Hive de las tablas que trajo Sqoop
    │   ├── texto.txt           texto para el wordcount
    │   └── wordcount.pig       wordcount en Pig
    └── (tus archivos)     <- tus CSV, scripts y lo que bajes de HDFS
```

- Todo lo que pongas en `datos/` (con el Explorador, Finder o un editor) se ve
  adentro en `/datos`, y al revés. Es la forma de pasar archivos.
- Si editás un ejemplo, queda tu versión. Para recuperar el original: borralo y
  `docker restart bigdata`.
- Podés tener varias carpetas de trabajo, pero el `-v .../datos:/datos` del
  `docker run` apunta a una sola: la carpeta donde estabas parado cuando lo
  corriste.

### Adentro del contenedor

| Dónde                  | Qué es                                                      |
|------------------------|-------------------------------------------------------------|
| `/datos`               | Tu carpeta `datos/`. Ahí arrancás al entrar                 |
| HDFS `/user/root/...`  | El sistema de archivos distribuido: se ve con `hdfs dfs -ls`, no con `ls`. Es lo que leen MapReduce, Pig, Hive y Spark |
| `/hadoop`              | Disco del cluster: los bloques de cada DataNode, metadatos del NameNode, el metastore de Hive y la base MySQL. Vive en el **volumen** `bigdata_hadoop`: sobrevive a `docker stop`, `docker rm` y a actualizar la imagen. Solo se borra con `docker volume rm` |
| `/opt/hadoop`, `/opt/pig`, `/opt/hive`, `/opt/spark`, `/opt/sqoop`... | Los programas y sus logs |
| MySQL `tienda`         | Base relacional de ejemplo (fuera de HDFS): se ve con `mysql tienda`. Es de donde Sqoop trae y adonde devuelve |

Un archivo pasa de tu compu al cluster así: lo dejás en `datos/` →
`hdfs dfs -put` lo sube de `/datos` a HDFS → se procesa → `hdfs dfs -get` baja
el resultado a `/datos` → lo abrís en tu compu.

### Este repo

Solo hace falta para **armar** la imagen (sección 5C) o para leer cómo está
hecha. Para usarla, no.

| Archivo                      | Qué es                                                  |
|------------------------------|---------------------------------------------------------|
| `Dockerfile`                 | Cómo se arma la imagen: baja Hadoop, Pig, Hive, Tez, Spark, Sqoop y ZooKeeper de Apache, e instala MariaDB |
| `entrypoint.sh`              | Lo que corre al prender el contenedor: genera la configuración según los `-e` y arranca cada proceso en orden |
| `sandbox/lib.sh`             | Funciones comunes: generar el `hdfs-site.xml`, prender/apagar nodos, memoria de cada daemon |
| `sandbox/bin/`               | Los comandos `estado`, `datanode`, `namenode` y `jps`   |
| `conf/`                      | Configuración fija de YARN, MapReduce, Hive, Tez, Spark, ZooKeeper y MySQL |
| `datos/ejemplos/`            | Los ejemplos que van adentro de la imagen               |
| `pruebas/probar.sh`          | Prueba de punta a punta: el tutorial entero, comparando los resultados |
| `pruebas/escenarios.sh`      | Reinicios, alta disponibilidad, cada `SERVICIOS`, cambios de parámetros, arranques cortados |
| `.github/workflows/imagen.yml` | GitHub arma la imagen, corre la prueba y, si da bien, la publica en Docker Hub y deja el archivo para el aula en Releases (sección 5B) |
| `.github/workflows/escenarios.yml` | Corre `escenarios.sh` con la imagen ya publicada (a mano, desde la pestaña Actions) |
| `TUTORIAL.md`                | Paso a paso con un dataset de prueba y con uno propio   |

## 4. Requisitos

- **Docker Desktop** (Windows/Mac) o Docker Engine (Linux).
- **RAM asignada a Docker** (Docker Desktop: *Settings → Resources → Memory*):
  - Con todo prendido (por defecto): **6 GB**.
  - Con alta disponibilidad (`NAMENODES=2` o más): **8 GB**.
  - Solo HDFS (`SERVICIOS=hdfs`, ver sección 6): **4 GB** alcanzan.
  - Cada DataNode extra suma ~250 MB.
  - Lo que usa en cada momento: `docker stats bigdata`.
- ~3 GB de disco para la imagen.

## 5. Conseguir la imagen (una sola vez)

La imagen se baja de **Docker Hub**: https://hub.docker.com/r/franki678/bigdata-sandbox.
Hay tres formas de tenerla; las tres terminan igual: una imagen llamada
`franki678/bigdata-sandbox` en tu compu, que es la que usa el `docker run`.

### A) Bajarla de Docker Hub (la más simple)

```bash
docker pull franki678/bigdata-sandbox
```

- Baja ~1,3 GB y sirve para Windows, Linux y Mac (Intel o M1–M4): Docker elige
  sola la versión de tu compu.
- No hace falta cuenta de Docker Hub ni `docker login`.
- Si te salteás el `pull`, el `docker run` la baja solo la primera vez.
- No hace falta tener el repo: los ejemplos (datasets y scripts) vienen
  adentro de la imagen y aparecen solos en `datos/ejemplos/`.
- Para actualizarla más adelante: el mismo `docker pull`, y después recreás el
  contenedor (`docker rm -f bigdata` + `docker run`; tus datos quedan en el
  volumen).

### B) En el aula: la baja una sola PC y la reparte

Si 20 PCs bajan la imagen a la vez, se satura la internet de la facultad (puede
tardar una hora) y Docker Hub limita las descargas sin cuenta por conexión.
Mejor bajarla **una sola vez** y repartirla por la red del aula o por pendrive.
Para eso está lista en un solo archivo, `bigdata-sandbox.tar.gz` (~1,2 GB,
para PCs Intel/AMD con Windows o Linux), que se actualiza solo cada vez que se
publica la imagen:

https://github.com/Franki-678/bigdata-sandbox/releases/download/imagen/bigdata-sandbox.tar.gz

**1. La PC del profesor lo baja** con el navegador (queda en Descargas; ~2 min
con la internet libre). Si esa PC también se borra al reiniciar, conviene
guardarlo en un pendrive y copiarlo de ahí cada clase.

**2. Lo reparte a las PCs de los alumnos**, de una de estas formas:

- **Con Veyon:** en Veyon Master, seleccionar todas las PCs → **Transferencia
  de archivos** → elegir `bigdata-sandbox.tar.gz` → **Solo transferir**. Queda
  en la carpeta del usuario de cada PC (`C:\Users\<usuario>`).
- **Por la red, desde la PC del profesor** (sin Veyon, o si con Veyon tarda
  mucho): ver más abajo.
- **Con pendrive:** copiarlo a la carpeta del usuario (`C:\Users\<usuario>`).
  Entra en uno de 4 GB, aunque esté en FAT32.

**3. Cada alumno lo carga en Docker**, con Docker Desktop abierto. En una
terminal nueva (arranca en la carpeta del usuario, donde quedó el archivo):

```bash
docker load -i bigdata-sandbox.tar.gz
```

Tarda 1-2 min. Después, el `docker run` de siempre (sección 1, paso 4): como la
imagen ya está, no baja nada de internet.

**Por la red, desde la PC del profesor.** Necesita Docker Desktop abierto y la
imagen ya cargada en esa PC (paso 3). Abrir la carpeta Descargas, escribir
`cmd` en la barra de dirección y Enter, y ahí:

```bat
docker run -d --rm --name compartir -p 8000:8000 -v "%cd%:/srv:ro" -w /srv --entrypoint python3 franki678/bigdata-sandbox -m http.server 8000
ipconfig
```

De `ipconfig`, anotar la **Dirección IPv4** (por ejemplo `192.168.1.10`). Si
Windows pregunta por el firewall, **Permitir**. Cada alumno, cambiando la IP:

```bash
curl.exe -o bigdata-sandbox.tar.gz http://192.168.1.10:8000/bigdata-sandbox.tar.gz
docker load -i bigdata-sandbox.tar.gz
```

Al terminar, el profesor lo corta con `docker stop compartir`.

**Para pasarla entre compañeros** (sin el archivo de GitHub): el que la tiene
la guarda con `docker save franki678/bigdata-sandbox -o bigdata-sandbox.tar`
(1,2 a 3 GB según el Docker) y los demás la cargan con `docker load -i
bigdata-sandbox.tar`.

### C) Armarla desde el código

Desde la carpeta del repo:

```bash
docker build -t franki678/bigdata-sandbox .
```

- Tarda ~5-10 min la primera vez (baja ~1,6 GB de Apache). Si cambiás algo y
  la volvés a buildear, reusa lo ya bajado.
- Es lo que hace GitHub cada vez que cambia el código: la arma, la prueba y la
  publica en Docker Hub para la opción A (`.github/workflows/imagen.yml`).

## 6. Crear el contenedor y todos sus parámetros

El `docker run` del paso 4, parte por parte:

| Parte                          | Significado                                                        |
|--------------------------------|--------------------------------------------------------------------|
| `-d`                           | Corre en segundo plano: te devuelve la consola                     |
| `--name bigdata`               | Nombre del **contenedor**. Con ese nombre lo manejás de acá en más (`start`, `stop`, `exec`, `logs`) |
| `-e DATANODES=3` …             | La arquitectura del cluster (tabla de abajo). Los que no pongas toman su valor por defecto |
| `-p 9870-9872:9870-9872` …     | Expone cada página web en tu compu (`localhost:9870`, etc.). Van todos los puertos posibles, uses o no esos nodos. Formato `-p <puerto en tu compu>:<puerto adentro>` |
| `-v bigdata_hadoop:/hadoop`    | Volumen donde viven HDFS, el metastore y la base MySQL: **tus datos persisten** |
| `-v .../datos:/datos`          | La carpeta `datos/` de tu compu aparece adentro como `/datos`      |
| `franki678/bigdata-sandbox`              | La imagen (sección 5)                                              |

La única diferencia entre consolas es cómo se escribe "la carpeta actual":
`$(pwd)` en Mac/Linux, `${PWD}` en PowerShell, `%cd%` en CMD. Si usás la de
otra consola, Docker se queja de `invalid characters for a local volume name`.

### Parámetros (`-e`)

| Parámetro     | Qué elige                                   | Por defecto | Valores          |
|---------------|---------------------------------------------|-------------|------------------|
| `DATANODES`   | Cantidad de DataNodes (procesos que guardan los bloques) | 1 | 1 a 9   |
| `NAMENODES`   | Cantidad de NameNodes. Con 2 o más se arma **alta disponibilidad**: uno *active*, el resto *standby*, y si el activo se cae otro toma el control solo | 1 | 1 a 3 |
| `REPLICATION` | Copias de cada bloque, cada una en un DataNode distinto. Si es mayor que `DATANODES`, los bloques quedan sub-replicados (`estado` lo avisa) | 1 | 1 a 9 |
| `BLOCK_SIZE`  | Tamaño de bloque: un archivo se parte en bloques de este tamaño. Chico (`1m`) para ver muchos bloques con archivos chicos; `128m` es el de un cluster real | 128m | número + `m` o `g`: `1m`, `32m`, `128m`, `1g`… (mínimo 1m) |
| `SERVICIOS`   | Qué se prende además de HDFS (ver abajo)    | todo        | `hdfs`, `mapreduce`, `todo` |

Si un valor está mal escrito, el contenedor se apaga y `docker logs bigdata`
dice cuál (`[sandbox] ERROR: ...`).

`SERVICIOS` elige qué capas del stack se prenden, para no gastar memoria en lo
que la clase no usa:

| `SERVICIOS` | Qué corre                                          | RAM para Docker |
|-------------|----------------------------------------------------|-----------------|
| `hdfs`      | Solo HDFS (NameNodes, DataNodes y compañía). El más liviano y el que más rápido arranca | 4 GB |
| `mapreduce` | HDFS + YARN + MapReduce (wordcount, JobHistory) + Pig + Sqoop y MySQL | 5 GB |
| `todo`      | Lo anterior + Hive + Spark (por defecto). Hive es lo que más tarda en arrancar (~1 min) | 6 GB |

Pig no es un servicio: es un comando que manda trabajos MapReduce a YARN. Con
`SERVICIOS=hdfs` (YARN apagado) se usa en modo local: `pig -x local`. Sqoop
tampoco es un servicio: copia con trabajos MapReduce, así que necesita
`mapreduce` o `todo` (el ejemplo completo, con Hive en el medio, necesita
`todo`).

### Combinaciones típicas

En lugar de `<...>` van los `-p` y `-v` del paso 4.

```bash
# Todo por defecto: 1 NameNode (+ Secondary), 1 DataNode, replicación 1, bloque 128m
docker run -d --name bigdata <...> franki678/bigdata-sandbox

# Para ver replicación: 3 DataNodes, cada bloque en 2 de ellos, bloques chicos (la del paso 4)
docker run -d --name bigdata -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m <...> franki678/bigdata-sandbox

# Para entrar a MySQL desde tu compu (DBeaver, Workbench...): sumar -p 3306:3306
docker run -d --name bigdata -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -p 3306:3306 <...> franki678/bigdata-sandbox

# Alta disponibilidad: 2 NameNodes + 3 DataNodes con replicación 3
docker run -d --name bigdata -e NAMENODES=2 -e DATANODES=3 -e REPLICATION=3 <...> franki678/bigdata-sandbox

# Clase de HDFS: solo HDFS, liviano y rápido de arrancar
docker run -d --name bigdata -e SERVICIOS=hdfs -e DATANODES=3 -e REPLICATION=2 <...> franki678/bigdata-sandbox

# Clase de MapReduce, Pig y Sqoop, sin Hive ni Spark
docker run -d --name bigdata -e SERVICIOS=mapreduce -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m <...> franki678/bigdata-sandbox
```

### Cambiar los parámetros

Se borra el contenedor y se vuelve a crear con otros `-e` (o `-p`). Los datos
de HDFS, las tablas de Hive y la base MySQL quedan en el volumen:

```bash
docker rm -f bigdata
docker run -d --name bigdata -e DATANODES=4 <...> franki678/bigdata-sandbox
```

- `DATANODES`, `REPLICATION`, `BLOCK_SIZE` y `SERVICIOS` se pueden cambiar
  cuando quieras. La replicación y el bloque nuevos aplican a los archivos que
  subas desde ese momento. A los archivos viejos se les cambia la replicación
  con `hdfs dfs -setrep`; el tamaño de bloque no: hay que volver a subirlos.
- `NAMENODES` queda fijo cuando se crea el volumen: pasar de 1 a 2 cambia cómo
  se guardan los metadatos. Para cambiarlo, empezá de cero (sección 12).
- Si bajás `DATANODES` y los nodos que sacaste tenían la única copia de algún
  bloque, esos bloques quedan *perdidos* (`hdfs fsck /` los lista), igual que
  en un cluster de verdad. Acá no se borran: siguen en `/hadoop/dfs/dnN` y
  vuelven si prendés ese nodo (`datanode start N`) o subís `DATANODES` otra vez.
- Con `SERVICIOS=hdfs` o `mapreduce`, las tablas de Hive no se borran: vuelven
  cuando prendés `todo` otra vez. Lo mismo la base MySQL con `SERVICIOS=hdfs`.

### Seguir el arranque

```bash
docker logs -f bigdata
```

Cuando aparece el cartel **"Cluster LISTO"**, está todo arriba (~1-2 min; la
primera vez un poco más, porque formatea HDFS y sube las librerías de Tez y
Spark). Abajo del cartel ves la arquitectura completa, con cada proceso, su
estado y su página web. Salís del log con `Ctrl+C`; el contenedor sigue
corriendo.

## 7. Uso diario

```bash
docker start bigdata       # prender (~1-2 min hasta el cartel LISTO)
docker logs -f bigdata     # ver si ya está LISTO (Ctrl+C para salir)
docker exec -it bigdata bash   # abrir una terminal ADENTRO del cluster
exit                       # salir de esa terminal (el cluster sigue)
docker stop bigdata        # apagar (los datos quedan guardados)
```

No vuelvas a hacer `docker run` cada día: eso crea **otro** contenedor (y falla
porque el nombre `bigdata` ya existe). `docker run` es una sola vez; después,
`start`/`stop`.

Al reiniciar, HDFS se queda unos segundos en *safe mode* revisando los bloques.
Es normal en Hadoop; el script espera solo.

## 8. Ver la arquitectura

### Desde la terminal

Adentro del contenedor (`docker exec -it bigdata bash`):

```bash
estado          # todos los procesos: arriba/abajo, su web, y qué ve el NameNode
datanode        # lista los DataNodes
namenode        # lista los NameNodes y cuál es el activo
jps             # los procesos Java, uno por nodo: DataNode (dn2), NameNode (nn1)...
```

### Páginas web

| Componente            | URL                         | Qué mirar                                    |
|-----------------------|-----------------------------|----------------------------------------------|
| NameNode 1            | http://localhost:9870       | *Overview*: capacidad, bloques, nodos vivos/muertos. *Datanodes*: cada DataNode con sus bloques. *Utilities → Browse the file system*: columnas **Replication** y **Block Size**; clic en un archivo → **Block information**: en qué DataNodes está cada bloque |
| NameNode 2 y 3 (HA)   | http://localhost:9871 / 9872 | Arriba dice **(active)** o **(standby)**     |
| Secondary NameNode    | http://localhost:9868       | Último *checkpoint* de los metadatos (cada 5 min). Solo sin HA |
| DataNode N            | http://localhost:990N       | DataNode 1 → 9901, DataNode 2 → 9902… Sus bloques y su disco |
| JournalNodes (HA)     | http://localhost:8480-8482  | Comparten el registro de cambios entre NameNodes |
| YARN ResourceManager  | http://localhost:8088       | Todos los trabajos: MapReduce (y Pig), TEZ (Hive), SPARK |
| YARN NodeManager      | http://localhost:8042       | Contenedores corriendo                       |
| MapReduce JobHistory  | http://localhost:19888      | Trabajos MapReduce (y Pig) terminados y sus logs |
| HiveServer2           | http://localhost:10002      | Sesiones y queries de Hive                   |
| Spark History         | http://localhost:18080      | Trabajos de Spark terminados                 |
| Spark (trabajo activo)| http://localhost:4040       | Solo mientras corre un spark-shell/pyspark/spark-submit |
| MySQL                 | `localhost:3306` (no es web) | Solo si agregaste `-p 3306:3306` (sección 6). Desde DBeaver: `jdbc:mysql://localhost:3306/tienda`, usuario `alumno`, clave `alumno` |

Los links entre páginas (por ejemplo, de la lista de DataNodes del NameNode a
la página de cada DataNode) apuntan a `localhost` y funcionan desde el
navegador.

## 9. Experimentos de arquitectura

Todos adentro del contenedor. Los ejemplos suponen `DATANODES=3`,
`REPLICATION=2` y `BLOCK_SIZE=1m`, pero andan con cualquier combinación.

### Bloques y réplicas

```bash
seq 1 1000000 > numeros.txt                  # archivo de ~7 MB en datos/
hdfs dfs -put -f numeros.txt /user/root/
hdfs dfs -ls /user/root                      # la 2ª columna es la replicación
hdfs fsck /user/root/numeros.txt -files -blocks -locations
```

`fsck` lista cada bloque (7 bloques de 1 MB) y en qué DataNodes quedó cada
réplica. Los DataNodes aparecen por puerto: `127.0.0.1:9911` es el DataNode 1,
`:9912` el 2, y así. Lo mismo se ve en http://localhost:9870 → *Browse the
file system* → clic en el archivo.

Cambiar la replicación o el bloque de un archivo puntual:

```bash
hdfs dfs -setrep -w 3 /user/root/numeros.txt               # ahora 3 copias
hdfs dfs -D dfs.blocksize=2m -put numeros.txt /user/root/n2.txt   # bloque de 2 MB solo para este
```

### Se cae un DataNode

```bash
datanode stop 2
```

En http://localhost:9870 → *Datanodes*, el DataNode 2 pasa a **Dead** en ~40 s.
En el Hadoop de fábrica tarda 10,5 min; acá está acortado para verlo en clase.
Enseguida el NameNode copia los bloques que tenía ese nodo a los que quedan,
para volver a cumplir la replicación. Volvé a correr el `fsck` de arriba: el
DataNode 2 ya no aparece y todos los bloques siguen con 2 réplicas. Los
trabajos (MapReduce, Pig, Hive, Spark, Sqoop) siguen andando.

```bash
datanode start 2
```

Vuelve con sus bloques viejos. Ahora sobran copias y el NameNode borra las de
más (*over-replicated*). Con `REPLICATION=1` y un nodo caído, en cambio, sus
bloques quedan **perdidos** (*missing*) hasta que vuelva: por eso se replica.

Sumar un nodo en caliente (por ejemplo, el 4 con `DATANODES=3`):

```bash
datanode start 4
```

Aparece en la web como un DataNode nuevo, vacío. Para que quede fijo, recreá
el contenedor con `-e DATANODES=4`.

### Se cae el NameNode

**Sin HA** (`NAMENODES=1`):

```bash
namenode stop 1
hdfs dfs -ls /        # falla: el NameNode es el punto único de falla
namenode start 1
```

**Con HA** (`NAMENODES=2`):

```bash
namenode              # ej.: nn1 active, nn2 standby
namenode stop 1       # se cae el activo
namenode              # a los pocos segundos: nn2 active
hdfs dfs -ls /        # HDFS sigue andando, y Hive y Spark también
namenode start 1      # vuelve como standby
```

El activo no es siempre el 1: el que gana la elección en ZooKeeper. Mirá con
`namenode` cuál es y apagá ese.

Cómo funciona: cada NameNode tiene su **ZKFC**, que lo vigila y compite en
**ZooKeeper** por un *lock*. El que lo tiene es el activo. El activo escribe
cada cambio en los **JournalNodes** y el standby los va leyendo, así está al
día cuando le toca. Para ver el lock:

```bash
zkCli.sh -server localhost:2181 ls /hadoop-ha/sandbox
```

Cambio de activo a mano:

```bash
hdfs haadmin -getAllServiceState
hdfs haadmin -failover nn2 nn1
```

### Ver la configuración generada

```bash
cat $HADOOP_CONF_DIR/hdfs-site.xml           # replicación, bloque, NameNodes...
cat /opt/sandbox/run/dn2/hdfs-site.xml       # lo propio del DataNode 2 (carpeta y puertos)
```

## 10. Ejemplos: MapReduce, Pig, Hive, Spark y Sqoop

Todos se corren **adentro** del contenedor (`docker exec -it bigdata bash`),
parado en `/datos`. Los archivos están en `datos/ejemplos/` (sección 3). El
paso a paso completo, con qué tiene que salir en cada uno, está en el
[TUTORIAL](TUTORIAL.md).

Los cuatro ejemplos de ventas (`mapper.py`+`reducer.py`, `ventas.pig`,
`ventas.hql`, `ventas.py`) hacen el **mismo cálculo** (unidades y facturación
por producto) sobre los mismos archivos de HDFS, y tienen que dar el mismo
resultado. Cada uno guarda el suyo en `/user/root/resultados/`. El de Sqoop
(`sqoop.sh`) es otro caso: datos que están en una base MySQL (más abajo).

### Orden recomendado

```bash
# 1. Dataset de prueba (una vez): 200.000 filas -> datos/ventas_grandes.csv (6 MB)
python3 ejemplos/generar_ventas.py

# 2. Subirlo a HDFS (una vez)
hdfs dfs -mkdir -p /user/root/ventas
hdfs dfs -put -f ventas_grandes.csv /user/root/ventas/
hdfs fsck /user/root/ventas/ventas_grandes.csv -files -blocks -locations   # en qué bloques quedó

# 3. Procesarlo con cada herramienta (las veces que quieras)
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-3.3.6.jar \
  -files ejemplos/mapper.py,ejemplos/reducer.py \
  -mapper "python3 mapper.py" -reducer "python3 reducer.py" \
  -input /user/root/ventas -output /user/root/resultados/mr_por_producto
pig ejemplos/ventas.pig
beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql
spark-submit ejemplos/ventas.py

# 4. Ver los resultados
hdfs dfs -ls /user/root/resultados
hdfs dfs -cat '/user/root/resultados/pig_por_producto/part-*'

# 5. Bajarlos a tu compu (quedan en datos/resultados/)
mkdir -p resultados
hdfs dfs -getmerge /user/root/resultados/pig_por_producto resultados/pig.csv
```

Resultado esperado (los cuatro iguales):

| producto   | unidades | facturado   |
|------------|---------:|------------:|
| yerba      |  179.512 | 448.780.000 |
| termo      |   11.793 | 412.755.000 |
| mate       |   48.154 | 385.232.000 |
| cafe       |   29.471 | 191.561.500 |
| galletitas |   82.979 | 149.362.200 |
| facturas   |  121.087 | 108.978.300 |
| bombilla   |   36.281 | 108.843.000 |
| azucar     |   89.796 | 107.755.200 |

### MapReduce

El wordcount en Java, que viene con Hadoop:

```bash
hdfs dfs -put -f ejemplos/texto.txt /user/root/
hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar \
  wordcount /user/root/texto.txt /user/root/wc-out
hdfs dfs -cat /user/root/wc-out/part-r-00000
```

Mapper y reducer propios en Python (Hadoop Streaming). Primero se prueban sin
Hadoop, con `sort` haciendo de *shuffle*:

```bash
cat ejemplos/ventas.csv | python3 ejemplos/mapper.py | sort | python3 ejemplos/reducer.py
```

Y en el cluster, el comando del paso 3 de arriba. Hay un mapper por bloque:
con `BLOCK_SIZE=1m`, el dataset de 6 MB da 6 mappers.

MapReduce no pisa una salida que ya existe: para repetir, primero
`hdfs dfs -rm -r <carpeta de salida>`. Los demás ejemplos (Pig, Hive, Spark)
pisan la suya solos.

### Pig

```bash
pig ejemplos/ventas.pig                              # script en el cluster (trabajos MapReduce)
hdfs dfs -cat '/user/root/resultados/pig_por_producto/part-*'
pig -param entrada=/user/root/otra ejemplos/ventas.pig   # parámetros del script (%default)
pig -x local -param entrada=ejemplos/texto.txt ejemplos/wordcount.pig   # sin cluster, sobre /datos
pig                                                  # consola interactiva (grunt)
```

```pig
-- dentro de grunt
ventas = LOAD '/user/root/ventas' USING PigStorage(',')
         AS (fecha:chararray, sucursal:chararray, producto:chararray, cantidad:int, precio:int);
DESCRIBE ventas;
primeras = LIMIT ventas 5;
DUMP primeras;          -- recién acá corre algo (Pig es lazy)
EXPLAIN primeras;       -- el plan: qué trabajos MapReduce va a lanzar
quit
```

Cada `DUMP`/`STORE` aparece en http://localhost:8088 como uno o más trabajos
MapReduce, y terminados en http://localhost:19888.

### Hive

```bash
beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql   # crea la tabla ventas y consulta
beeline -u jdbc:hive2://localhost:10000                          # consola interactiva
```

```sql
SHOW TABLES;
SELECT sucursal, COUNT(*) FROM ventas GROUP BY sucursal;
CREATE TABLE demo (id INT, nombre STRING);
INSERT INTO demo VALUES (1, 'hola'), (2, 'bigdata');
SELECT * FROM demo;
!quit
```

`ventas` es una tabla **EXTERNAL**: Hive lee los archivos de
`/user/root/ventas` en su lugar, los mismos que usan Pig y Spark.

Desde DBeaver u otro cliente en tu compu: `jdbc:hive2://localhost:10000`, sin
usuario ni contraseña.

### Spark

```bash
spark-submit ejemplos/ventas.py     # script entero
spark-shell     # Scala
pyspark         # Python
spark-sql       # SQL; ve las mismas tablas que Hive
```

```python
# dentro de pyspark
df = spark.read.csv("hdfs:///user/root/ventas", header=True, inferSchema=True)
df.groupBy("producto").count().show()
df.write.mode("overwrite").saveAsTable("ventas_spark")   # queda como tabla de Hive, en HDFS
spark.sql("SELECT * FROM ventas LIMIT 5").show()         # lee la tabla creada en Hive
exit()
```

Todo Spark corre sobre YARN: cada sesión aparece en http://localhost:8088 como
aplicación SPARK y, al terminar, en http://localhost:18080.

### Sqoop

Sqoop copia tablas entre una **base relacional** y HDFS: `import` trae una
tabla a HDFS (como archivos de texto) y `export` devuelve una carpeta de HDFS a
una tabla. Cada copia es un trabajo MapReduce que solo tiene mappers (se ve en
http://localhost:8088).

Adentro del contenedor corre un **MySQL** (MariaDB) con la base `tienda` ya
cargada, para tener de dónde traer:

| Tabla               | Filas   | Qué tiene                                             |
|---------------------|--------:|-------------------------------------------------------|
| `productos`         | 8       | producto, categoría (infusiones, accesorios, almacen, panaderia) y precio |
| `sucursales`        | 4       | sucursal, encargado y fecha de apertura               |
| `ventas`            | 200.000 | id, fecha, sucursal, producto, cantidad y precio: las **mismas** ventas que `ventas_grandes.csv` |
| `resumen_categoria` | 0       | Vacía: acá vuelve el resultado calculado en Hadoop    |

Usuario `alumno`, clave `alumno`. Para mirarla con SQL:

```bash
mysql tienda          # consola de MySQL (salir: exit)
```

```sql
SHOW TABLES;
SELECT * FROM productos;
SELECT sucursal, COUNT(*) FROM ventas GROUP BY sucursal;
exit
```

El ejemplo completo (necesita `SERVICIOS=todo`, porque usa Hive en el medio):

```bash
bash ejemplos/sqoop.sh
```

Hace cuatro pasos, que también se pueden copiar de a uno desde el archivo:

1. **Mirar** la base desde Sqoop: `list-databases`, `list-tables` y `eval`
   (corre un SQL en MySQL y muestra el resultado; no usa Hadoop).
2. **Importar** `productos` (1 mapper → 1 archivo) y `ventas` (4 mappers en
   paralelo: Sqoop parte la tabla en 4 rangos de `id` → 4 archivos
   `part-m-0000N`) a `/user/root/tienda/<tabla>`.
3. **Procesar** en Hive (`ejemplos/tienda.hql`): tablas externas sobre esas
   carpetas y un `JOIN` ventas + productos para facturar por categoría. El
   resultado queda en `/user/root/resultados/hive_por_categoria`.
4. **Exportar** ese resultado a la tabla `resumen_categoria` de MySQL.

```bash
sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table ventas --target-dir /user/root/tienda/ventas --delete-target-dir -m 4

sqoop export --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table resumen_categoria --export-dir /user/root/resultados/hive_por_categoria -m 1
```

Resultado esperado en `resumen_categoria`:

| categoria  | unidades | facturado   |
|------------|---------:|------------:|
| accesorios |   96.228 | 906.830.000 |
| infusiones |  208.983 | 640.341.500 |
| almacen    |  172.775 | 257.117.400 |
| panaderia  |  121.087 | 108.978.300 |

Para tener en cuenta:

- `--delete-target-dir` pisa la carpeta de HDFS si ya existe; sin eso, el
  import falla igual que MapReduce.
- `export` **agrega** filas: la tabla destino tiene que existir y, para
  repetir, hay que vaciarla antes (el script hace `TRUNCATE`).
- Antes de copiar, Sqoop genera una clase Java para leer la tabla: queda un
  `<tabla>.java` en la carpeta donde estás. Se puede borrar.
- `Setting your password on the command-line is insecure`: es un aviso. Con
  `-P` en lugar de `--password alumno`, la pide por teclado.
- Con `SERVICIOS=mapreduce` (sin Hive) andan `list`, `eval`, el import y el
  export. `sqoop.sh` hace los pasos 1 y 2 y avisa que el 3 y el 4 necesitan
  Hive (lo que exporta es el resultado del JOIN en Hive).
- Para entrar a la base desde tu compu (DBeaver, Workbench), sumá
  `-p 3306:3306` al `docker run` (sección 6).
- `--hive-import` (importar directo a una tabla de Hive) **no anda**: Sqoop
  1.4.7 es anterior a Hive 4. Se hace como en `tienda.hql`: importar a una
  carpeta y crear encima una tabla EXTERNAL.

### Con tu propio dataset

1. Copiá tu CSV a `datos/` en tu compu.
2. Adentro: `head` y `file` para ver separador (`,` o `;`), encabezado y si
   tiene fines de línea de Windows (`sed -i 's/\r$//' archivo.csv`).
3. `hdfs dfs -mkdir -p /user/root/<nombre>` y `hdfs dfs -put archivo.csv /user/root/<nombre>/`.
4. Copiá el ejemplo de la herramienta que quieras y cambiale la carpeta y las
   columnas.

Detalle y ejemplos de cada herramienta (Sqoop incluido): [TUTORIAL, paso 15](TUTORIAL.md#15-con-tu-propio-dataset).

## 11. Referencia de comandos

### En tu compu (Docker)

| Comando                                  | Qué hace                                               |
|------------------------------------------|--------------------------------------------------------|
| `docker pull franki678/bigdata-sandbox`  | Baja (o actualiza) la imagen de Docker Hub             |
| `docker save franki678/bigdata-sandbox -o bigdata-sandbox.tar` | Guarda la imagen en un archivo (para el pendrive) |
| `docker load -i bigdata-sandbox.tar`     | Carga la imagen desde ese archivo                      |
| `docker build -t franki678/bigdata-sandbox .`      | Arma la imagen desde el repo                           |
| `docker run -d --name bigdata ...`       | Crea y prende el contenedor (una sola vez; sección 6)  |
| `docker start bigdata` / `docker stop bigdata` | Prender / apagar                                 |
| `docker restart bigdata`                 | Apagar y prender                                       |
| `docker exec -it bigdata bash`           | Terminal adentro del cluster                           |
| `docker exec bigdata estado`             | Un comando suelto adentro, sin entrar                  |
| `docker logs -f bigdata`                 | Ver el arranque (Ctrl+C sale)                          |
| `docker ps -a`                           | Ver si el contenedor está prendido (`Up`) o apagado (`Exited`) |
| `docker stats bigdata`                   | RAM y CPU que está usando                              |
| `docker cp archivo.csv bigdata:/datos/`  | Copiar un archivo adentro (alternativa a la carpeta `datos/`) |
| `docker rm -f bigdata`                   | Borrar el contenedor (los datos del volumen quedan)    |
| `docker volume rm bigdata_hadoop`        | Borrar los datos de HDFS, Hive y MySQL (con el contenedor ya borrado) |

### Adentro: el cluster

| Comando                 | Qué hace                                                     |
|-------------------------|--------------------------------------------------------------|
| `estado`                | Arquitectura: cada proceso, arriba/abajo, su web, y lo que reporta el NameNode |
| `datanode`              | Lista los DataNodes                                          |
| `datanode stop N`       | Apaga el DataNode N (simula que se cae ese nodo)             |
| `datanode start N`      | Lo prende. Si N es mayor que `DATANODES`, suma un nodo nuevo (1-9) |
| `namenode`              | Lista los NameNodes y cuál está activo                       |
| `namenode stop N` / `namenode start N` | Apaga / prende el NameNode N                  |
| `jps`                   | Procesos Java, con su instancia (nn1, dn2...)                |

### Adentro: HDFS

| Comando                                        | Qué hace                                  |
|------------------------------------------------|-------------------------------------------|
| `hdfs dfs -ls <carpeta>`                       | Listar (2ª columna: replicación)          |
| `hdfs dfs -mkdir -p <carpeta>`                 | Crear carpeta (y las de arriba)           |
| `hdfs dfs -put [-f] <local> <hdfs>`            | Subir de `/datos` a HDFS (`-f`: pisar)     |
| `hdfs dfs -get <hdfs> <local>`                 | Bajar de HDFS a `/datos`                  |
| `hdfs dfs -getmerge <carpeta> <archivo>`       | Bajar todos los `part-*` juntos, en un archivo |
| `hdfs dfs -cat <archivo>` / `-head` / `-tail`  | Ver contenido / primer KB / último KB      |
| `hdfs dfs -du -h <carpeta>`                    | Cuánto ocupa                               |
| `hdfs dfs -cp` / `-mv`                         | Copiar / mover dentro de HDFS             |
| `hdfs dfs -rm -r <ruta>`                       | Borrar                                    |
| `hdfs dfs -setrep -w N <ruta>`                 | Cambiar la replicación de algo ya subido  |
| `hdfs dfs -D dfs.blocksize=2m -put ...`        | Subir con otro tamaño de bloque           |
| `hdfs fsck <ruta> -files -blocks -locations`   | Bloques de cada archivo y en qué DataNodes están |
| `hdfs dfsadmin -report`                        | Estado de cada DataNode                    |
| `hdfs dfsadmin -safemode get`                  | ¿Está en safe mode?                        |
| `hdfs haadmin -getAllServiceState`             | (HA) Cuál NameNode está activo             |
| `hdfs haadmin -failover nn1 nn2`               | (HA) Pasar el activo de nn1 a nn2          |

### Adentro: YARN y MapReduce

| Comando                                        | Qué hace                                  |
|------------------------------------------------|-------------------------------------------|
| `hadoop jar <jar> <clase/programa> <args>`     | Correr un trabajo MapReduce               |
| `hadoop jar .../hadoop-streaming-3.3.6.jar -files a.py,b.py -mapper "python3 a.py" -reducer "python3 b.py" -input <in> -output <out>` | MapReduce con scripts (Python u otro). Opcional: `-numReduceTasks N` |
| `yarn application -list`                       | Trabajos corriendo (`-appStates ALL`: también terminados) |
| `yarn application -kill <application_id>`      | Matar un trabajo trabado                   |
| `yarn logs -applicationId <application_id>`    | Logs de un trabajo                         |
| `mapred job -list`                             | Trabajos MapReduce                         |

### Adentro: Pig

| Comando                                     | Qué hace                                     |
|---------------------------------------------|----------------------------------------------|
| `pig script.pig`                            | Corre el script en el cluster (MapReduce sobre YARN) |
| `pig`                                       | Consola interactiva `grunt>` (salir: `quit`) |
| `pig -x local script.pig`                   | Sin cluster: lee y escribe en `/datos`, no usa HDFS ni YARN |
| `pig -param nombre=valor script.pig`        | Pasa un parámetro (pisa el `%default` del script). Se repite para varios |
| `pig -dryrun -param ... script.pig`         | Muestra el script con los parámetros reemplazados, sin correrlo |
| `pig -e 'comando'`                          | Corre una sola línea (ej. `pig -e 'fs -ls /user/root'`) |

Dentro de un script o de grunt: `DESCRIBE` (esquema), `DUMP` (correr y
mostrar), `STORE` (correr y guardar), `EXPLAIN` (plan), `ILLUSTRATE` (ejemplo
de datos en cada paso), `fs -ls` y demás comandos de HDFS.

### Adentro: Hive

| Comando                                                     | Qué hace                       |
|-------------------------------------------------------------|--------------------------------|
| `beeline -u jdbc:hive2://localhost:10000`                   | Consola SQL (salir: `!quit`)   |
| `beeline -u jdbc:hive2://localhost:10000 -f script.hql`     | Corre un archivo SQL           |
| `beeline -u jdbc:hive2://localhost:10000 -e "SELECT ..."`   | Corre una consulta suelta      |
| `... --outputformat=csv2 -e "SELECT ..." > salida.csv`      | Resultado como CSV, a un archivo de `/datos` |

### Adentro: Spark

| Comando                                     | Qué hace                                     |
|---------------------------------------------|----------------------------------------------|
| `spark-submit script.py`                    | Corre un script en YARN                       |
| `spark-submit --num-executors 3 --executor-memory 1g script.py` | Con más ejecutores o memoria (por defecto: 2 de 512m) |
| `spark-submit --conf spark.sql.shuffle.partitions=8 script.py` | Cualquier opción de Spark (por defecto 4 particiones) |
| `pyspark` / `spark-shell` / `spark-sql`     | Consola en Python / Scala / SQL (salir: `exit()` / `:quit` / `exit;`) |

### Adentro: Sqoop

Todos llevan la conexión: `--connect jdbc:mysql://localhost/tienda --username alumno --password alumno`
(abajo, `<con>`). `list-databases` usa `jdbc:mysql://localhost`, sin base.

| Comando                                     | Qué hace                                     |
|---------------------------------------------|----------------------------------------------|
| `sqoop list-databases <con>`                | Bases de datos del servidor                  |
| `sqoop list-tables <con>`                   | Tablas de la base                            |
| `sqoop eval <con> --query "SELECT ..."`     | Corre un SQL en MySQL y muestra el resultado (también `INSERT`, `TRUNCATE`...) |
| `sqoop import <con> --table T --target-dir <hdfs>` | Copia la tabla T a esa carpeta de HDFS |
| `sqoop export <con> --table T --export-dir <hdfs>` | Agrega los archivos de esa carpeta a la tabla T (tiene que existir) |
| `sqoop help` / `sqoop help import`          | Todas las opciones                           |

Opciones de `import`:

| Opción                                  | Qué hace                                          |
|-----------------------------------------|---------------------------------------------------|
| `-m N`                                  | N mappers en paralelo → N archivos `part-m-*` (por defecto 4). Con `-m 1` no hace falta clave primaria |
| `--split-by columna`                    | Por qué columna partir entre los mappers (por defecto, la clave primaria) |
| `--delete-target-dir`                   | Si la carpeta ya existe, la pisa                  |
| `--where "sucursal = 'Centro'"`         | Solo las filas que cumplen                        |
| `--columns "fecha,producto,cantidad"`   | Solo esas columnas                                |
| `--query 'SELECT ... WHERE $CONDITIONS'` | Importa el resultado de una consulta (en lugar de `--table`). Va entre comillas **simples**, con `$CONDITIONS` y con `-m 1` o `--split-by` |
| `--fields-terminated-by ';'`            | Separador de columnas (por defecto `,`)           |
| `--as-textfile` / `--as-parquetfile` / `--as-avrodatafile` | Formato de los archivos (por defecto texto) |
| `--incremental append --check-column id --last-value 200000` | Trae solo las filas nuevas (con `id` mayor a ese) |

Opciones de `export`: `-m N`, `--input-fields-terminated-by ';'` (si los
archivos no van separados por comas), `--columns` (a qué columnas de la tabla
va cada campo), `--update-key columna` (actualiza filas en lugar de agregar).

### Adentro: MySQL

| Comando                                     | Qué hace                                     |
|---------------------------------------------|----------------------------------------------|
| `mysql tienda`                              | Consola SQL en la base `tienda` (salir: `exit`) |
| `mysql tienda -e "SELECT ..."`              | Una consulta suelta                          |
| `mysql tienda < script.sql`                 | Corre un archivo SQL                         |
| `mysql -u alumno -palumno tienda`           | Lo mismo, con el usuario que usa Sqoop       |
| `mysql < ejemplos/tienda.sql`               | Recrea la base `tienda` (antes: `python3 ejemplos/generar_ventas.py 200000 /tmp/tienda_ventas.csv`) |

Una tabla propia desde un CSV, para después traerla con Sqoop:

```sql
CREATE TABLE tienda.notas (alumno VARCHAR(50), materia VARCHAR(50), nota DECIMAL(4,2));
LOAD DATA LOCAL INFILE '/datos/notas.csv' INTO TABLE tienda.notas
  FIELDS TERMINATED BY ',' IGNORE 1 LINES;     -- IGNORE: saltea el encabezado
```

### Adentro: el generador de datos

| Comando                                               | Qué hace                         |
|-------------------------------------------------------|----------------------------------|
| `python3 ejemplos/generar_ventas.py`                  | 200.000 ventas → `ventas_grandes.csv` (6 MB) |
| `python3 ejemplos/generar_ventas.py 1000000`          | 1 millón de ventas (~30 MB)      |
| `python3 ejemplos/generar_ventas.py 50000 chico.csv`  | Otra cantidad y otro nombre       |

Siempre genera los mismos datos para la misma cantidad de filas (semilla fija):
a todos les da el mismo resultado.

## 12. Empezar de cero

Borra el contenedor y **todos los datos** de HDFS, Hive y MySQL (tu carpeta
`datos/` no se toca):

```bash
docker rm -f bigdata
docker volume rm bigdata_hadoop
```

Después repetís el `docker run` (con los `-e` que quieras).

## 13. Problemas comunes

| Síntoma                                         | Causa / solución                                              |
|-------------------------------------------------|---------------------------------------------------------------|
| `the container name "/bigdata" is already in use` | Ya lo creaste: usá `docker start bigdata`. Si querés recrearlo, antes `docker rm -f bigdata` |
| `hdfs: command not found` (o `pig`, `beeline`...) | Estás en tu compu: primero `docker exec -it bigdata bash` |
| `port is already allocated` o, en Windows, `access permissions` / `forbidden` | Otro programa (o Windows) usa ese puerto: cambiá el de la izquierda (ej. `-p 18888:8088`) o sacá ese `-p` si no usás ese nodo |
| El contenedor termina con `[sandbox] ERROR: ...` | Un parámetro mal puesto: el mensaje dice cuál. Corregilo y recreá el contenedor |
| `AVISO: este volumen se creo con N NameNode(s)` | `NAMENODES` no se cambia sobre un volumen existente (sección 6) |
| `Output directory ... already exists`           | MapReduce no pisa resultados: `hdfs dfs -rm -r <carpeta>` y de nuevo |
| `Name node is in safe mode`                     | Recién prendido: esperá el cartel LISTO. Si sigue, faltan DataNodes (bajaste `DATANODES`?) |
| Queries o Spark quedan en `ACCEPTED` sin avanzar | Falta memoria en YARN: cerrá sesiones de beeline/pyspark abiertas, o dale más RAM a Docker |
| El contenedor se cae solo                       | Poca RAM en Docker (sección 4). Mirá `docker logs bigdata` |
| Abrí un 2º pyspark y la UI no está en :4040     | La segunda sesión usa :4041, que no está expuesto. Usá :8088 → *ApplicationMaster* |
| `pig` se queda en `Connecting to ResourceManager` | YARN está apagado (`SERVICIOS=hdfs`): usá `pig -x local`, o recreá el contenedor con `SERVICIOS=mapreduce` o `todo` |
| `beeline` dice `Connection refused`             | HiveServer2 todavía arranca (~1 min) o `SERVICIOS` no es `todo`. Mirá `estado` |
| `sqoop` dice `Communications link failure`      | MySQL no está corriendo: recién prendido, o `SERVICIOS=hdfs`. Mirá `estado` y `/var/log/mysql/error.log` |
| `sqoop import` dice `No primary key could be found` | La tabla no tiene clave primaria: usá `-m 1` o `--split-by <columna>` |
| `sqoop export` falla con `Duplicate entry`      | La tabla ya tiene esas filas: vaciala antes (`TRUNCATE TABLE ...`) |
| Muchos `WARN` al correr `sqoop`                 | Normales (avisos de Hadoop y de la contraseña en la línea de comandos). Lo que importa es el final: `Transferred ...` / `Exported N records` |
| `Unable to load native-hadoop library`          | Warning normal; Hadoop usa la versión Java. No afecta          |
| `invalid characters for a local volume name`    | El `docker run` es de otra consola: usá el de tu consola (sección 1, paso 4) |
| `docker pull` dice `toomanyrequests`             | Se llegó al límite de descargas de Docker Hub sin cuenta (~100 cada 6 h por conexión). Esperá, entrá con una cuenta gratis (`docker login`) o pasala por pendrive (sección 5B) |
| `docker pull` dice `denied` o `not found`        | Revisá el nombre: `franki678/bigdata-sandbox` (sin guion en `franki678`) |

## Notas

- Sandbox de aprendizaje: corre como root, sin permisos HDFS ni seguridad. No
  usar para datos reales.
- Todos los nodos son procesos en la **misma máquina** y comparten el disco. La
  mecánica de bloques, réplicas, caídas y failover es la real de Hadoop, pero
  si se cae la compu se cae todo junto. Para aprender no cambia nada.
- Logs de los servicios dentro del contenedor:
  - `/opt/hadoop/logs/`: uno por proceso, por ejemplo `hadoop-dn2-datanode-*.log` o `hadoop-nn1-namenode-*.log`.
  - `/opt/hive/*.log`
  - `/opt/spark/logs/`
  - `/opt/zookeeper/logs/`
  - `/var/log/mysql/error.log`
- Se buildea desde los binarios oficiales de Apache, sin imágenes de terceros:
  sirve para amd64 (Intel/AMD) y ARM64 (Mac M1–M4). La imagen publicada trae
  las dos y Docker baja sola la que corresponde.
- Antes de publicar cada versión de la imagen, GitHub prende un cluster y corre
  `pruebas/probar.sh`: el tutorial entero, verificando que MapReduce, Pig, Hive
  y Spark den el resultado esperado, y que Sqoop traiga la tabla `ventas`
  completa y devuelva el resumen por categoría. Si algo falla, no se publica.
- Para que entre en una notebook:
  - Cada daemon tiene un tope de memoria chico y una JVM liviana (`sandbox/lib.sh`).
  - La imagen no trae lo que el cluster no usa: documentación, conectores a la nube, librerías de C, la copia de Hadoop que trae Pig (`Dockerfile`). Trae el JDK completo (y no solo el JRE) porque Sqoop compila una clase Java por cada tabla que copia.
  - MySQL arranca con poca memoria (`conf/mysql.cnf`): alcanza para la base de ejemplo y tablas de unos cientos de miles de filas.
  - `jps` es una versión propia, que además muestra la instancia de cada proceso (nn1, dn2...).
