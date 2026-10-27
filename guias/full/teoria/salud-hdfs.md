# Salud de HDFS: latidos, réplicas y bloques perdidos

Qué quiere decir que HDFS esté "sano", por qué el NameNode tarda en
reaccionar cuando se cae un DataNode y qué diferencia hay entre un bloque
con copias de menos y un bloque perdido. Es la teoría detrás de la pestaña
**Salud** de [HDFS](../03-hdfs.md), de los carteles del
[Cluster](../02-cluster-y-sinoptico.md) y de la
[guía 3 de la materia](../../03-hdfs.md).

[← Teoría](README.md) · [Índice de full](../README.md)

## Quién sabe qué

- El **NameNode** sabe el árbol de carpetas, qué bloques forman cada
  archivo y cuántas copias debería tener cada uno. **No** guarda en disco
  dónde está cada copia: eso lo arma en memoria con lo que le cuentan los
  DataNodes.
- Cada **DataNode** guarda bloques en su carpeta (`/hadoop/dfs/dn1`...) y le
  avisa al NameNode, con **latidos** (*heartbeats*) frecuentes y con
  **reportes de bloques** completos de vez en cuando, qué tiene.

Por eso la salud de HDFS depende de dos cosas: que los DataNodes sigan
latiendo y que cada bloque tenga sus copias en DataNodes vivos.

## Del silencio a la muerte

Un DataNode manda un latido cada **3 s** (`dfs.heartbeat.interval`). Si deja
de mandarlos, el NameNode no lo da por muerto enseguida, porque podría ser
una pausa (un recolector de basura largo, la red cargada):

| Tiempo sin latidos | Estado | Qué hace el NameNode |
|---|---|---|
| menos de 30 s | vivo | nada |
| 30 s (`dfs.namenode.stale.datanode.interval`) | *stale* (sospechoso) | lo evita para lecturas y escrituras nuevas si puede |
| 2 × `recheck-interval` + 10 × `heartbeat.interval` | muerto | lo saca y encola la re-replicación de sus bloques |

En el sandbox, `dfs.namenode.heartbeat.recheck-interval` vale 5000 ms, así
que muerto = 2 × 5 s + 10 × 3 s = **40 s**. En un cluster con los valores de
fábrica (recheck de 5 minutos) son **10 minutos y medio**: el sandbox lo
acorta para que se pueda ver en clase.

<!-- prueba: adentro | espera: 5000 -->
```bash
hdfs getconf -confKey dfs.namenode.heartbeat.recheck-interval
hdfs getconf -confKey dfs.heartbeat.interval
```

¿Por qué esperar? Porque re-replicar cuesta: copiar todos los bloques de un
nodo mueve muchos datos por la red. Si el nodo vuelve a los 20 s (un
reinicio), haberlo copiado todo habría sido tiempo y red tirados. Es un
compromiso entre **reaccionar rápido** y **no reaccionar de más**.

## Sub-replicado, perdido, corrupto

| Situación | Qué pasa | ¿Se pierden datos? | Qué dice `fsck` |
|---|---|---|---|
| Sub-replicado (*under-replicated*) | Un bloque tiene menos copias vivas que su réplica | No: queda al menos una | `Under-replicated blocks: N`, sigue **HEALTHY** |
| Sobre-replicado (*over-replicated*) | Más copias que la réplica (por ejemplo, volvió un nodo) | No | `Over-replicated blocks: N`; el NameNode borra las que sobran |
| Perdido (*missing*) | Ninguna copia viva | Sí, hasta que vuelva algún nodo que la tenga | `Missing blocks: N`, **CORRUPT** |
| Corrupto | Hay copias, pero no coinciden con su suma de verificación | Sí, si todas están mal | `Corrupt blocks: N`, **CORRUPT** |

Lo importante: **HEALTHY no quiere decir que estén todas las copias**, sino
que **ningún bloque se perdió**. Esta es una salida real de las pruebas de
la imagen, con réplica 2 y uno de los dos DataNodes ya dado por muerto:

```text
Status: HEALTHY
 Number of data-nodes:	1
 Number of racks:		1
 Total dirs:			11
 Total symlinks:		0

Replicated Blocks:
 Total size:	315641711 B
 Total files:	2
 Total blocks (validated):	302 (avg. block size 1045171 B)
 Minimally replicated blocks:	302 (100.0 %)
 Over-replicated blocks:	0 (0.0 %)
 Under-replicated blocks:	2 (0.66225165 %)
 Mis-replicated blocks:		0 (0.0 %)
 Default replication factor:	2
 Average block replication:	1.9933774
 Missing blocks:		0
 Corrupt blocks:		0
 Missing replicas:		2 (0.33112583 %)
 Blocks queued for replication:	0
```

