# 2. HDFS

El *Hadoop Distributed File System*: cómo guarda archivos más grandes que
cualquier disco, repartidos en muchas máquinas, sin perder datos cuando una
se rompe.

[← 1. Introducción](01-big-data.md) · [Teoría](README.md) · Siguiente: [3. YARN y MapReduce →](03-yarn-mapreduce.md)

## Conceptos

| Concepto | Qué es |
|---|---|
| **Bloque** | El pedazo de tamaño fijo en el que se parte cada archivo (128 MB de fábrica; en la guía, 1 MB). Es la unidad que se guarda, se replica y se procesa en paralelo |
| **Réplica** | Cada copia de un bloque. La cantidad es el **factor de replicación** (3 de fábrica; en la guía, 2) |
| **NameNode** | El maestro: guarda el *espacio de nombres* (carpetas y archivos) y el mapa de bloques. No guarda datos |
| **DataNode** | El trabajador: guarda bloques como archivos comunes en su disco local |
| **Metadatos** | Todo lo que no es el contenido: nombres, permisos, replicación, lista de bloques de cada archivo y dónde está cada réplica |
| **Heartbeat** | El "estoy vivo" que cada DataNode le manda al NameNode (cada 3 s) |
| **Block report** | La lista de bloques que tiene un DataNode, que le manda al NameNode al arrancar y cada tanto |
| **Safe mode** | Estado de solo lectura del NameNode al arrancar, mientras junta los block reports |
| **fsimage / edits** | La foto de los metadatos en disco y el registro de cambios posteriores |
| **Checkpoint** | Juntar `fsimage` + `edits` en una `fsimage` nueva (lo hace el Secondary NameNode) |

## Cómo funciona por dentro

### Un archivo partido en bloques

El archivo de la guía, `ventas_grandes.csv`, pesa 6.213.191 bytes. Con
`BLOCK_SIZE=1m` (1.048.576 bytes) queda en **6 bloques**: cinco llenos y un
sexto de ~0,9 MB. El último bloque ocupa en disco solo lo que tiene, no 1 MB
entero. Con `REPLICATION=2` y 3 DataNodes, son 12 réplicas repartidas así (un
ejemplo; el reparto real lo muestra `fsck`):

```text
   ventas_grandes.csv (6.213.191 bytes)
   +------+------+------+------+------+-----+
   |  b1  |  b2  |  b3  |  b4  |  b5  | b6  |    bloques de 1 MB (el último, menos)
   +------+------+------+------+------+-----+

   NameNode (en memoria):
     /user/root/ventas/ventas_grandes.csv  ->  b1:[dn1,dn2] b2:[dn2,dn3] b3:[dn3,dn1]
                                              b4:[dn1,dn3] b5:[dn2,dn1] b6:[dn3,dn2]

   DataNode 1          DataNode 2          DataNode 3
   b1 b3 b4 b5         b1 b2 b5 b6         b2 b3 b4 b6
```

¿Por qué bloques tan grandes (128 MB) si un disco común usa bloques de 4 KB?

- Para que el tiempo de **leer** el bloque sea mucho mayor que el de
  **buscarlo** (posicionar el disco, abrir la conexión). Así se aprovecha la
  velocidad de transferencia.
- Para que el NameNode tenga **pocos** bloques que recordar: todos sus
  metadatos están en memoria.
- Porque un bloque es la unidad de trabajo de un mapper: bloques muy chicos
  serían miles de tareas diminutas.

En la guía se usa 1 MB solo para que un archivo de 6 MB muestre varios
bloques. Con 128 MB sería uno solo y un solo mapper.

### Escribir: el pipeline de réplicas

```text
  cliente (hdfs dfs -put)
     | 1. "quiero crear /user/root/ventas/ventas_grandes.csv"
     v
  NameNode --2. "el bloque b1 va a dn1 y dn2"--> cliente
     |
     |   3. el cliente manda los datos en paquetes al primero de la lista,
     |      que los reenvía al siguiente (pipeline):
     v
  cliente ==> dn1 ==> dn2
          <== ack <== ack      4. las confirmaciones vuelven por el mismo camino
     |
     5. cuando el bloque se llena, se pide uno nuevo (b2) al NameNode y se repite
     6. al terminar, el cliente "cierra" el archivo y el NameNode lo da por escrito
```

- El NameNode **no ve pasar los datos**: solo decide dónde van. Si los datos
  pasaran por él, sería el cuello de botella de todo el cluster.
- Cada DataNode guarda, junto a cada bloque, sus **checksums** (sumas de
  control de cada pedazo). Al leer se verifican: si un disco devolvió basura,
  el cliente lo detecta, lee otra réplica y avisa para que se reemplace la
  dañada.
- Los archivos son *write once, read many*: se escriben una vez y después
  solo se leen (se puede agregar al final, pero no modificar el medio).

### Dónde se pone cada réplica

Con varios racks, la política por defecto es: la primera réplica en el nodo
que escribe (o uno al azar), la segunda en **otro rack**, la tercera en el
mismo rack que la segunda pero en otro nodo. Así se sobrevive a que se caiga
un rack entero (un switch, la electricidad) sin mandar todas las copias por la
red entre racks. En esta imagen todos los DataNodes están en la misma máquina,
en un solo rack: la regla que se ve es que **dos réplicas de un bloque nunca
van al mismo DataNode**. Por eso, con `REPLICATION=3` y `DATANODES=2`, el
bloque queda *sub-replicado*: no hay un tercer nodo distinto.

### Leer

1. El cliente le pide al NameNode la lista de bloques del archivo y, para
   cada uno, los DataNodes que lo tienen, ordenados por cercanía.
