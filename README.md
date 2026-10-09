# BigData Sandbox — Hadoop + Hive + Spark en un solo contenedor

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
| **MapReduce** + JobHistory        | El clásico wordcount y compañía                 |
| **Hive 4** (Metastore + HiveServer2, sobre Tez) | SQL sobre HDFS                    |
| **Spark 3.5** + PySpark + History Server | Procesamiento en memoria, corre sobre YARN |

Hive y Spark comparten el mismo metastore: una tabla creada en uno se ve en el
otro. Todos los datos viven en HDFS.

Versiones: Hadoop 3.3.6 · Hive 4.0.0 · Tez 0.10.3 · Spark 3.5.9 ·
ZooKeeper 3.8.7 · Java 8 · Python 3.8

---

## 1. Requisitos

- **Docker Desktop** (Windows/Mac) o Docker Engine (Linux).
- **RAM asignada a Docker** (Docker Desktop: *Settings → Resources → Memory*):
  - Con todo prendido (por defecto): **6 GB**.
  - Con alta disponibilidad (`NAMENODES=2` o más): **8 GB**.
  - Solo HDFS (`SERVICIOS=hdfs`, ver sección 3): **4 GB** alcanzan.
  - Cada DataNode extra suma ~250 MB.
  - Lo que usa en cada momento: `docker stats bigdata`.
- ~3 GB de disco para la imagen.

## 2. Crear la imagen (una sola vez)

Desde la carpeta del repo:

```bash
docker build -t bigdata-sandbox .
```

- `bigdata-sandbox` es el **nombre de la imagen**. Con ese nombre la vas a llamar
  después.
- Tarda ~5 min la primera vez (baja ~1,5 GB de Apache). Si cambiás algo y la
  volvés a buildear, reusa lo ya bajado.

## 3. Crear el contenedor (una sola vez)

**Mac / Linux:**

```bash
docker run -d --name bigdata \
  -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=32m \
  -p 9870-9872:9870-9872 -p 9868:9868 -p 9901-9909:9901-9909 -p 8480-8482:8480-8482 \
  -p 8088:8088 -p 8042:8042 -p 19888:19888 \
  -p 10000:10000 -p 10002:10002 -p 18080:18080 -p 4040:4040 \
  -v bigdata_hadoop:/hadoop \
  -v "$(pwd)/datos:/datos" \
  bigdata-sandbox
```

**Windows (PowerShell), en una sola línea:**

```powershell
docker run -d --name bigdata -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=32m -p 9870-9872:9870-9872 -p 9868:9868 -p 9901-9909:9901-9909 -p 8480-8482:8480-8482 -p 8088:8088 -p 8042:8042 -p 19888:19888 -p 10000:10000 -p 10002:10002 -p 18080:18080 -p 4040:4040 -v bigdata_hadoop:/hadoop -v "${PWD}/datos:/datos" bigdata-sandbox
```

Qué es cada parte:

| Parte                          | Significado                                                        |
|--------------------------------|--------------------------------------------------------------------|
| `--name bigdata`               | Nombre del **contenedor**. Con ese nombre lo manejás de acá en más |
| `-e DATANODES=3` …             | La arquitectura de HDFS (ver abajo). Si no ponés ninguno, todo vale 1 |
| `-p 9870-9872:9870-9872` …     | Expone cada página web en tu compu (`localhost:9870`, etc.). Van todos los puertos posibles, uses o no esos nodos |
| `-v bigdata_hadoop:/hadoop`    | Volumen donde viven HDFS y el metastore: **tus datos persisten**   |
| `-v .../datos:/datos`          | La carpeta `datos/` del repo aparece adentro como `/datos`         |
| `bigdata-sandbox`              | La imagen que creaste en el paso 2                                 |

### Parámetros de la arquitectura

| Parámetro     | Qué elige                                   | Por defecto | Valores          |
|---------------|---------------------------------------------|-------------|------------------|
| `DATANODES`   | Cantidad de DataNodes (procesos que guardan los bloques) | 1 | 1 a 9   |
| `NAMENODES`   | Cantidad de NameNodes. Con 2 o más se arma **alta disponibilidad**: uno *active*, el resto *standby*, y si el activo se cae otro toma el control solo | 1 | 1 a 3 |
| `REPLICATION` | Copias de cada bloque, cada una en un DataNode distinto | 1 | 1 a 9 |
| `BLOCK_SIZE`  | Tamaño de bloque: un archivo se parte en bloques de este tamaño | 128m | `1m`, `32m`, `128m`, `1g`… (mínimo 1m) |
| `SERVICIOS`   | Qué se prende además de HDFS (ver abajo)    | todo        | `hdfs`, `mapreduce`, `todo` |

