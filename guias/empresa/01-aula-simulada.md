# 1. El aula simulada en una compu

Un maestro y dos "PCs" del aula, cada una un contenedor, en la misma red de
Docker y en una sola compu. Es el mismo cluster que se armaría con el
laboratorio, en chico: racks, réplicas repartidas, trabajos que corren en
varias PCs y una PC que se cae.

[Índice de `empresa`](README.md) · Siguiente: [2. Sumar PCs y cambiar variables →](02-sumar-pcs.md)

Necesitás **unos 8 GB de RAM libres** para Docker (10 GB para la sección 8,
con una tercera PC). Teoría de apoyo: [de pseudo-distribuido a
cluster](teoria/01-de-pseudo-a-cluster.md) y [réplicas y
racks](teoria/02-replicas-y-racks.md).

## Qué se arma

| Contenedor | `ROL` | Rack | Qué corre |
|---|---|---|---|
| `maestro` | `maestro` | `/profe` | NameNode + Secondary, ResourceManager, JobHistory, MariaDB (base `tienda` y Metastore de Hive), Hive Metastore + HiveServer2, Spark History y un DataNode `ARCHIVE` |
| `pc01` | `trabajador` | `/fila1` | DataNode + NodeManager |
| `pc02` | `trabajador` | `/fila1` | DataNode + NodeManager |

El archivo pone `PCS_POR_FILA=2`: pc01 y pc02 son la fila 1, una pc03 sería
la fila 2. Los nombres importan: con ellos se calculan los racks.

## 1. Arrancar

**Qué**: bajar el compose y levantar los tres contenedores.
**Por qué**: el archivo trae todo (la imagen hace el resto); no hace falta
el repo.

Abrí una terminal en una carpeta vacía (en Windows, PowerShell, con
`curl.exe` en lugar de `curl`):

<!-- prueba: compu -->
```bash
curl -fsSLO https://raw.githubusercontent.com/Franki-678/bigdata-sandbox/empresa/empresa/aula-simulada.yml
docker compose -f aula-simulada.yml up -d
```

La primera vez baja la imagen (~1,6 GB). Después el maestro tarda de 2 a 4
minutos en formatear HDFS, preparar MariaDB y el Metastore y subir las
librerías de Tez y Spark. Para mirar cómo va:

<!-- prueba: no (se queda mostrando los logs hasta que cortás con Ctrl+C) -->
```bash
docker compose -f aula-simulada.yml logs -f maestro
```

<!-- prueba: esperar listo maestro -->
<!-- prueba: esperar listo pc01 -->
<!-- prueba: esperar listo pc02 -->

**Qué tendría que salir**: en el log del maestro, al final, el cartel
`Cluster LISTO` y la tabla de `estado`. Cortá con Ctrl+C: el cluster sigue.
Las PCs también dicen `Cluster LISTO` cuando su DataNode ya está anotado en
el NameNode.

**Qué significa**: cada PC esperó a que el NameNode del maestro contestara
en `maestro:9000` y el ResourceManager en `maestro:8031` antes de prender
sus daemons. Si el maestro no aparece en 10 minutos, la PC se corta con un
error.

## 2. Ver la topología

**Qué**: preguntarle al cluster quién es quién.
**Por qué**: antes de mover datos conviene saber cuántos DataNodes y
NodeManagers hay y en qué rack quedó cada uno.

<!-- prueba: compu | espera: Cluster del aula -->
```bash
docker exec maestro estado
docker exec pc01 estado
```

**Qué tendría que salir**: en el maestro, `este nodo es maestro (ROL=maestro)`
y la lista de sus procesos (NameNode, Secondary, DataNode (archivo),
ResourceManager, JobHistory, MySQL, Hive, Spark History) con `arriba`; en
pc01, solo `DataNode` y `NodeManager` (`2048 MB para trabajos`). Abajo, lo
que dice el NameNode: `DataNodes vivos 3, muertos 0`.

Ahora, sentado en una PC del aula:

<!-- prueba: no (abre una consola adentro de pc01) -->
```bash
docker exec -it pc01 bash
```

<!-- prueba: adentro pc01 | espera: Rack: /profe | espera: Rack: /fila1 -->
```bash
hdfs dfsadmin -printTopology
```

**Qué tendría que salir**: dos racks, `Rack: /fila1` con pc01 y pc02, y
`Rack: /profe` con el maestro. Cada nodo aparece con su IP de la red de
Docker y su nombre (por ejemplo `pc01.aula`: el DNS de la red le suma el
nombre de la red).

