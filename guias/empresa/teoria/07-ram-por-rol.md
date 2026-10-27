# 7. RAM por rol

[← 6. Redes](06-redes.md) · [Teoría](README.md)

En un cluster, cada máquina tiene un papel y la memoria se dimensiona
según ese papel. En el aula, además, cada PC es la compu de un alumno, que
tiene que seguir andando. Este tema arma la cuenta.

## Dos tipos de memoria

1. **La de los servicios**: los procesos que están siempre prendidos
   (NameNode, DataNode, NodeManager...). Cada uno es una JVM con un tope
   (`-Xmx`).
2. **La de los trabajos**: los contenedores de YARN (maps, reduces,
   executors de Spark, tareas de Tez). Aparecen y desaparecen con cada
   trabajo.

La imagen le pone a cada servicio un tope chico y una JVM liviana (un solo
hilo de recolección de basura y solo el compilador rápido), porque son
muchos procesos en poco lugar. Los trabajos corren con la JVM normal.

## El maestro

| Servicio | Tope |
|---|---|
| NameNode | 384 MB |
| Secondary NameNode | 256 MB |
| DataNode (archivo) | 256 MB |
| ResourceManager | 384 MB |
| MapReduce JobHistory | 256 MB |
| Spark History Server | 256 MB |
| Hive Metastore | Sin tope puesto por la imagen |
| HiveServer2 | Sin tope puesto por la imagen |
| MariaDB | `innodb_buffer_pool_size = 32M` |
| NodeManager (solo con `MAESTRO_NM=si`) | 256 MB, más `TRABAJADOR_RAM` para trabajos |

Los topes con número suman 1792 MB. Hay que sumarle lo que cada JVM usa
**además** de su tope (clases, hilos, código compilado), Hive (que es de lo
más pesado) y MariaDB. Por eso el maestro es el nodo que más pide.

El NameNode guarda en memoria **todo el árbol de archivos y bloques**: su
memoria crece con la **cantidad** de archivos y bloques, no con los bytes.
Muchos archivos chicos (o bloques de 1 MB, como en las guías) gastan más
memoria del NameNode que pocos archivos grandes. Para un aula, 384 MB
sobran; en una empresa, el NameNode es una de las máquinas con más RAM.

## Cada PC (trabajador)

| Qué | Memoria |
|---|---|
| DataNode | 256 MB (tope) |
| NodeManager | 256 MB (tope) |
| Contenedores de YARN | Hasta `TRABAJADOR_RAM` (2048 MB de fábrica) |
| Driver de Spark, si el alumno lanza `spark-submit` desde esa PC | 512 MB, **fuera** de `TRABAJADOR_RAM` |

`TRABAJADOR_RAM` es lo que el NodeManager **anuncia** al ResourceManager,
no lo que reserva. YARN reparte esa memoria confiando en el número. Si
anunciás más de la que la PC (o Docker) tiene libre:

- YARN lanza contenedores que no entran en la memoria real.
- La compu empieza a usar swap y todo se pone lento, o el sistema mata
  procesos por falta de memoria (puede ser un DataNode, que se da por
  muerto).

Por eso el valor tiene un mínimo (1024) y un máximo (65536), y la regla
práctica es: **memoria libre para Docker en esa PC − servicios (~0,5 a 1
GB) − margen** = `TRABAJADOR_RAM`.

## Lo que pide cada trabajo

| Contenedor | Pide | YARN da |
|---|---|---|
| ApplicationMaster de MapReduce | 512 MB | 512 MB |
| Map / reduce | 512 MB | 512 MB |
| ApplicationMaster de Tez y tareas | 1024 MB | 1024 MB |
| ApplicationMaster de Spark (`spark.yarn.am.memory`) | 512 MB + 384 MB de overhead | 1024 MB |
| Executor de Spark (2 de fábrica) | 512 MB + 384 MB de overhead | 1024 MB |

YARN redondea cada pedido a un múltiplo de 512 MB (el mínimo,
`yarn.scheduler.minimum-allocation-mb`). El overhead de Spark es la memoria
fuera del heap de Java: de fábrica, el 10% o 384 MB, lo que sea más.

Ejemplo: un SparkPi en el aula de dos PCs con 2048 MB cada una (4096 MB en
total) pide 1024 (AM) + 2 × 1024 (executors) = 3072 MB de YARN. Entra. Si
dos alumnos lanzan uno a la vez, el segundo **espera** a que haya lugar: no
falla, queda en la cola de YARN (`ACCEPTED` en <http://localhost:8088>).

## Cuentas para el aula

**Aula simulada** (todo en una compu): un maestro y dos PCs piden **unos 8
GB libres para Docker**; cada PC que se suma, **unos 2 GB más**. Son los
números del archivo `aula-simulada.yml` y de las guías. Si los trabajos
llenan los 2048 MB de `TRABAJADOR_RAM` de cada PC, pueden pedir un poco
más.

**Laboratorio de verdad** (cuando exista la etapa 2), cada nodo en su PC:

| PC | Qué necesita |
|---|---|
| La del profe (maestro) | Todos los servicios del maestro: es la que más RAM necesita. Con `MAESTRO_NM=si`, además `TRABAJADOR_RAM` |
| Cada alumno | DataNode + NodeManager (~0,5 GB) + `TRABAJADOR_RAM` + lo que el alumno use en esa PC (navegador, editor) + el driver de Spark si lanza desde ahí |

La sonda anota la RAM de cada PC (`ram_gb`) y la que tiene Docker
(`docker_ram_mb`): con eso se elige `TRABAJADOR_RAM` para ese laboratorio.

La capacidad del cluster crece con las PCs: 20 PCs con 2048 MB son 40 GB
para trabajos, aunque ninguna PC tenga más de 8 GB. Esa es la gracia de un
cluster.

## `MAESTRO_NM`: ¿el profe también trabaja?

De fábrica, el maestro no corre trabajos (`MAESTRO_NM=no`):

- Sus servicios ya ocupan buena parte de su memoria.
- Si un trabajo lo dejara sin memoria, se caería el cluster entero
  (NameNode y ResourceManager están ahí), no una PC.

Con `MAESTRO_NM=si` suma su `TRABAJADOR_RAM` al cluster. Tiene sentido con
pocas PCs y un maestro con RAM de sobra. En la guía 2 se prueba:
`memoria total de YARN` pasa a contar tres NodeManagers.

## En la industria

- Los nodos maestros (NameNode, ResourceManager) suelen ser pocas máquinas
  con mucha RAM y discos confiables; los trabajadores, muchas máquinas
  iguales con muchos discos.
- La memoria para YARN de cada trabajador se calcula como "la RAM de la
  máquina menos lo que usan el sistema y los servicios", igual que acá.
- En la nube, se eligen tipos de máquina distintos para maestros y
  trabajadores, y los trabajadores se agregan o sacan según la carga.

## Resumen

- Dos memorias: la de los servicios (topes fijos) y la de los trabajos
  (`TRABAJADOR_RAM` por PC).
- El maestro es el que más necesita; una PC, ~0,5 GB de servicios más
  `TRABAJADOR_RAM`.
- `TRABAJADOR_RAM` se anuncia, no se reserva: anunciar de más rompe.
- Los contenedores se redondean a múltiplos de 512 MB; Spark suma 384 MB de
  overhead por contenedor.
- El driver de Spark en modo `client` está fuera de YARN.

Preguntas: [evaluación, redes y dimensionamiento](../evaluacion/05-redes-y-dimensionamiento.md).

[← 6. Redes](06-redes.md) · [Teoría](README.md)
