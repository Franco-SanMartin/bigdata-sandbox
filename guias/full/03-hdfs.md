# 3. HDFS desde la interfaz

Subir un archivo, ver en qué bloques se partió y en qué DataNodes quedó cada
copia, cambiar la réplica, revisar la salud con `fsck` y mirar la cola de
re-replicación cuando se cae un DataNode. Es la
[guía 3 de la materia](../03-hdfs.md) vista desde adentro del NameNode.

[← 2. El panel del cluster](02-cluster-y-sinoptico.md) · [Índice de full](README.md) · Siguiente: [4. YARN y los trabajos →](04-trabajos-yarn.md)

La pantalla es **HDFS** (`G H`). Los comandos equivalentes van **adentro** del
contenedor (`docker exec -it bigdata-full bash`), parado en `/datos`.

## Paso 1. La pantalla y sus pestañas

**Qué se ve.** El título *HDFS* con una etiqueta de salud: **sano**, **N
bloques sub-replicados**, **N DataNodes caídos**, **N bloques perdidos**,
**safe mode** o **NameNode no responde**. A la derecha, el botón **Subir**.
Tres pestañas:

- **Archivos**: el árbol de carpetas, la lista y el detalle del archivo
  elegido.
- **Salud**: la cola de re-replicación y `fsck` (con un contador si hay
  problemas).
- **DataNodes**: uno por fila, con sus bloques y su latido.