**Qué significa**: el NameNode le pasó las direcciones de los DataNodes al
script `/opt/sandbox/bin/topologia`, que contesta un rack por cada una:
`maestro` va a `/profe`, `pcNN` va a la fila `(NN - 1) / PCS_POR_FILA + 1`.
Con eso HDFS puede dejar las copias de un bloque en más de un rack.

<!-- prueba: adentro pc01 | espera: Live datanodes (3) | espera: pc01:8041 -->
```bash
hdfs dfsadmin -report
yarn node -list
```

**Qué tendría que salir**: `-report` lista 3 DataNodes vivos con su
capacidad y su rack; `yarn node -list` lista 2 NodeManagers, `pc01:8041` y
`pc02:8041`, en estado `RUNNING`. El maestro no aparece en YARN: no tiene
NodeManager (eso cambia con `MAESTRO_NM=si`).

En el navegador de tu compu:

- NameNode, http://localhost:9870 → **Datanodes**: `maestro`, `pc01` y `pc02`.
- YARN, http://localhost:8088 → **Nodes**: `pc01` y `pc02`, con 2 GB cada uno.

## 3. Subir un archivo y ver dónde quedan los bloques

**Qué**: subir un archivo de 8 MB con bloques de 1 MB.
**Por qué**: con el bloque de fábrica (128 MB) sería un solo bloque; con
bloques chicos se corta en 8 y se ve el reparto.

<!-- prueba: adentro pc01 | espera: texto.txt -->
```bash
yes "hdfs yarn hive spark bloque rack fila profe" | head -c 8M > /tmp/texto.txt
hdfs dfs -mkdir -p /aula
hdfs dfs -D dfs.blocksize=1m -put -f /tmp/texto.txt /aula/texto.txt
hdfs dfs -ls -h /aula
```

`/aula` ya existe (la crea el maestro en el primer arranque, con permiso
para todos): el `-mkdir -p` no hace nada. En `-ls`, la segunda columna dice
`3`: la replicación.

Dónde quedó cada copia y de qué tipo es cada disco:

<!-- prueba: adentro pc01 | espera: Live_repl=3 | espera: ARCHIVE | espera: is HEALTHY -->
```bash
hdfs fsck /aula/texto.txt -files -blocks -locations
```

**Qué tendría que salir**: 8 bloques (`blk_...`), cada uno con
`Live_repl=3` y tres ubicaciones entre corchetes. Cada ubicación termina con
el tipo de disco: **una** dice `ARCHIVE` (el maestro) y dos dicen `DISK`
(pc01 y pc02). Al final, `is HEALTHY`.

Para contar: cada bloque tiene que tener exactamente una copia `ARCHIVE`.

<!-- prueba: adentro pc01 -->
```bash
hdfs fsck /aula/texto.txt -files -blocks -locations 2>/dev/null | grep 'blk_' | grep -o ARCHIVE | wc -l
```

Tiene que dar `8`: una copia por bloque en el maestro.

Ahora en qué rack quedó cada copia:

<!-- prueba: adentro pc01 | espera: /profe/ | espera: /fila1/ -->
```bash
hdfs fsck /aula/texto.txt -files -blocks -racks
```

**Qué tendría que salir**: las mismas ubicaciones, pero como `rack/ip:puerto`:
cada bloque tiene una en `/profe/...` y dos en `/fila1/...`. Ojo: con
`-racks`, fsck muestra el rack **en lugar** del tipo de disco; por eso se
miran por separado.

**Qué significa**: la raíz de HDFS tiene la política de almacenamiento
`WARM` (la puso el maestro en el primer arranque). `WARM` pide una copia en
`DISK` y el resto en `ARCHIVE`; como hay un solo DataNode `ARCHIVE`, la
tercera copia vuelve a `DISK`. Resultado: siempre una copia en la PC del
profe, y se puede apagar el aula entera sin perder nada. Ver [políticas y
tiers](teoria/04-politicas-de-almacenamiento.md).

<!-- prueba: adentro pc01 | espera: WARM -->
```bash
hdfs storagepolicies -getStoragePolicy -path /
hdfs storagepolicies -listPolicies
```

`/aula` y todo lo de abajo heredan la política de `/`.

## 4. Un trabajo repartido entre las PCs

**Qué**: un wordcount sobre el archivo de 8 bloques.
**Por qué**: cada bloque es un *split*, y cada split un *map*: 8 maps que
YARN reparte entre los NodeManagers de pc01 y pc02.