Ejemplos:

```bash
# Todo por defecto: 1 NameNode (+ Secondary), 1 DataNode, replicación 1, bloque 128m
docker run -d --name bigdata <puertos y volúmenes> bigdata-sandbox

# Para ver replicación: 3 DataNodes, cada bloque en 2 de ellos, bloques chicos
docker run -d --name bigdata -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m <...> bigdata-sandbox

# Alta disponibilidad: 2 NameNodes + 3 DataNodes con replicación 3
docker run -d --name bigdata -e NAMENODES=2 -e DATANODES=3 -e REPLICATION=3 <...> bigdata-sandbox

# Clase de HDFS: solo HDFS, liviano y rápido de arrancar
docker run -d --name bigdata -e SERVICIOS=hdfs -e DATANODES=3 -e REPLICATION=2 <...> bigdata-sandbox
```

`SERVICIOS` elige qué capas del stack se prenden, para no gastar memoria en lo
que la clase no usa:

| `SERVICIOS` | Qué corre                                          |
|-------------|----------------------------------------------------|
| `hdfs`      | Solo HDFS (NameNodes, DataNodes y compañía). El más liviano y el que más rápido arranca |
| `mapreduce` | HDFS + YARN + MapReduce (wordcount, JobHistory)    |
| `todo`      | Lo anterior + Hive + Spark (por defecto). Hive es lo que más tarda en arrancar (~1 min) |

Se cambia como los demás: recreando el contenedor. Los datos de HDFS y las
tablas de Hive quedan en el volumen y vuelven cuando prendés `todo` otra vez.

Para **cambiar** la arquitectura, borrás el contenedor y lo volvés a crear con
otros `-e` (los datos quedan en el volumen):

```bash
docker rm -f bigdata
docker run -d --name bigdata -e DATANODES=4 ... bigdata-sandbox
```

- `DATANODES`, `REPLICATION` y `BLOCK_SIZE` se pueden cambiar cuando quieras.
  La replicación y el bloque nuevos aplican a los archivos que subas desde ese
  momento. Los archivos viejos se cambian con `hdfs dfs -setrep`.
- `NAMENODES` queda fijo cuando se crea el volumen: pasar de 1 a 2 cambia cómo
  se guardan los metadatos. Para cambiarlo, empezá de cero (sección 8).
- Si bajás `DATANODES` y los nodos que sacaste tenían la única copia de algún
  bloque, esos bloques se pierden. Igual que en un cluster de verdad.

### Seguir el arranque

```bash
docker logs -f bigdata
```

Cuando aparece el cartel **"Cluster LISTO"**, está todo arriba (~1-2 min la
primera vez). Abajo del cartel ves la arquitectura completa, con cada proceso,
su estado y su página web. Salís del log con `Ctrl+C`; el contenedor sigue
corriendo.

## 4. Uso diario

```bash
docker stop bigdata        # apagar (los datos quedan guardados)
docker start bigdata       # volver a prender (~1-2 min hasta el cartel LISTO)
docker exec -it bigdata bash   # abrir una terminal ADENTRO del cluster
```

No vuelvas a hacer `docker run` cada día: eso crea **otro** contenedor (y falla
porque el nombre `bigdata` ya existe). `docker run` es una sola vez; después,
`start`/`stop`.

Al reiniciar, HDFS se queda unos segundos en *safe mode* revisando los bloques.
Es normal en Hadoop; el script espera solo.

## 5. Ver la arquitectura

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
| YARN ResourceManager  | http://localhost:8088       | Todos los trabajos: MapReduce, TEZ (Hive), SPARK |
| YARN NodeManager      | http://localhost:8042       | Contenedores corriendo                       |
| MapReduce JobHistory  | http://localhost:19888      | Trabajos MapReduce terminados y sus logs     |
| HiveServer2           | http://localhost:10002      | Sesiones y queries de Hive                   |
| Spark History         | http://localhost:18080      | Trabajos de Spark terminados                 |
| Spark (trabajo activo)| http://localhost:4040       | Solo mientras corre un spark-shell/pyspark   |

Los links entre páginas (por ejemplo, de la lista de DataNodes del NameNode a
la página de cada DataNode) apuntan a `localhost` y funcionan desde el
navegador.

## 6. Experimentos de arquitectura

Todos adentro del contenedor. Los ejemplos suponen `DATANODES=3`,
`REPLICATION=2` y `BLOCK_SIZE=1m`, pero andan con cualquier combinación.

### Bloques y réplicas

