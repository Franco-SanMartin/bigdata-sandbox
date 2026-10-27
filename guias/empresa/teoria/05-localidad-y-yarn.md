# 5. Localidad de datos y YARN con varios NodeManagers

[← 4. Políticas de almacenamiento](04-politicas-de-almacenamiento.md) · [Teoría](README.md) · Siguiente: [6. Redes →](06-redes.md)

## Llevar el cómputo a los datos

Mover 128 MB por la red cuesta más que mover un programa de unos KB. La
idea central de Hadoop es **llevar el cómputo adonde están los datos**: si
un map tiene que procesar un bloque, conviene correrlo en una PC que ya
tenga una réplica de ese bloque, y leerlo de su propio disco.

Eso se llama **localidad de datos**, y tiene niveles:

| Nivel | Dónde corre la tarea | Cómo lee el bloque |
|---|---|---|
| **Data-local** (*node-local*) | En un nodo que tiene una réplica | De su propio disco |
| **Rack-local** | En otro nodo del mismo rack que una réplica | Por la red, sin salir del rack |
| **Off-switch** (otro rack) | En un nodo de otro rack | Por la red, cruzando racks |

En un solo contenedor todo es data-local siempre. En el aula ya no.

## Quién decide dónde corre cada tarea

En YARN hay dos niveles de decisión:

1. El **ResourceManager** (en el maestro) sabe cuánta memoria libre tiene
   cada NodeManager y reparte **contenedores** (pedazos de memoria en un
   nodo).
2. El **ApplicationMaster** de cada trabajo (que corre en un contenedor, en
   alguna PC) pide contenedores diciendo **dónde le gustaría**: para cada
   map, los nodos que tienen el bloque, y sus racks.

Con MapReduce:

- Cada bloque del archivo de entrada es un **split**, y cada split un map.
  El archivo de 8 bloques de la guía 1 da 8 maps.
- El ApplicationMaster le pregunta al NameNode dónde están las réplicas de
  cada bloque y pide un contenedor "en pc01 o pc02 (o en su rack)".
- El planificador del ResourceManager trata de darle ese nodo. Si no tiene
  lugar ahí, espera un poco (unas cuantas oportunidades) y después acepta
  un nodo del mismo rack, y después cualquiera.

Los reduces no tienen localidad: leen la salida de **todos** los maps, de
todas las PCs, por la red (el **shuffle**, que cada NodeManager sirve en el
puerto `13562`).

## En el aula

- El maestro **no corre tareas** (no tiene NodeManager, salvo
  `MAESTRO_NM=si`). La réplica `ARCHIVE` del maestro no sirve para
  localidad: de las 3 réplicas de cada bloque, las útiles son las 2 de las
  PCs.
- Con dos PCs y replicación 3, **cada PC tiene una réplica de cada
  bloque**: todos los maps pueden ser data-local, corran donde corran.
- Con más PCs, cada bloque está en dos de ellas: un map que cae en una
  tercera ya no es data-local.

Cómo verlo, después de un trabajo de MapReduce (guía 1, sección 4):

- En los **contadores** del final: `Data-local map tasks`, `Rack-local map
  tasks` y `Launched map tasks`.
- En el **JobHistory** (<http://localhost:19888>): en qué PC corrió cada
  map.

### ¿YARN ve los racks?

El script de racks de la imagen está configurado en `hdfs-site.xml`, la
configuración de HDFS. El ResourceManager arma su topología con su propia
configuración (`core-site.xml` y `yarn-site.xml`), donde el script no
está. Así que **no está garantizado que YARN conozca las filas**: puede ver
a todos los NodeManagers en `/default-rack` aunque HDFS sí las conozca. Las
pruebas de la imagen verifican los racks de HDFS, no los de YARN.

Se comprueba en <http://localhost:8088> → **Nodes**: la columna **Rack**
de cada NodeManager. Si dice `/default-rack`, para YARN "mismo rack" es
"cualquier PC", y la diferencia entre rack-local y otro rack no va a
significar nada en los contadores. La localidad por nodo (data-local) no
depende de esto: funciona por nombre de nodo.

## Varios NodeManagers: cómo se reparte la memoria

Cada NodeManager anuncia cuánta memoria presta para contenedores:
`yarn.nodemanager.resource.memory-mb`, que en el aula es `TRABAJADOR_RAM`
(2048 MB de fábrica). El ResourceManager suma: con dos PCs, 4096 MB para
todo el cluster.

Cada contenedor pide su memoria y YARN la redondea hacia arriba a un
múltiplo del mínimo (512 MB):

| Contenedor | Pide | Con 2048 MB por PC entran |
|---|---|---|
| Map o reduce (MapReduce) | 512 MB | 4 por PC |
| ApplicationMaster de MapReduce | 512 MB | |
| Tarea de Tez (Hive) | 1024 MB | 2 por PC |
| Executor de Spark | 512 MB + 384 MB de overhead → 1024 MB | 2 por PC |

Con los 8 maps de la guía 1 y dos PCs: un contenedor es el ApplicationMaster
y quedan 7 lugares de 512 MB: casi todos los maps corren a la vez, y el
resto en cuanto se libera uno.

`TRABAJADOR_RAM` también es el contenedor más grande que acepta el
ResourceManager (`yarn.scheduler.maximum-allocation-mb`): un trabajo que
pida más, no arranca.

## Spark y Hive en el aula

- **Spark** (`spark-submit --master yarn`, modo `client`): el **driver**
  corre en el nodo donde se lanzó (por ejemplo pc03), **fuera de YARN**; el
  ApplicationMaster y los 2 executors son contenedores en las PCs. Los
  executors le hablan al driver por la red, en puertos aleatorios.
- **Hive**: `beeline` se conecta a HiveServer2 en el maestro; HiveServer2
  lanza las consultas como trabajos de **Tez** en YARN, en las PCs. Las
  tablas se anotan en el Metastore del maestro, así que cualquier PC ve las
  mismas tablas.

## Resumen

- Localidad: correr la tarea donde está el bloque. Niveles: data-local,
  rack-local, otro rack.
- El ApplicationMaster pide nodos "preferidos"; el ResourceManager trata
  de dárselos.
- En el aula, la réplica del maestro no cuenta para localidad (no corre
  tareas).
- Cada PC presta `TRABAJADOR_RAM` MB; YARN los reparte en contenedores de
  512 MB o más.
- El driver de Spark en modo `client` está fuera de YARN, en el nodo que
  lanzó el trabajo.

Preguntas: [evaluación, YARN y localidad](../evaluacion/04-yarn-y-localidad.md).

[← 4. Políticas de almacenamiento](04-politicas-de-almacenamiento.md) · [Teoría](README.md) · Siguiente: [6. Redes →](06-redes.md)