<!-- prueba: adentro pc01 | espera: completed successfully | espera: profe -->
```bash
hdfs dfs -rm -r -f -skipTrash /aula/conteo
yarn jar "$HADOOP_HOME"/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar wordcount /aula/texto.txt /aula/conteo
hdfs dfs -cat /aula/conteo/part-r-00000
```

**Qué tendría que salir**: el avance (`map 0% reduce 0%` ... `map 100%
reduce 100%`), `Job job_... completed successfully`, los contadores y, al
final, las 8 palabras con su cuenta.

Mientras corre, en http://localhost:8088 se ve el trabajo y, en **Nodes**,
la memoria usada de cada PC. En los contadores del final mirá:

- `Launched map tasks`: cuántos maps (uno por bloque; puede haber alguno
  más si YARN lanzó una copia especulativa de un map lento).
- `Data-local map tasks` y `Rack-local map tasks`: cuántos maps corrieron en
  una PC que **ya tenía** su bloque, y cuántos en otra PC del mismo rack.
  Con dos PCs y replicación 3, cada PC tiene una copia de cada bloque:
  todos deberían ser locales. Ver [localidad y YARN](teoria/05-localidad-y-yarn.md).

**En qué PC corrió cada map.** El JobHistory del maestro lo guarda. En el
navegador: http://localhost:19888 → el trabajo → **Map tasks** → cada tarea
→ columna **Node**. Lo mismo por la API REST del JobHistory, desde el
maestro:

<!-- prueba: adentro maestro | espera: pc0 -->
```bash
python3 - <<'PY'
import json, time, urllib.request
base = "http://localhost:19888/ws/v1/history/mapreduce/jobs"
def leer(u):
    return json.load(urllib.request.urlopen(base + u, timeout=10))
for _ in range(30):   # el JobHistory tarda unos segundos en anotar el trabajo
    trabajos = (leer("")["jobs"] or {}).get("job", [])
    if trabajos:
        break
    time.sleep(2)
ultimo = max(trabajos, key=lambda j: j["finishTime"])
print("trabajo", ultimo["id"], ultimo["name"])
for t in leer("/" + ultimo["id"] + "/tasks?type=m")["tasks"]["task"]:
    for a in leer("/" + ultimo["id"] + "/tasks/" + t["id"] + "/attempts")["taskAttempts"]["taskAttempt"]:
        print(t["id"], "->", a["nodeHttpAddress"].split(":")[0])
PY
```

**Qué tendría que salir**: una línea por map con la PC donde corrió:
`pc01` o `pc02`, nunca `maestro`. Es lo mismo que verifica la prueba
automática (`pruebas/aula.sh aula`): que los maps corran en más de una PC y
ninguno en el maestro.

## 5. Hive desde una PC, contra el maestro

**Qué**: crear una tabla y consultarla desde pc02.
**Por qué**: en el aula hay **un solo** HiveServer2 y un solo Metastore, en
el maestro; las PCs son clientes. El Metastore vive en MariaDB (no en
Derby, como en `base`) porque Derby embebido no aguanta varias sesiones a
la vez.

<!-- prueba: no (abre una consola adentro de pc02) -->
```bash
docker exec -it pc02 bash
```

<!-- prueba: adentro pc02 | espera: filas -->
```bash
beeline -u jdbc:hive2://maestro:10000 -n root --silent=true -e "
  CREATE TABLE IF NOT EXISTS aula_prueba (n INT);
  INSERT INTO aula_prueba VALUES (1), (2), (3);
  SELECT 'filas', COUNT(*) FROM aula_prueba;"
```

**Qué tendría que salir**: una fila `filas | 3`. El `INSERT` es un trabajo
de Tez sobre el YARN del aula: también se ve en http://localhost:8088.

La tabla quedó anotada en la base `metastore` de MariaDB, en el maestro:

<!-- prueba: adentro maestro | espera: aula_prueba -->
```bash
mysql -N -e "SELECT TBL_NAME FROM metastore.TBLS"
```

## 6. Spark desde una PC

**Qué**: calcular π con el ejemplo de Spark, sobre YARN.
**Por qué**: el *driver* corre en la PC donde lanzás el comando (modo
`client`) y los *executors* en contenedores de YARN en las PCs.

<!-- prueba: adentro pc02 | espera: Pi is roughly -->
```bash
spark-submit --master yarn --class org.apache.spark.examples.SparkPi "$SPARK_HOME"/examples/jars/spark-examples_*.jar 20
```