Hay 2 bloques sub-replicados y `Blocks queued for replication: 0`: con un
solo DataNode vivo no hay adónde copiarlos. Es lo que la pestaña Salud
explica como "esos bloques quedan sub-replicados y no entran en la cola".

## Cómo se re-replica

Cuando un DataNode muere, el NameNode:

1. Anota cada bloque que tenía como sub-replicado y lo pone en una **cola
   con prioridad** (primero los que quedaron con una sola copia).
2. Elige, para cada bloque, un DataNode **origen** que tenga una copia y uno
   **destino** que no la tenga.
3. En el próximo latido del origen, le contesta "mandale este bloque a
   aquel". Los DataNodes se copian entre ellos; el NameNode solo coordina.
4. Cuando el destino confirma, la copia cuenta.

Para no saturar la red, cada DataNode hace pocas copias a la vez
(`dfs.namenode.replication.max-streams`). Eso es lo que muestra la tabla
**Cola de re-replicación** (*en cola*, *copiando*, *hecha*) y la animación de
fichas que "vuelan" de un DataNode a otro en el sinóptico.

![El sinóptico del cluster, con los bloques en cada DataNode](../../../docs/capturas/cluster.png)

## Dónde va cada copia

Con varios racks, la política por defecto pone la primera copia en el nodo
que escribe (si es un DataNode), la segunda en **otro rack** y la tercera en
el mismo rack que la segunda: así sobrevive a que se caiga un rack entero
sin mandar todo por la red entre racks. En el sandbox hay un solo rack
(`Number of racks: 1`), así que solo importa que cada copia vaya a un
**DataNode distinto**. Por eso pedir réplica 3 con 2 DataNodes deja todo
sub-replicado: no se pueden guardar dos copias del mismo bloque en el mismo
nodo.

## El modo seguro

Al arrancar, el NameNode no sabe dónde está ninguna copia: espera los
reportes de bloques. Mientras tanto está en **modo seguro** (*safe mode*):
se puede leer, pero no escribir ni borrar, y no re-replica nada (si
re-replicara, copiaría bloques que solo "faltan" porque su DataNode todavía
no reportó). Sale solo cuando casi todos los bloques tienen al menos una
copia reportada. La etiqueta de HDFS dice **safe mode** mientras dura, y el
arranque lo espera con `hdfs dfsadmin -safemode wait`.

<!-- prueba: adentro | espera: Safe mode is OFF -->
```bash
hdfs dfsadmin -safemode get
```

## Agregar un nodo no reparte lo viejo

Un DataNode nuevo entra **vacío**. HDFS no mueve lo que ya está: usa el nodo
nuevo para lo que se escriba (y para las re-replicaciones). Para emparejar
el uso de disco existe el **balancer** (`hdfs balancer`), que se corre a
mano o programado porque también mueve muchos datos.

## Cómo se mira en un cluster de verdad

<!-- prueba: adentro | espera: Live datanodes -->
```bash
hdfs dfsadmin -report
hdfs fsck /
```

`dfsadmin -report` dice qué nodos están vivos, muertos o desactualizados y
cuánto ocupa cada uno; `fsck /` dice cómo están los bloques. Las consolas
(**Cloudera Manager**, **Ambari**) y los sistemas de monitoreo
(**Prometheus** con un exportador de JMX, **Datadog**) leen los mismos
números del JMX del NameNode (`UnderReplicatedBlocks`, `MissingBlocks`,
`NumDeadDataNodes`) y disparan alertas: *missing blocks* mayor a 0 suele ser
una alerta crítica; *under-replicated* que no baja, un aviso.

## Para pensar

- Con réplica 1, ¿qué pasa con los bloques de un DataNode que se cae? ¿Y
  si vuelve?
- ¿Por qué es mala idea bajar mucho el tiempo para dar por muerto a un
  DataNode en un cluster grande?
- Si `fsck` dice HEALTHY y `Under-replicated blocks` es mayor que 0, ¿hay
  que hacer algo?

Hay preguntas sobre esto en la [evaluación de HDFS](../evaluacion/hdfs.md).