```bash
seq 1 1000000 > numeros.txt                  # archivo de ~7 MB en datos/
hdfs dfs -put numeros.txt /user/root/
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
DataNode 2 ya no aparece y todos los bloques siguen con 2 réplicas.

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
namenode              # nn1 active, nn2 standby
namenode stop 1       # se cae el activo
namenode              # a los ~2 s: nn2 active
hdfs dfs -ls /        # HDFS sigue andando, y Hive y Spark también
namenode start 1      # vuelve como standby
```

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

## 7. Ejemplos

Todos se corren **adentro** del contenedor (`docker exec -it bigdata bash`).
Arrancás parado en `/datos`, o sea, en la carpeta `datos/` de tu compu.

### HDFS

```bash
hdfs dfs -put ventas.csv /user/root/          # subir un archivo de datos/ a HDFS
hdfs dfs -ls /user/root
hdfs fsck /user/root/ventas.csv -files -blocks -locations   # en qué bloques quedó
hdfs dfsadmin -report                         # estado del cluster, DataNode por DataNode
```

### MapReduce (wordcount)

```bash
hdfs dfs -put texto.txt /user/root/
hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar \
  wordcount /user/root/texto.txt /user/root/wc-out
hdfs dfs -cat /user/root/wc-out/part-r-00000
```

### Hive

```bash
beeline -u jdbc:hive2://localhost:10000
```

```sql
CREATE TABLE demo (id INT, nombre STRING);
INSERT INTO demo VALUES (1, 'hola'), (2, 'bigdata');
SELECT * FROM demo;
```

Desde DBeaver u otro cliente en tu compu: `jdbc:hive2://localhost:10000`, sin
usuario ni contraseña.

### Spark

```bash
spark-shell     # Scala
pyspark         # Python
spark-sql       # SQL; ve las mismas tablas que Hive
```

```python
# dentro de pyspark
df = spark.read.csv("hdfs:///user/root/ventas.csv", header=True, inferSchema=True)
df.groupBy("producto").count().show()
df.write.saveAsTable("ventas")      # queda como tabla de Hive, en HDFS
spark.sql("SELECT * FROM demo").show()   # lee la tabla creada en Hive
```

Un script entero (lo dejás en `datos/`):

```bash
spark-submit mi_script.py
```

Todo Spark corre sobre YARN: cada sesión aparece en http://localhost:8088 como
aplicación SPARK y, al terminar, en http://localhost:18080.

### Logs de cualquier trabajo

```bash
yarn application -list -appStates ALL
yarn logs -applicationId <application_id>
```

## 8. Empezar de cero

Borra el contenedor y **todos los datos** de HDFS y Hive:

```bash
docker rm -f bigdata
docker volume rm bigdata_hadoop
```

Después repetís el paso 3 (con los `-e` que quieras).

## 9. Problemas comunes

| Síntoma                                         | Causa / solución                                              |
|-------------------------------------------------|---------------------------------------------------------------|
| `port is already allocated` o, en Windows, `access permissions` / `forbidden` | Otro programa (o Windows) usa ese puerto: cambiá el de la izquierda (ej. `-p 18888:8088`) o sacá ese `-p` si no usás ese nodo |
| El contenedor termina con `[sandbox] ERROR: ...` | Un parámetro mal puesto: el mensaje dice cuál. Corregilo y recreá el contenedor |
| `AVISO: este volumen se creo con N NameNode(s)` | `NAMENODES` no se cambia sobre un volumen existente (sección 3) |
| Queries o Spark quedan en `ACCEPTED` sin avanzar | Falta memoria en YARN: cerrá sesiones de beeline/pyspark abiertas, o dale más RAM a Docker |
| El contenedor se cae solo                       | Poca RAM en Docker (ver requisitos). Mirá `docker logs bigdata` |
| Abrí un 2º pyspark y la UI no está en :4040     | La segunda sesión usa :4041, que no está expuesto. Usá :8088 → *ApplicationMaster* |
| `Unable to load native-hadoop library`          | Warning normal; Hadoop usa la versión Java. No afecta          |

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
- Se buildea desde los binarios oficiales de Apache, sin imágenes de terceros:
  sirve para amd64 (Intel/AMD) y ARM64 (Mac M1–M4).
- Para que entre en una notebook:
  - Cada daemon tiene un tope de memoria chico y una JVM liviana (`sandbox/lib.sh`).
  - La imagen usa el runtime de Java (JRE) y no trae lo que el cluster no usa: documentación, conectores a la nube, librerías de C (`Dockerfile`).
  - `jps` es una versión propia, porque el JRE no lo trae.
