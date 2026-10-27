# 3. HDFS: el sistema de archivos distribuido

Subir archivos, ver en qué bloques y en qué DataNodes quedan, cambiar la
replicación y tirar un DataNode abajo para ver que los datos siguen ahí.

[← 2. Arrancar y apagar](02-arrancar-y-apagar.md) · [Índice](README.md) · Siguiente: [4. YARN y MapReduce →](04-yarn-mapreduce.md)

Todo lo de esta guía va **adentro** del contenedor (`docker exec -it bigdata
bash`), parado en `/datos`.

## Cómo está armado

- El **NameNode** guarda solo los *metadatos*: qué archivos hay, en qué
  bloques está partido cada uno y en qué DataNodes está cada bloque.
- Los **DataNodes** guardan los bloques. Cada bloque se copia en
  `REPLICATION` DataNodes distintos: si uno se cae, el bloque se lee de otro.
- HDFS **no es** tu carpeta: se mira con `hdfs dfs -ls`, no con `ls`. Un
  archivo pasa de tu compu al cluster así: lo dejás en `datos/` → `hdfs dfs
  -put` lo sube de `/datos` a HDFS → se procesa → `hdfs dfs -get` baja el
  resultado a `/datos` → lo abrís en tu compu.

## Subir un archivo chico

`ejemplos/ventas.csv` tiene 7 ventas. Lo subimos a una carpeta de prueba:

<!-- prueba: adentro | espera: 2026-10-01,Centro,yerba,3,2500 -->
```bash
cat ejemplos/ventas.csv
hdfs dfs -mkdir -p /user/root/prueba
hdfs dfs -put -f ejemplos/ventas.csv /user/root/prueba/
hdfs dfs -ls /user/root/prueba
hdfs dfs -cat /user/root/prueba/ventas.csv
```

- `-put -f` pisa el archivo si ya estaba (sin `-f`, falla con `File exists`).
- En `-ls`, la segunda columna es la **replicación** de cada archivo (2, la
  del `docker run`).
- Rutas sin `/` adelante son relativas a `/user/root` (tu "home" en HDFS):
  `hdfs dfs -ls prueba` es lo mismo.

## Un dataset de verdad: 200.000 ventas

`generar_ventas.py` arma un CSV de ventas de un almacén (yerba, mate,
facturas...), siempre el mismo: a todos les dan los mismos números.

<!-- prueba: adentro | espera: 200000 filas -->
```bash
python3 ejemplos/generar_ventas.py
ls -lh ventas_grandes.csv
head -3 ventas_grandes.csv
```

Lo subimos a `/user/root/ventas`, la carpeta que leen los ejemplos de
MapReduce, Pig, Hive y Spark:

<!-- prueba: adentro | espera: ventas_grandes.csv -->
```bash
hdfs dfs -mkdir -p /user/root/ventas
hdfs dfs -put -f ventas_grandes.csv /user/root/ventas/
hdfs dfs -ls -h /user/root/ventas
```

En http://localhost:9870 → *Utilities → Browse the file system* →
`user/root/ventas` se ve el archivo; clic en él → *Block information*: cada
bloque y sus DataNodes.

¿Llegó igual? La "huella" (md5) del archivo de tu carpeta y la del de HDFS
tienen que dar lo mismo:

<!-- prueba: adentro | espera: 2a5af82c1a6e8a4385b86a144f5a5589 -->
```bash
md5sum ventas_grandes.csv
hdfs dfs -cat /user/root/ventas/ventas_grandes.csv | md5sum
```

```text
2a5af82c1a6e8a4385b86a144f5a5589  ventas_grandes.csv
2a5af82c1a6e8a4385b86a144f5a5589  -
```

## Bloques y réplicas

`fsck` muestra cómo quedó guardado: en cuántos bloques se partió y dónde está
cada copia.

<!-- prueba: adentro | espera: HEALTHY -->
```bash
hdfs fsck /user/root/ventas/ventas_grandes.csv -files -blocks -locations
```

- Con bloques de 1 MB, un archivo de ~6 MB queda en 6 bloques
  (`blk_...`). Con el bloque por defecto (128 MB) sería uno solo.
