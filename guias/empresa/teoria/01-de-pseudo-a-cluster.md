# 1. De pseudo-distribuido a cluster

[Teoría](README.md) · Siguiente: [2. Réplicas y racks →](02-replicas-y-racks.md)

## Lo que ya conocés: todo en una máquina

En las versiones `base`, `ml` y `full` (y en `empresa` con `ROL=solo`) el
cluster entero vive en **un contenedor**. Se llama modo
**pseudo-distribuido**: cada servicio de Hadoop es un proceso aparte
(NameNode, DataNodes, ResourceManager, NodeManager...), hablan entre ellos
por la red como en un cluster de verdad, pero todos en la misma máquina, en
`localhost`.

Sirve para aprender casi todo: los comandos, los bloques, YARN, Hive,
Spark. Lo que **no** muestra es lo que pasa cuando hay varias máquinas:

- Si la máquina se apaga, se apaga todo. Las réplicas de un bloque están
  todas en el mismo disco físico, aunque sean "DataNodes distintos".
- Leer un bloque "de otro DataNode" no cruza ninguna red de verdad.
- No hay racks: todo está en `/default-rack`.
- Una tarea siempre corre "al lado" de sus datos.

## Lo que cambia en el aula

Con `ROL=maestro` y `ROL=trabajador`, cada contenedor es **un nodo** del
cluster, y se reparten los papeles:

| | `ROL=solo` | Aula (`maestro` + `trabajador`) |
|---|---|---|
| Dónde está el NameNode | `localhost:9000` | `maestro:9000` (`MAESTRO`) |
| DataNodes | `DATANODES` (1 de fábrica) en el mismo contenedor, cada uno con sus puertos | Uno por nodo, todos con los puertos de fábrica (`9866`, `9867`, `9864`) |
| Cómo se anuncia un DataNode | `localhost` | Con su nombre: `dfs.datanode.hostname` = `NODO` (el `hostname`) |
| Replicación de fábrica | 1 | 3 |
| NodeManagers | Uno, en el mismo contenedor | Uno por PC; el maestro no tiene (salvo `MAESTRO_NM=si`) |
| Racks | Ninguno (`/default-rack`) | `/profe` para el maestro, `/filaK` para las PCs |
| Hive Metastore | Derby, un archivo en el volumen | MariaDB en el maestro: muchos clientes a la vez |
| Interfaz web (`:8080`) | Sí | No: cada nodo arranca solo con sus procesos |
| Alta disponibilidad (`NAMENODES=2`) | Sí | No: un solo NameNode |

Cada nodo genera su configuración al arrancar a partir de las variables:
el `core-site.xml` de todos dice `hdfs://maestro:9000`, el `yarn-site.xml`
dice que el ResourceManager está en `maestro`, Hive busca el Metastore en
`thrift://maestro:9083` y Spark manda su historial a `maestro:18080`. Por
eso los comandos `hdfs`, `yarn`, `beeline` y `spark-submit` andan igual
desde cualquier nodo: todos hablan con el maestro.

## Maestro y trabajadores

Es la arquitectura **maestro/trabajador** (en inglés, *master/worker*) que
usan casi todos los sistemas distribuidos:

- El **maestro** guarda el estado global y decide: el NameNode sabe qué
  bloques tiene cada archivo y dónde está cada réplica; el ResourceManager
  sabe cuánta memoria libre hay en cada NodeManager y a quién se la da.
- Los **trabajadores** hacen el trabajo pesado: los DataNodes guardan y
  mueven los bytes, los NodeManagers corren las tareas. Avisan que están
  vivos con **heartbeats** (latidos) periódicos al maestro.

Los datos **no pasan por el maestro**: un cliente que lee un archivo le
pregunta al NameNode dónde están los bloques y después los lee directo de
los DataNodes. El maestro maneja metadatos; los trabajadores, datos. Por
eso un NameNode chico (384 MB acá) puede manejar muchos DataNodes.

En el aula hay una excepción buscada: el maestro también tiene un DataNode,
de tipo `ARCHIVE`, que guarda una copia de cada bloque (ver [políticas de
almacenamiento](04-politicas-de-almacenamiento.md)). Eso sí hace que todas
las escrituras pasen por el maestro.

## Cómo se arma: el orden de arranque

Los trabajadores dependen del maestro, así que lo esperan:

1. El maestro formatea el NameNode (la primera vez) y lo prende.
2. Cada PC espera hasta 10 minutos a que `maestro:9000` conteste, prende su
   DataNode y espera a que el NameNode lo anote entre los vivos.
3. Cada PC espera a `maestro:8031` (donde se anotan los NodeManagers) y
   prende su NodeManager.

Un DataNode nuevo se anota solo: no hay que avisarle al NameNode que
existe. Esto es lo que permite que el aula "crezca" sumando PCs (ver la
[guía 2](../02-sumar-pcs.md)). En un cluster de producción se suele limitar
con una lista de nodos permitidos (`dfs.hosts`); la imagen no la usa.

## El punto débil: el maestro

En el aula hay **un solo NameNode** y **un solo ResourceManager**, los dos
en el maestro. Son **puntos únicos de falla**:

- Si se cae una PC, el cluster sigue (eso es lo que muestra la [guía
  1](../01-aula-simulada.md#7-una-pc-que-se-cae)).
- Si se cae el maestro, HDFS deja de contestar (nadie sabe dónde está cada
  bloque) y no se pueden lanzar trabajos. Los bloques siguen en los discos
  de las PCs; al volver el maestro, el NameNode lee sus metadatos del
  volumen, los DataNodes le reportan sus bloques y todo sigue.

La solución en producción es la **alta disponibilidad**: dos o más
NameNodes con ZooKeeper y JournalNodes. La imagen la tiene, pero solo con
`ROL=solo` ([guía 9 de `base`](../../09-zookeeper-ha.md)); con `maestro` o
`trabajador`, `NAMENODES` distinto de 1 corta el arranque.

## Lo que el aula simulada **no** muestra

El aula simulada son varios contenedores en **una** compu, en una red de
Docker. Es un cluster de verdad para Hadoop (procesos separados, nombres
distintos, red entre ellos), pero:

- Todos comparten la CPU, la RAM y el disco de la compu: no hay ganancia de
  velocidad por "tener más máquinas".
- La red entre contenedores es local: no hay latencia ni cortes reales.
- Si se apaga la compu, se apaga todo el cluster.

Lo que sí muestra igual que con PCs reales: racks, colocación de réplicas,
heartbeats, nodos muertos, re-replicación, trabajos repartidos y la
configuración que necesita cada nodo.

## Resumen

- Pseudo-distribuido: todos los procesos en una máquina. Cluster: cada
  nodo con su parte, coordinados por un maestro.
- El maestro maneja **metadatos** y decide; los trabajadores manejan
  **datos** y hacen el trabajo.
- Cada nodo se configura solo al arrancar con `ROL`, `MAESTRO` y su
  `hostname`.
- En el aula el maestro es punto único de falla; las PCs no.

Preguntas: [evaluación, cluster y racks](../evaluacion/01-cluster-y-racks.md).

[Teoría](README.md) · Siguiente: [2. Réplicas y racks →](02-replicas-y-racks.md)
