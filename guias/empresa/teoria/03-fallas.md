# 3. Fallas: heartbeats, nodos muertos y re-replicación

[← 2. Réplicas y racks](02-replicas-y-racks.md) · [Teoría](README.md) · Siguiente: [4. Políticas de almacenamiento →](04-politicas-de-almacenamiento.md)

En un cluster de muchas máquinas, que alguna falle no es un accidente: es
lo normal. HDFS está pensado para que una PC que se cae no sea un problema.
Este tema cuenta cómo se entera y qué hace.

## Heartbeats

Cada DataNode le manda al NameNode un **heartbeat** (latido) cada
`dfs.heartbeat.interval` segundos: "sigo vivo, tengo tanto espacio libre".
En la respuesta el NameNode le manda órdenes: "copiá este bloque a tal
nodo", "borrá este otro".

Además, cada tanto el DataNode manda un **block report**: la lista
completa de los bloques que tiene. Así el NameNode sabe dónde está cada
réplica (ese mapa no se guarda en disco: se arma con los reportes).

Del lado de YARN pasa lo mismo: cada NodeManager le manda heartbeats al
ResourceManager (al puerto `8031` del maestro) con su memoria libre y el
estado de sus contenedores.

## Cuándo un DataNode está muerto

El NameNode revisa cada `dfs.namenode.heartbeat.recheck-interval` si algún
DataNode dejó de latir. Lo da por **muerto** cuando pasó:

```text
2 × recheck-interval + 10 × heartbeat.interval
```

| | Heartbeat | Recheck | Muerto a los |
|---|---|---|---|
| Hadoop de fábrica | 3 s | 300 s (5 min) | 2 × 300 + 10 × 3 = **630 s** (10,5 min) |
| La imagen | 3 s | 5 s | 2 × 5 + 10 × 3 = **40 s** |

La imagen acorta la espera para que en clase se vea en menos de un minuto.
En producción se deja larga a propósito: un nodo que se reinicia por
mantenimiento vuelve en unos minutos, y darlo por muerto antes obligaría a
copiar todos sus bloques para nada (en un cluster real, pueden ser
terabytes).

YARN tiene su propio plazo: un NodeManager sin heartbeats se da por perdido
a los 10 minutos (`yarn.nm.liveness-monitor.expiry-interval-ms`, de
fábrica). La imagen no lo cambia: por eso, en la guía 1, el NameNode marca
muerta a pc02 bastante antes de que YARN deje de mostrarla.

## Qué hace el NameNode con un nodo muerto

1. Deja de mandarle clientes: las lecturas usan las otras réplicas. Por eso
   en la guía 1 el archivo **se sigue leyendo** con una PC apagada.
2. Recuenta: cada bloque que tenía una réplica ahí ahora tiene una menos
   que su replicación. Esos bloques quedan **sub-replicados**
   (*under-replicated*).
3. Los pone en una cola de **re-replicación**, con prioridad: primero los
   que quedaron con una sola copia (los que más riesgo corren).
4. Elige, para cada uno, un DataNode que tenga una copia sana y otro que no
   tenga ninguna (respetando racks y tipos de almacenamiento), y en el
   próximo heartbeat le ordena al primero copiarlo al segundo. La copia va
   **de DataNode a DataNode**, sin pasar por el NameNode.
5. Lo hace de a poco (unas pocas copias por nodo a la vez) para no saturar
   la red.

**Si no hay dónde copiar**, el bloque queda sub-replicado hasta que haya
lugar. Es lo que pasa en el aula simulada con dos PCs: con pc02 caída
quedan maestro y pc01, y replicación 3 necesita tres nodos distintos. Con
pc03 sí hay dónde, y la guía 1 lo muestra: `UnderReplicatedBlocks` vuelve a
0 con pc02 todavía apagada.

### Sub-replicado no es "roto"

Para `hdfs fsck`, un HDFS está **`HEALTHY`** si no tiene bloques
**perdidos** (*missing*: ninguna réplica viva) ni **corruptos**. Un bloque
con 2 réplicas de 3 está sub-replicado, pero sano: se puede leer. fsck lo
muestra en `Under-replicated blocks` y sigue diciendo `HEALTHY`. Si todas
las réplicas de un bloque se pierden, el bloque está *missing* y fsck dice
`CORRUPT`.

## Cuando el nodo vuelve: sobre-replicación