Con el cluster apagado, la pantalla dice qué vas a poder hacer ("Subir
archivos (ejemplos o de tu compu) y ver cómo se parten en bloques", "Ver,
bajar, mover y borrar lo que dejan los trabajos", "Apagar un DataNode y mirar
cómo HDFS re-replica las copias").

**Qué significa.** La etiqueta sale del JMX del NameNode
(`UnderReplicatedBlocks`, `MissingBlocks`, el modo seguro) y de la lista de
DataNodes vivos y muertos (`NameNodeInfo`).

## Paso 2. Recorrer carpetas

**Qué hacer.** En **Archivos**, entrá a `/user/root`.

**Qué se ve.** Arriba, la ruta como migas (`/` › `user` › `root`), el filtro
"Filtrar por nombre", **Crear carpeta** y **Recargar**. La lista tiene
Nombre, Tamaño (en carpetas, "N adentro"), Réplica, Bloques ("N × 1 MB"),
Estado (*escribiendo*, *faltan copias*, *sin copias*; nada si está sano) y
Modificado.

Una carpeta vacía ofrece **Subir ventas_grandes.csv de ejemplo**, **Subir
desde tu compu** y **Crear carpeta** ("También podés soltar un archivo acá
encima.").

**Qué significa.** La lista sale de WebHDFS `LISTSTATUS` del NameNode activo;
los bloques y las réplicas, de un `fsck` que el servidor guarda y renueva
solo cuando algo cambió.

**En la terminal.**

<!-- prueba: adentro | espera: /user/root -->
```bash
hdfs dfs -ls /user/root
```

<!-- prueba: adentro | espera: FileStatuses -->
```bash
curl -s "http://localhost:9870/webhdfs/v1/user/root?op=LISTSTATUS"
```

## Paso 3. Subir un archivo

**Qué hacer.** **Subir** → **Un ejemplo** → `ventas_grandes.csv` (5,9 MB).
Dejá la réplica en *2 (la del cluster)* y el bloque vacío.

**Qué se ve.** El diálogo "Subir a /user/root" muestra los ejemplos
(`ventas_grandes.csv` 5,9 MB, `ventas_sucias.csv` 4,5 MB, `numeros.txt` 6,6 MB,
`clientes_senal.csv` 0,7 MB, `texto.txt` 138 bytes), las opciones **Réplica**
y **Tamaño de bloque**, y abajo el **Comando** que va a correr. Con **De tu
compu** se suelta un archivo o se elige con **Elegir archivo**.

Al subir, el archivo aparece como *escribiendo* y, en el sinóptico de
Cluster, las fichas de sus bloques van llenando los DataNodes.

**Qué significa.** Con bloques de 1 MB, 5,9 MB son 6 bloques; con réplica 2,
12 copias repartidas entre los DataNodes. El NameNode elige dónde va cada
copia; el cliente (`hdfs dfs -put`) le manda los datos al primer DataNode y
ese al segundo, en cadena.

**En la terminal.** Lo que muestra el diálogo (el ejemplo se genera si falta):

<!-- prueba: no (escribe en HDFS; lo mismo corre la guía 3 de la materia) -->
```bash
hdfs dfs -mkdir -p /user/root
hdfs dfs -put -f ventas_grandes.csv /user/root/
```

Con réplica o bloque distintos de los del cluster, el comando suma `-D
dfs.replication=N` y `-D dfs.blocksize=X` antes de `-put`.

## Paso 4. El mapa de bloques

**Qué hacer.** Hacé clic en `ventas_grandes.csv`.

**Qué se ve.** El panel de detalle: **Ver**, **Bajar**, **Réplica 2**,
**Mover** y **Borrar**; los datos Ruta, Tamaño, Bloques ("6 de hasta 1 MB"),
Copias ("12 de 12 (réplica 2)"), Lo escribió, Modificado y Permisos. Abajo,
**Bloques en los DataNodes**: una fila por bloque (#, nombre `blk_…`, tamaño)
y una columna por DataNode, con una marca donde hay copia, y la cuenta
*copias / réplica* al final (verde si está completa, ámbar si faltan, rojo si
no hay ninguna). Más abajo, el `fsck` de ese archivo, crudo.

**Qué significa.** Es la vista que en la terminal da `fsck` con
`-files -blocks -locations`: cada bloque con sus ubicaciones. *Lo escribió* lo
deduce el servidor por la ruta (por ejemplo, `/user/hive/warehouse/…` es
Hive, `part-r-00000` es MapReduce): HDFS no guarda qué programa escribió un
archivo.

**En la terminal.**

<!-- prueba: no (necesita ventas_grandes.csv subido en el paso anterior) -->
```bash
hdfs fsck /user/root/ventas_grandes.csv -files -blocks -locations
```

Una salida real, de las pruebas de la imagen, con un archivo de 1 MB y algo,
bloque de 1 MB y réplica 2 (dos bloques, cada uno en los DataNodes de los
puertos 9911 y 9912):

```text
/user/root/humo/humo.csv 1068911 bytes, replicated: replication=2, 2 block(s):  OK
0. BP-1325415372-172.17.0.3-1792695233636:blk_1073741825_1001 len=1048576 Live_repl=2  [DatanodeInfoWithStorage[127.0.0.1:9911,DS-5eac9965-37cf-409b-a4e7-270cfd549239,DISK], DatanodeInfoWithStorage[127.0.0.1:9912,DS-8afe0183-3a3d-4fce-9603-8a792e32a693,DISK]]
1. BP-1325415372-172.17.0.3-1792695233636:blk_1073741826_1002 len=20335 Live_repl=2  [DatanodeInfoWithStorage[127.0.0.1:9911,DS-5eac9965-37cf-409b-a4e7-270cfd549239,DISK], DatanodeInfoWithStorage[127.0.0.1:9912,DS-8afe0183-3a3d-4fce-9603-8a792e32a693,DISK]]
```

## Paso 5. Ver el contenido

**Qué hacer.** **Ver**.

**Qué se ve.** Los primeros 64 KB, como **Tabla** (si es CSV) o **Texto**,
con "Leídos X de Y · N %" y el botón **Leer 64 KB más** (o "Es todo el
archivo"). Un archivo binario (Parquet, jar, comprimido) avisa que no se puede
mostrar; uno vacío como `_SUCCESS` explica que es la marca que deja un
trabajo cuando termina bien.

**En la terminal.**

<!-- prueba: no (necesita ventas_grandes.csv subido) -->
```bash
hdfs dfs -cat /user/root/ventas_grandes.csv | head -5
```

## Paso 6. Bajar, mover y borrar

- **Bajar** descarga el archivo al navegador. Equivale a `hdfs dfs -get`.
- **Mover** pide la nueva ruta. "No se copian datos: el NameNode solo cambia
  la ruta." Equivale a `hdfs dfs -mv`.
- **Borrar** confirma: "Se borra sin pasar por la papelera (hdfs dfs -rm
  -skipTrash). Los DataNodes liberan sus bloques."

<!-- prueba: no (mueve y borra archivos de HDFS) -->
```bash
hdfs dfs -get /user/root/ventas_grandes.csv /datos/
hdfs dfs -mv /user/root/ventas_grandes.csv /user/root/ventas_copia.csv
hdfs dfs -rm -skipTrash /user/root/ventas_copia.csv
```

**Qué significa.** Mover es instantáneo aunque el archivo pese gigas: solo
cambia un dato en el NameNode. Borrar sin papelera libera el espacio enseguida.

## Paso 7. Cambiar la réplica

**Qué hacer.** **Réplica 2** → subí a 3 → **Aplicar**.

**Qué se ve.** El diálogo muestra "copias por bloque · hay N DataNodes vivos",
el **Comando** (`hdfs dfs -setrep 3 …`) y *Copias antes → después*. Si pedís
más copias que DataNodes vivos avisa: "Con N DataNodes no entran M copias: …
sub-replicados hasta que sumes nodos." Si bajás la réplica: "El NameNode borra
las copias que sobran de los DataNodes más llenos."

Al aplicar, en el mapa de bloques aparecen las copias nuevas, marcadas un
momento como *recién copiada*.

**En la terminal.**

<!-- prueba: no (cambia la réplica de un archivo) -->
```bash
hdfs dfs -setrep 3 /user/root/ventas_grandes.csv
```

**Qué significa.** La réplica es **por archivo**: `REPLICATION` es solo el
valor por defecto para lo que se escribe. Cambiarla no reescribe nada; el
NameNode encola las copias que faltan (o las que sobran, para borrar).

## Paso 8. La pestaña Salud: fsck

**Qué hacer.** Pestaña **Salud** → panel **fsck** → **Correr** (con `/` o
con **esta carpeta**).

**Qué se ve.** Antes de correr: "Sin correr todavía. No lee los datos: le
pregunta al NameNode dónde está cada copia." Después, la etiqueta **HEALTHY**
o **CORRUPT** y los datos Ruta, Tamaño, Bloques, Copias de menos, Copias de
más, Perdidos y Réplica (promedio · por defecto · DataNodes vivos). Si hay
bloques con problemas, una tabla (copias de menos, copias de más, perdido,
corrupto); si no, "Ningún bloque con problemas". Al final, la salida completa.

Arriba de la pestaña, cinco números: DataNodes vivos, Archivos, Ocupado,
Sub-replicados y Perdidos.

**En la terminal.**

<!-- prueba: adentro | espera: Status: HEALTHY -->
```bash
hdfs fsck /
```

El final de una salida real de las pruebas:

```text
Status: HEALTHY
 Number of data-nodes:	2
 Number of racks:		1
 Total dirs:			11
 Total symlinks:		0

Replicated Blocks:
 Total size:	1068911 B
 Total files:	1
 Total blocks (validated):	2 (avg. block size 534455 B)
 Minimally replicated blocks:	2 (100.0 %)
 Over-replicated blocks:	0 (0.0 %)
 Under-replicated blocks:	0 (0.0 %)
 Mis-replicated blocks:		0 (0.0 %)
 Default replication factor:	2
 Average block replication:	2.0
 Missing blocks:		0
 Corrupt blocks:		0
 Missing replicas:		0 (0.0 %)
 Blocks queued for replication:	0
```

**Qué significa.** *HEALTHY* quiere decir que **ningún bloque se perdió**, no
que estén todas las copias: un archivo con copias de menos sigue siendo
HEALTHY (ver [teoría: salud de HDFS](teoria/salud-hdfs.md)).

## Paso 9. La re-replicación en vivo

**Qué hacer.** Dejá abierta la pestaña **Salud** y, desde **DataNodes** (o
desde Cluster), apagá un DataNode que tenga bloques.

**Qué se ve.** El panel **Re-replicación** ("cola del NameNode · en vivo")
con una curva y cuatro números: sub-replicados, en la cola, perdidos y copias
de más.

1. Primero, un aviso: "DataNode N sin latidos. El NameNode lo da por muerto en
   N s y recién ahí encola sus bloques."
2. A los 40 s, la tabla **Cola de re-replicación** se llena: Tarea (copiar o
   borrar copia), Bloque, Archivo, De → a (por ejemplo *DN 1 → DN 3*) y
   Estado (*en cola*, *copiando*, *hecha*).
3. Al costado, **Copias recientes** va listando lo que ya se copió.

Si pediste más copias que DataNodes vivos, esos bloques quedan sub-replicados
y **no** entran en la cola: no hay adónde copiarlos.

**Qué significa.** El NameNode no copia nada mientras el DataNode solo está
callado (podría volver); recién cuando lo da por muerto encola sus bloques y
le pide a un DataNode que tenga otra copia que la mande a uno que no la tenga.

**En la terminal.**

<!-- prueba: no (apaga un DataNode) -->
```bash
datanode stop 2
sleep 45
hdfs dfsadmin -report | grep -E 'Live datanodes|Dead datanodes|Under replicated'
hdfs fsck / | grep -E 'Under-replicated|queued'
datanode start 2
```

## Paso 10. La pestaña DataNodes

**Qué se ve.** "N de M vivos" y, por cada DataNode, su estado (*vivo*, *sin
latidos*, *muerto*, *arrancando*, *apagado*), "latido hace…" (o "muerto en N
s"), cuántos bloques tiene y cuánto ocupa con un medidor, y el botón para
apagarlo o prenderlo. Arriba, **Sumar** ("datanode start N: se suma vacío, en
caliente"), hasta 9.

**Qué significa.** Un DataNode nuevo entra **vacío**: HDFS no reparte solo lo
que ya estaba (para eso existe el *balancer*). Lo que se escriba después sí
puede ir ahí.

**En la terminal.**

<!-- prueba: adentro | espera: DataNode -->
```bash
datanode
```

<!-- prueba: no (suma un DataNode al cluster) -->
```bash
datanode start 4
```

## Dónde se usa esto en la industria

La pestaña Archivos es lo que da el *Browse the file system* de la página del
NameNode (`localhost:9870`) y el explorador de **Hue** o de **Ambari Files
View**. La pestaña Salud es lo que miran **Cloudera Manager** y **Ambari** en
sus alertas de HDFS (*under-replicated blocks*, *missing blocks*), sacado del
mismo JMX. En producción, `hdfs fsck /` y `hdfs dfsadmin -report` son los dos
primeros comandos cuando algo anda mal.
