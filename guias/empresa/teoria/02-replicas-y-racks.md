# 2. Réplicas y racks

[← 1. De pseudo-distribuido a cluster](01-de-pseudo-a-cluster.md) · [Teoría](README.md) · Siguiente: [3. Fallas →](03-fallas.md)

## Para qué hay réplicas

HDFS corta cada archivo en **bloques** (128 MB de fábrica, `BLOCK_SIZE`) y
guarda cada bloque **varias veces**, en DataNodes distintos. La cantidad de
copias es la **replicación** del archivo (`REPLICATION`: 3 en el aula).

Las réplicas sirven para dos cosas:

1. **No perder datos**: si se rompe un disco o se apaga una PC, el bloque
   sigue estando en otras.
2. **Leer más rápido y más cerca**: varias tareas pueden leer el mismo
   bloque desde PCs distintas, y cada una elige la copia más cercana.

Un DataNode **nunca guarda dos réplicas del mismo bloque**: no sumaría nada,
porque si ese nodo se cae se pierden las dos. Por eso con `REPLICATION`
mayor que la cantidad de DataNodes los bloques quedan **sub-replicados**:
no hay dónde poner las copias que faltan.

## Qué es un rack

En un datacenter, las máquinas van montadas en **racks** (armarios), y cada
rack tiene su switch de red y su alimentación. Dos fallas comunes tiran
abajo un rack entero de una: se quema el switch, se corta la energía de ese
armario.

Si las tres réplicas de un bloque estuvieran en el mismo rack, esa falla
las perdería todas juntas. Por eso HDFS es **consciente de los racks**
(*rack awareness*): reparte las copias en más de uno.

En el aula, la analogía es la **fila** de PCs: una zapatilla que se
desenchufa, un switch por fila o una fila que se apaga junta al terminar la
clase. Por eso la imagen agrupa las PCs en filas (`/fila1`, `/fila2`...) y
el maestro va aparte (`/profe`).

## Cómo sabe HDFS el rack de cada DataNode

HDFS no lo adivina: se lo dice un **script de topología**
(`net.topology.script.file.name`). Cuando un DataNode se anota, el
NameNode le pasa su nombre (o IP) al script y anota el rack que contesta.
En la imagen el script es `/opt/sandbox/bin/topologia`:

| Nombre | Rack |
|---|---|
| `maestro` | `/profe` |
| `pcNN` | `/fila` + `(NN - 1) / PCS_POR_FILA + 1` (división entera) |
| otro | `/default-rack` |

Con `PCS_POR_FILA=5` (fábrica), pc01 a pc05 son `/fila1`, pc06 a pc10
`/fila2`. En `aula-simulada.yml` es 2: pc01 y pc02 en `/fila1`, pc03 en
`/fila2`.

Detalles que importan:

- El rack sale del **nombre**. Una PC que no se llame `pcNN` cae en
  `/default-rack`, un rack más, que HDFS trata como si fuera una fila.
- Si el script no está configurado, todo es `/default-rack` y HDFS no puede
  repartir por racks (es lo que pasa en `ROL=solo`).
- Lo corre el NameNode, o sea el maestro: `PCS_POR_FILA` que vale es el del
  maestro.

En un cluster de empresa el script lo arma infraestructura, a partir del
inventario de máquinas o de la subred de cada rack. La idea es la misma.

## Dónde pone HDFS cada réplica

La regla de fábrica de HDFS (la política de colocación por defecto) para
replicación 3 es:

1. **Primera réplica**: en el nodo que escribe, si es un DataNode (escribir
   en el propio disco es lo más barato). Si el cliente no es un DataNode,
   en uno al azar.
2. **Segunda réplica**: en un nodo de **otro rack**.
3. **Tercera réplica**: en el **mismo rack que la segunda**, en otro nodo.

Así un bloque queda en dos racks: sobrevive a la caída de un rack entero,
pero solo una copia tiene que cruzar entre racks (que en un datacenter es
el enlace más cargado). Con más de 3 réplicas, el resto va repartido, sin
pasar de un tope de réplicas por rack.

Esa regla elige **nodos**. Además, la política de almacenamiento elige el
**tipo** de cada réplica: en el aula, con `WARM`, una tiene que ser
`ARCHIVE`, y el único nodo `ARCHIVE` es el maestro (ver
[políticas](04-politicas-de-almacenamiento.md)). Las dos reglas juntas dan
lo que se ve en el aula: **una copia en `/profe` y las otras en las
filas**.

### En el aula simulada

Con el maestro, pc01 y pc02 y `PCS_POR_FILA=2`:

| Rack | Nodos |
|---|---|
| `/profe` | maestro (`ARCHIVE`) |
| `/fila1` | pc01, pc02 (`DISK`) |

Hay tres DataNodes y la replicación es 3: cada bloque tiene una copia en
cada nodo. No queda opción, pero el resultado cumple la regla (dos racks,
una copia `ARCHIVE`).

Con pc03 en `/fila2` hay cuatro DataNodes y tres racks. Cada bloque sigue
con una copia en el maestro y las otras dos en dos de las tres PCs: ahí sí
HDFS elige. Comprobalo con:

- `hdfs dfsadmin -printTopology`: qué nodos hay en cada rack.
- `hdfs fsck <archivo> -files -blocks -racks`: el rack de cada réplica.
- `hdfs fsck <archivo> -files -blocks -locations`: el tipo (`DISK` o
  `ARCHIVE`) de cada réplica.

## Replicación por archivo

La replicación no es del cluster: es **de cada archivo**, y la fija el
cliente cuando lo crea (con el `dfs.replication` de su configuración, que
sale de `REPLICATION`, o con `-D dfs.replication=N`). Por eso:

- Cambiar `REPLICATION` no cambia los archivos que ya estaban.
- Se puede cambiar después con `hdfs dfs -setrep N <ruta>`: el NameNode
  agrega o borra copias hasta llegar a `N`.
- En `hdfs dfs -ls`, la segunda columna es la replicación de cada archivo.

## Costos de replicar

- **Espacio**: replicación 3 ocupa el triple. En el aula, el disco del
  maestro tiene que poder guardar una copia de **todo** lo que suba la
  clase.
- **Escritura**: el cliente manda el bloque al primer DataNode, que lo
  reenvía al segundo, que lo reenvía al tercero (una **cañería** o
  *pipeline*). La escritura termina cuando confirman todos.
- Por eso no se usa replicación 10 "para estar más seguro": el costo crece
  y la ganancia casi no. En Hadoop 3 los datos fríos pueden usar **erasure
  coding** (paridad, como un RAID) en lugar de réplicas: guardan lo mismo
  con mucho menos espacio, a cambio de más CPU al leer si falta un pedazo.
  La imagen no lo usa.

## Resumen

- Cada bloque se guarda `REPLICATION` veces, nunca dos en el mismo nodo.
- Un rack es un grupo de máquinas que pueden caerse juntas; en el aula,
  una fila.
- El script de topología le dice a HDFS el rack de cada nodo, por su
  nombre.
- La regla de fábrica: una copia local, otra en otro rack, la tercera en
  ese mismo otro rack. En el aula, además, una copia siempre va al maestro.
- La replicación es de cada archivo y se fija al crearlo.

Preguntas: [evaluación, cluster y racks](../evaluacion/01-cluster-y-racks.md).

[← 1. De pseudo-distribuido a cluster](01-de-pseudo-a-cluster.md) · [Teoría](README.md) · Siguiente: [3. Fallas →](03-fallas.md)