- Cada bloque dice `Live_repl=2` y lista los 2 DataNodes que lo tienen
  (`DatanodeInfoWithStorage[127.0.0.1:...]`; el puerto dice cuál es).
- Al final: `Status: HEALTHY`.

El resumen de todo el cluster (capacidad y cada DataNode):

<!-- prueba: adentro | espera: Live datanodes -->
```bash
hdfs dfsadmin -report
```

## Cambiar la replicación

La replicación se elige al subir (la del `docker run`), pero a un archivo ya
subido se le puede cambiar. `-w` espera a que estén todas las copias:

<!-- prueba: adentro | espera: Replication 3 set -->
```bash
hdfs dfs -setrep -w 3 /user/root/prueba/ventas.csv
hdfs dfs -ls /user/root/prueba
```

Ahora la segunda columna dice 3. El tamaño de bloque, en cambio, no se cambia:
hay que volver a subir el archivo.

## Bajar y borrar

<!-- prueba: adentro | espera: copia.csv -->
```bash
hdfs dfs -get -f /user/root/prueba/ventas.csv copia.csv
ls -l copia.csv
hdfs dfs -rm -r /user/root/prueba
rm copia.csv
```

`-get` deja el archivo en `/datos` (tu carpeta `datos/`). `-rm -r` borra una
carpeta entera de HDFS.

## Se cae un DataNode

Apagamos el DataNode 2 y leemos el archivo grande de nuevo. Como cada bloque
tiene 2 copias, el que estaba en el 2 se lee de la otra:

<!-- prueba: adentro | espera: DataNode 2 apagado | espera: 2a5af82c1a6e8a4385b86a144f5a5589 -->
```bash
datanode stop 2
datanode
hdfs dfs -cat /user/root/ventas/ventas_grandes.csv | md5sum
```

- En http://localhost:9870 → *Datanodes*, a los ~40 s el 2 pasa a *Dead*.
- Después el NameNode **copia de nuevo** los bloques que quedaron con una
  sola copia a los DataNodes que siguen vivos (`hdfs fsck / | tail -20` va
  mostrando cómo bajan los *Under-replicated blocks*).

Lo volvemos a prender:

<!-- prueba: adentro | espera: DataNode 2 prendido -->
```bash
datanode start 2
datanode
```

**Para pensar:** con `REPLICATION=1`, ¿qué pasa si apagás un DataNode? (Los
bloques que tenía quedan *perdidos* —`hdfs fsck /` los lista como `MISSING`—
hasta que lo prendés otra vez.)

## Comandos de HDFS

| Comando | Qué hace |
|---|---|
| `hdfs dfs -ls [-h] <carpeta>` | Lista (con `-h`, tamaños legibles) |
| `hdfs dfs -mkdir -p <carpeta>` | Crea una carpeta |
| `hdfs dfs -put [-f] <local> <hdfs>` | Sube de `/datos` a HDFS |
| `hdfs dfs -get [-f] <hdfs> <local>` | Baja de HDFS a `/datos` |
| `hdfs dfs -cat <archivo>` | Muestra el contenido (con `\| head` para los grandes) |
| `hdfs dfs -rm [-r] <ruta>` | Borra (con `-r`, carpetas) |
| `hdfs dfs -du -h <carpeta>` | Cuánto ocupa |
| `hdfs dfs -setrep -w N <ruta>` | Cambia la replicación |
| `hdfs fsck <ruta> -files -blocks -locations` | Bloques y dónde está cada copia |
| `hdfs dfsadmin -report` | Estado de cada DataNode |
| `hdfs dfsadmin -safemode get` | Si HDFS está en *safe mode* |
| `datanode`, `datanode stop N`, `datanode start N` | Lista, apaga o prende el DataNode N |

## Para profundizar

- Teoría: [HDFS](base/teoria/02-hdfs.md): el porqué y cómo funciona por dentro.
- Evaluación: [HDFS](base/evaluacion/02-hdfs.md): preguntas y ejercicios con sus respuestas.
- Referencia: [HDFS](base/referencia.md#hdfs): comandos, opciones y puertos.