Si una PC muerta vuelve (y entretanto sus bloques se re-replicaron en otro
lado), al anotarse reporta sus bloques viejos. Ahora esos bloques tienen
**una copia de más**: están **sobre-replicados** (*over-replicated*).

El NameNode elige qué copia sobra, cuidando que el bloque siga en más de un
rack y que se respete la política de almacenamiento, y le ordena a ese
DataNode borrarla. En la guía 1 se ve con `hdfs fsck /`:
`Over-replicated blocks` sube y vuelve a 0.

Si en cambio la PC vuelve **antes** de que se re-replicara nada (como pc02
en el aula de dos PCs), sus copias simplemente vuelven a contar y los
bloques dejan de estar sub-replicados.

## El arranque del NameNode: safe mode

Cuando el NameNode arranca, todavía no sabe dónde está cada réplica:
espera los block reports. Mientras tanto está en **safe mode**: se puede
leer, pero no escribir ni re-replicar (si re-replicara ya, copiaría bloques
de nodos que simplemente todavía no reportaron).

Sale cuando suficientes bloques (99,9% de fábrica) tienen al menos una
réplica reportada, más una espera extra (`dfs.namenode.safemode.extension`:
30 s de fábrica, 5 s en la imagen). Si en 120 s no sale, el arranque de la
imagen lo fuerza y avisa.

En el aula esto tiene una consecuencia linda: como el maestro guarda una
copia de cada bloque (`ARCHIVE`), si se reinicia el maestro **con todas las
PCs apagadas**, su propio DataNode ya reporta todos los bloques y HDFS sale
de safe mode. Los datos de la clase están completos en la PC del profe.

## Sacar una PC "bien": decommission

Apagar una PC de golpe (`docker kill`) es una falla. Para sacarla a
propósito, por ejemplo por mantenimiento o para reemplazarla, HDFS tiene el
**decommission**:

1. Se agrega el nodo a una lista de exclusión (`dfs.hosts.exclude`) y se
   corre `hdfs dfsadmin -refreshNodes`.
2. El nodo pasa a *Decommission in progress*: sigue sirviendo lecturas,
   pero no recibe bloques nuevos, y el NameNode copia todas sus réplicas a
   otros nodos.
3. Cuando terminó, el nodo queda *Decommissioned* y se puede apagar sin que
   ningún bloque quede sub-replicado ni un segundo.

La diferencia con una falla: los bloques nunca quedan con menos copias de
las pedidas. Hay también un modo **mantenimiento** para apagadas cortas,
que no copia nada si el nodo vuelve a tiempo.

La imagen **no configura** la lista de exclusión: en el aula el
decommission queda como concepto. Lo que se ve es el caso de la falla.

## Y si se cae algo que no es un DataNode

| Qué se cae | Qué pasa |
|---|---|
| Un DataNode (una PC) | Lo de arriba: sub-replicación, re-replicación, se sigue leyendo |
| Un NodeManager (una PC) | Las tareas que corrían ahí se pierden; el ApplicationMaster las vuelve a lanzar en otro NodeManager. En MapReduce, también los maps ya terminados en esa PC, porque su salida estaba en su disco |
| El nodo del ApplicationMaster | YARN vuelve a lanzar el ApplicationMaster (un número limitado de intentos) |
| El maestro | Se cae el cluster: no hay NameNode ni ResourceManager. Los datos siguen en las PCs. Ver [punto débil](01-de-pseudo-a-cluster.md#el-punto-débil-el-maestro) |

## Resumen

- Los DataNodes avisan que están vivos con heartbeats; el NameNode los da
  por muertos a los ~40 s en la imagen (10,5 min de fábrica).
- Con un nodo muerto, sus bloques quedan sub-replicados y el NameNode los
  re-replica de DataNode a DataNode, si hay dónde.
- Sub-replicado sigue siendo `HEALTHY`; perdido (sin ninguna réplica) es
  `CORRUPT`.
- Cuando el nodo vuelve, sobran copias: el NameNode borra las de más.
- Decommission saca un nodo copiando antes sus bloques; la imagen no lo
  configura.

Preguntas: [evaluación, fallas](../evaluacion/02-fallas.md).

[← 2. Réplicas y racks](02-replicas-y-racks.md) · [Teoría](README.md) · Siguiente: [4. Políticas de almacenamiento →](04-politicas-de-almacenamiento.md)