**Qué tendría que salir**: entre los logs, `Pi is roughly 3.14...`. Al
terminar, en el Spark History del maestro (http://localhost:18080) aparece
la aplicación; en su pestaña **Executors** se ve en qué PC corrió cada
executor.

## 7. Una PC que se cae

Teoría: [fallas](teoria/03-fallas.md).

**Qué**: apagar pc02 de golpe, como si la desenchufaran.
**Por qué**: en un cluster real las máquinas se caen; HDFS tiene que darse
cuenta solo y seguir sirviendo los datos.

Desde tu compu (salí de la PC con `exit`):

<!-- prueba: compu | espera: pc02 marcada muerta -->
```bash
docker kill pc02
for i in $(seq 1 40); do
  docker exec maestro curl -s 'http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name=FSNamesystemState' \
    | grep -q '"NumDeadDataNodes" : 1' && break
  sleep 3
done
echo "pc02 marcada muerta despues de unos $((i * 3)) s"
docker exec maestro estado
```

**Qué tendría que salir**: a los ~40 segundos el NameNode la da por muerta
(en http://localhost:9870 → **Datanodes** pasa a *Dead*). `estado` dice
`DataNodes vivos 2, muertos 1` y `sub-replicados` mayor que 0.

**Qué significa**: los DataNodes mandan un *heartbeat* cada 3 s
(`dfs.heartbeat.interval`) y el NameNode revisa cada 5 s
(`dfs.namenode.heartbeat.recheck-interval`). Un nodo se da por muerto a los
`2 × 5 + 10 × 3 = 40` s. De fábrica, Hadoop tarda 10 minutos y medio; esta
imagen lo acorta para verlo en clase.

Con solo dos PCs **no hay otro DataNode** donde hacer la tercera copia: los
bloques quedan **sub-replicados** (2 copias de 3), pero el archivo se sigue
leyendo entero.

<!-- prueba: compu | espera: 8388608 | espera: is HEALTHY -->
```bash
docker exec pc01 bash -c "hdfs dfs -cat /aula/texto.txt | wc -c"
docker exec maestro hdfs fsck /
```

**Qué tendría que salir**: `8388608` (los 8 MB, completos) y, en el fsck,
`Under-replicated blocks:` con un número mayor que 0, pero igual
`The filesystem under path '/' is HEALTHY`.

**Qué significa**: `HEALTHY` quiere decir que **no se perdió ningún
bloque** (ninguno *missing* ni *corrupt*). Un bloque sub-replicado está
sano; solo está más expuesto. Ojo con YARN: tiene su propio tiempo para dar
por perdido a un NodeManager (10 minutos de fábrica, y esta imagen no lo
cambia), así que en http://localhost:8088 pc02 puede seguir figurando un
rato.

Prendé pc02 otra vez:

<!-- prueba: compu -->
```bash
docker start pc02
```

<!-- prueba: esperar listo pc02 -->

<!-- prueba: compu | espera: sub-replicados 0 -->
```bash
for i in $(seq 1 60); do
  docker exec maestro curl -s 'http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name=FSNamesystemState' \
    | grep -q '"UnderReplicatedBlocks" : 0' && break
  sleep 2
done
docker exec maestro estado
```

**Qué tendría que salir**: `DataNodes vivos 3, muertos 0` y
`sub-replicados 0`. pc02 volvió con sus bloques intactos en su volumen: su
DataNode le manda al NameNode la lista de bloques que tiene (*block report*)
y las copias vuelven a contar.

## 8. Con una tercera PC: re-replicación y sobre-replicación

**Qué**: sumar `pc03` (fila 2) y repetir la caída.
**Por qué**: con cuatro DataNodes y replicación 3 sí hay dónde hacer la
copia que falta: se ve a HDFS **re-replicar** solo, y al volver la PC caída,
borrar las copias de más (**sobre-replicación**). Necesita ~2 GB más de RAM.

En lugar de editar `aula-simulada.yml`, un segundo archivo de compose suma
la PC (Compose junta los dos):

<!-- prueba: compu -->
```bash
cat > aula-pc03.yml <<'EOF'
services:
  pc03:
    image: franki678/bigdata-sandbox:empresa
    container_name: pc03
    hostname: pc03
    environment:
      ROL: trabajador
      MAESTRO: maestro
      PCS_POR_FILA: "2"
    networks: [aula]
    depends_on: [maestro]
    stop_grace_period: 20s
    volumes:
      - pc03:/hadoop

volumes:
  pc03:
EOF
docker compose -f aula-simulada.yml -f aula-pc03.yml up -d
```

<!-- prueba: esperar listo pc03 -->

<!-- prueba: compu | espera: Rack: /fila2 -->
```bash
docker exec maestro hdfs dfsadmin -printTopology
```

pc03 quedó sola en `/fila2`. Ahora otra vez, pc02 se cae:

<!-- prueba: compu | espera: sub-replicados 0 -->
```bash
docker kill pc02
for i in $(seq 1 40); do
  docker exec maestro curl -s 'http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name=FSNamesystemState' \
    | grep -q '"NumDeadDataNodes" : 1' && break
  sleep 3
done
echo "pc02 marcada muerta despues de unos $((i * 3)) s"
for i in $(seq 1 100); do
  docker exec maestro curl -s 'http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name=FSNamesystemState' \
    | grep -q '"UnderReplicatedBlocks" : 0' && break
  sleep 3
done
echo "sin bloques sub-replicados despues de unos $((i * 3)) s mas"
docker exec maestro estado
```

**Qué tendría que salir**: pc02 muerta a los ~40 s y, al rato, `sub-replicados
0` con pc02 todavía apagada.

**Qué significa**: el NameNode buscó, para cada bloque que tenía una copia
en pc02, otro DataNode sin esa copia (pc03) y le pidió a uno de los que sí
la tienen que se la mande. Mirá dónde quedaron:

<!-- prueba: compu | espera: Live_repl=3 -->
```bash
docker exec maestro hdfs fsck /aula/texto.txt -files -blocks -racks
```

Las copias que estaban en pc02 ahora están en pc03 (`/fila2/...`).

Prendé pc02 otra vez:

<!-- prueba: compu -->
```bash
docker start pc02
```

<!-- prueba: esperar listo pc02 -->

<!-- prueba: compu | espera: is HEALTHY -->
```bash
docker exec maestro hdfs fsck / | grep -E 'Over-replicated|Under-replicated|HEALTHY'
for i in $(seq 1 100); do
  docker exec maestro hdfs fsck / 2>/dev/null | grep -Eq 'Over-replicated blocks:[[:space:]]+0 ' && break
  sleep 3
done
docker exec maestro hdfs fsck / | grep -E 'Over-replicated|Under-replicated|HEALTHY'
```

**Qué tendría que salir**: si llegás a tiempo, el primer fsck muestra
`Over-replicated blocks:` mayor que 0; el último, `Over-replicated blocks: 0`
y `HEALTHY`.

**Qué significa**: pc02 volvió con sus copias viejas en el disco: varios
bloques tienen 4 copias para una replicación de 3. El NameNode elige cuál
sobra (cuidando que sigan en más de un rack) y le pide a ese DataNode que la
borre.

## 9. Apagar y borrar

Para apagar sin perder nada (los volúmenes quedan):

<!-- prueba: no (apaga sin borrar; la guía sigue con el borrado) -->
```bash
docker compose -f aula-simulada.yml -f aula-pc03.yml stop
```

Al volver a prender con `up -d`, todo sigue como estaba.

Para borrar todo, contenedores **y volúmenes** (los datos de HDFS, MariaDB
y el Metastore):

<!-- prueba: compu -->
```bash
docker compose -f aula-simulada.yml -f aula-pc03.yml down -v
```

Si no sumaste pc03, alcanza con `docker compose -f aula-simulada.yml down -v`.
La imagen queda bajada: el próximo `up -d` no la vuelve a bajar.

## Resumen

| Querés ver | Comando |
|---|---|
| Qué corre en un nodo | `docker exec maestro estado` (o `pc01`...) |
| Los racks | `hdfs dfsadmin -printTopology` |
| DataNodes y NodeManagers | `hdfs dfsadmin -report`, `yarn node -list` |
| Dónde está cada copia y de qué tipo | `hdfs fsck <ruta> -files -blocks -locations` |
| En qué rack está cada copia | `hdfs fsck <ruta> -files -blocks -racks` |
| La política de almacenamiento | `hdfs storagepolicies -getStoragePolicy -path /` |
| En qué PC corrió cada map | http://localhost:19888 → el trabajo → **Map tasks** |

Más comandos y todas las variables en la [referencia](referencia.md).

[Índice de `empresa`](README.md) · Siguiente: [2. Sumar PCs y cambiar variables →](02-sumar-pcs.md)