2. Lee cada bloque **directo del DataNode** más cercano. Si ese no responde o
   el checksum no coincide, pasa al siguiente de la lista.

### Cuando se cae un DataNode

```text
  t = 0 s     dn2 deja de mandar heartbeats
  t ≈ 40 s    el NameNode lo marca muerto
              (2 x recheck-interval + 10 x heartbeat = 2 x 5 s + 10 x 3 s)
  después     los bloques que tenía quedan con 1 réplica (sub-replicados);
              el NameNode ordena copiarlos desde la réplica que queda a otro
              DataNode vivo, hasta volver a REPLICATION
  si vuelve   sus bloques sobran (sobre-replicados) y el NameNode borra los
              excedentes
```

De fábrica, el tiempo para darlo por muerto es de 10,5 minutos (un nodo que se
reinicia no debería disparar una copia masiva). En la imagen se bajó a ~40 s
para verlo en una clase.

Con `REPLICATION=1` no hay otra copia: los bloques del nodo caído quedan
**perdidos** (`MISSING`) hasta que vuelva. Si su disco se rompió, se
perdieron.

### El NameNode por dentro: fsimage, edits y checkpoint

El NameNode tiene todos los metadatos **en memoria** (para responder rápido),
y en disco guarda:

- la **fsimage**: una foto completa del espacio de nombres en algún momento;
- los **edits**: el registro de cada cambio desde esa foto (crear, borrar,
  renombrar). Cada cambio se escribe en los edits **antes** de confirmarlo:
  si se corta la luz, al arrancar se carga la fsimage y se "reproducen" los
  edits.

El problema es que los edits crecen sin fin y el arranque se hace cada vez
más lento. El **Secondary NameNode** hace el *checkpoint* cada tanto: baja la
fsimage y los edits, los junta en una fsimage nueva y se la devuelve al
NameNode, que empieza edits nuevos. Pese al nombre, **no reemplaza** al
NameNode si se cae: para eso está la alta disponibilidad
([tema 8](08-zookeeper-ha.md)).

Lo que **no** está en la fsimage es dónde está cada bloque: eso lo reconstruye
el NameNode al arrancar con los block reports de los DataNodes. Mientras
tanto está en **safe mode** (solo lectura). Sale cuando el 99,9 % de los
bloques tiene al menos una réplica reportada, más unos segundos de espera.

### El problema de los archivos chicos

Cada archivo, carpeta y bloque ocupa del orden de 150 bytes en la memoria del
NameNode. Cien millones de archivos de 1 KB son pocos datos, pero demasiados
metadatos, y además miles de mappers diminutos. Por eso en Big Data se
prefieren **pocos archivos grandes**, y se juntan los chicos antes de
procesarlos (o se usan formatos contenedores como Parquet, ORC o
SequenceFile).

## Ventajas y limitaciones

**Ventajas**

- Archivos más grandes que cualquier disco, repartidos en muchas máquinas.
- Tolerancia a fallas por replicación, con re-replicación automática.
- Mucho ancho de banda total: muchos clientes leen bloques distintos de
  DataNodes distintos al mismo tiempo.
- Permite llevar el cómputo al nodo que tiene el bloque.

**Limitaciones**

- **Latencia alta**: abrir un archivo es una consulta al NameNode y una
  conexión a un DataNode. No sirve para muchas lecturas chicas al azar.
- **Archivos chicos**: limitan por la memoria del NameNode.
- **Sin modificaciones en el medio** del archivo: no es una base de datos.
- **NameNode como punto único de falla**, salvo con alta disponibilidad.
- La replicación triple cuesta el triple de disco. Hadoop 3 agrega *erasure
  coding* (como un RAID distribuido), que da tolerancia parecida con ~1,5
  veces el espacio, a cambio de más CPU y peor localidad.

## Alternativas

En la nube, el almacenamiento de objetos (Amazon S3, Azure Data Lake Storage,
Google Cloud Storage) reemplazó a HDFS en la mayoría de los casos: no hay
NameNode que administrar, escala sin límite práctico y se paga por uso. A
cambio, no hay localidad (los datos siempre viajan por la red) y renombrar una
carpeta no es instantáneo. Spark y Hive leen de los dos con solo cambiar la
ruta.

## En la guía 3 lo ves cuando...

- **[Bloques y réplicas](../../03-hdfs.md#bloques-y-réplicas)**: `fsck`
  muestra los 6 bloques y, para cada uno, `Live_repl=2` y los dos DataNodes.
- **[Cambiar la replicación](../../03-hdfs.md#cambiar-la-replicación)**:
  `setrep -w 3` crea la tercera réplica de cada bloque. El tamaño de bloque,
  en cambio, no se puede cambiar sin volver a subir el archivo.
- **[Se cae un DataNode](../../03-hdfs.md#se-cae-un-datanode)**: el `md5sum`
  da igual con un nodo apagado; a los ~40 s pasa a *Dead* y `fsck` muestra
  cómo bajan los *Under-replicated blocks*.
- **[Un dataset de verdad](../../03-hdfs.md#un-dataset-de-verdad-200000-ventas)**:
  el md5 del archivo en HDFS es el mismo que el del disco local. Los checksums
  garantizan que no se corrompió en el camino.
- **[Guía 2](../../02-arrancar-y-apagar.md#apagar-y-volver-a-prender)**: al
  volver a prender, HDFS se queda unos segundos en *safe mode* (el log dice
  `Esperando a que HDFS salga de safe mode`) mientras los DataNodes mandan
  sus block reports.

Para repasar: [evaluación de HDFS](../evaluacion/02-hdfs.md). Comandos y
configuración: [referencia de HDFS](../referencia.md#hdfs).
