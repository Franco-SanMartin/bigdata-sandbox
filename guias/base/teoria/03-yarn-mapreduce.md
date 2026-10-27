# 3. YARN y MapReduce

Dos ideas distintas que en Hadoop van juntas: **YARN** reparte los recursos
del cluster entre los trabajos, y **MapReduce** es un modelo para escribir
esos trabajos de forma que se repartan solos entre muchas máquinas.

[← 2. HDFS](02-hdfs.md) · [Teoría](README.md) · Siguiente: [4. Pig →](04-pig.md)

## Conceptos

| Concepto | Qué es |
|---|---|
| **YARN** | *Yet Another Resource Negotiator*: el administrador de recursos de Hadoop desde la versión 2 |
| **ResourceManager (RM)** | El maestro de YARN: conoce la memoria y la CPU libres de cada nodo y decide a qué trabajo le toca cada pedazo |
| **NodeManager (NM)** | El trabajador de YARN, uno por nodo: lanza los contenedores, los vigila y los mata si se pasan de memoria |
| **Contenedor** | Una porción de memoria y CPU de un nodo, asignada a un trabajo, donde corre un proceso (una tarea) |
| **ApplicationMaster (AM)** | El "jefe" de **un** trabajo: le pide contenedores al RM y reparte las tareas. Cada trabajo trae el suyo (MapReduce, Tez y Spark tienen el propio) |
| **Scheduler** | La política del RM para repartir: FIFO, *Capacity* (colas con porcentajes, la de fábrica en Hadoop 3) o *Fair* (partes iguales) |
| **Map** | Función que recibe un registro y emite cero o más pares clave → valor |
| **Shuffle** | El paso, a cargo de Hadoop, que junta, ordena y reparte los pares por clave entre los reducers |
| **Reduce** | Función que recibe una clave con **todos** sus valores y emite el resultado |
| **Input split** | El pedazo de la entrada que procesa un mapper (normalmente, un bloque de HDFS) |
| **Combiner** | Un "mini reduce" que corre en cada mapper antes del shuffle, para mandar menos datos por la red |
| **Partitioner** | Decide a qué reducer va cada clave (de fábrica, *hash* de la clave módulo la cantidad de reducers) |

## YARN por dentro

Antes de YARN (Hadoop 1), un solo proceso (el *JobTracker*) repartía los
recursos **y** seguía cada tarea de cada trabajo MapReduce: era un cuello de
botella y solo servía para MapReduce. YARN separó las dos cosas: el
ResourceManager solo reparte, y cada trabajo trae su propio ApplicationMaster.
Gracias a eso, en el mismo cluster corren MapReduce, Tez (Hive), Spark y
cualquier otro motor.

```text
  cliente (hadoop jar, pig, beeline, spark-submit)
     | 1. envía el trabajo
     v
  +------------------------+
  |    ResourceManager     |  2. le da un contenedor para el ApplicationMaster
  |  (scheduler + apps)    |<----------------------------------+
  +------------------------+                                   |
     | 3. el NodeManager lanza el AM                           | 4. el AM pide
     v                                                         |    contenedores
  +------------------------------- NodeManager --------------+  |    para las tareas
  |  [contenedor: ApplicationMaster] --------------------------+
  |  [contenedor: tarea map 1]  [contenedor: tarea map 2] ...  |  5. el AM lanza
  |  [contenedor: tarea reduce 1]                              |     y vigila las
  +-----------------------------------------------------------+     tareas
     6. al terminar, el AM avisa al RM y se liberan los contenedores
```

En esta imagen hay un solo NodeManager con **4096 MB** para contenedores, que
se asignan de a **512 MB** como mínimo. Caben a la vez 8 contenedores de 512
MB: el AM de un trabajo MapReduce más hasta 7 tareas. Un trabajo que pide más
de lo que hay libre queda en estado `ACCEPTED` (esperando) hasta que se libere
lugar. Una consola de `pyspark` abierta ocupa contenedores aunque no esté
haciendo nada.

## MapReduce por dentro

El programador escribe solo dos funciones, **map** y **reduce**; el resto
(repartir, ordenar, mover datos, reintentar lo que falla) lo hace el
framework. Las ventas por producto de la guía 4:

```text
  entrada en HDFS: 6 bloques  ->  6 input splits  ->  6 mappers en paralelo

  mapper 1 (bloque 1)            mapper 2 (bloque 2, filas de ejemplo) ...
  2026-01-31,Sur,azucar,5,1200   ...
     -> azucar  5  6000          -> yerba  2  5000
     -> bombilla 5 15000         -> azucar 1  1200
     -> ...                      -> ...

            |  SHUFFLE: cada par va al reducer de su clave (partitioner),     |
            |  se ordena por clave y se juntan los de todos los mappers      |
            v                                                                v

  reducer (con 1 reducer, todas las claves):
     azucar   [5 6000] [1 1200] [...]   ->  azucar     89796  107755200
     bombilla [5 15000] [...]           ->  bombilla   36281  108843000
     ...                                ->  ...
     yerba    [2 5000] [...]            ->  yerba     179512  448780000

  salida en HDFS: part-r-00000 (uno por reducer) + _SUCCESS
```

Paso a paso:

1. **Splits**: la entrada se divide en pedazos, normalmente uno por bloque.
   El ApplicationMaster intenta correr cada mapper en un nodo que tenga ese
   bloque (localidad).
2. **Map**: cada mapper lee su pedazo registro por registro y emite pares.
   Los pares se acumulan en un buffer en memoria; cuando se llena, se
   **ordenan por clave** y se vuelcan a disco local (*spill*), ya separados
   por reducer de destino. Si hay combiner, se aplica acá.
3. **Shuffle**: cada reducer **copia** de todos los mappers la parte que le
   toca (por la red) y las **mezcla** manteniendo el orden.
4. **Reduce**: recorre las claves en orden. Para cada una recibe la lista de
   sus valores y escribe el resultado en HDFS (replicado).

Por qué **la salida no puede existir**: si existiera, una corrida que falla a
la mitad dejaría resultados mezclados con los de antes. Hadoop prefiere
negarse (`Output directory ... already exists`) y que lo borres a propósito.

### Hadoop Streaming

Los mappers y reducers "nativos" se escriben en Java. **Streaming** permite
usar cualquier programa: Hadoop le pasa los registros por la entrada estándar
y lee lo que escribe en la salida estándar. La convención es que **la clave es
lo que está antes del primer tab** y el resto es el valor. Por eso
`mapper.py` emite `producto<TAB>cantidad<TAB>importe`, y `reducer.py` puede
asumir que le llegan **ordenadas**: suma mientras el producto no cambia. En
una terminal, `sort` hace de shuffle (con un solo reducer, que es el valor de
fábrica de Hadoop).

### Tolerancia a fallas

- Si una tarea falla (o su nodo se cae), el ApplicationMaster la **reintenta**
  en otro contenedor, hasta 4 veces de fábrica. Como map y reduce son
  funciones que solo dependen de su entrada, repetirlas da el mismo
  resultado.
- La salida de los mappers está en disco local: si se pierde el nodo de un
  mapper terminado antes del shuffle, se vuelve a correr ese mapper.
- **Ejecución especulativa**: si una tarea va mucho más lenta que sus pares
  (un disco lento), se lanza una copia en otro nodo y se usa la que termine
  primero.

### Cuántos mappers y cuántos reducers

- **Mappers**: los decide la entrada (un split por bloque). 6 MB en bloques
  de 1 MB dan 6 mappers; en bloques de 128 MB, 1.
- **Reducers**: los decide el programador (`-D mapreduce.job.reduces=N`), 1
  de fábrica. Con N reducers hay N archivos `part-r-*`, cada uno con las
  claves que le tocaron. Con 0 reducers no hay shuffle y la salida es de los
  mappers (`part-m-*`): es lo que hace Sqoop.

## Ventajas y limitaciones

**Ventajas de MapReduce**

- Escala casi lineal: más bloques, más mappers en paralelo.
- Tolerancia a fallas simple y robusta (reintentar tareas).
- El programador no se ocupa de la red, del orden ni de los reintentos.

**Limitaciones de MapReduce**

- **Todo pasa por disco**: la salida de los map, el shuffle y el resultado
  final. Un cálculo de varias etapas son varios trabajos encadenados, cada
  uno escribiendo en HDFS. Para algoritmos iterativos (*machine learning*,
  grafos) es muy lento: ese es el hueco que llenan Tez y Spark.
- Arrancar un trabajo cuesta segundos (pedir contenedores, lanzar JVMs): no
  sirve para consultas interactivas.
- Expresar un JOIN o varios GROUP BY seguidos a mano es largo y propenso a
  errores: por eso aparecieron Pig y Hive.

**Ventajas de YARN**: varios motores comparten el mismo cluster y los mismos
datos, con colas y prioridades. **Limitación**: solo administra recursos de
un cluster Hadoop. Hoy Kubernetes cumple ese papel para todo tipo de
aplicaciones, y Spark y Flink corren directo sobre él.

## En la guía 4 lo ves cuando...

- **[MapReduce sin Hadoop](../../04-yarn-mapreduce.md#mapreduce-sin-hadoop)**:
  `mapper.py | sort | reducer.py` es el modelo entero en una tubería: el
  `sort` hace de shuffle.
- **[Wordcount en el cluster](../../04-yarn-mapreduce.md#wordcount-en-el-cluster)**:
  la salida es una carpeta con `part-r-00000` y `_SUCCESS`, y falla si ya
  existe.
- **[Ventas por producto con Hadoop Streaming](../../04-yarn-mapreduce.md#ventas-por-producto-con-hadoop-streaming)**:
  `number of splits:6`, un mapper por bloque de 1 MB, y los mismos scripts de
  Python repartidos con `-files`.
- **[YARN desde la terminal](../../04-yarn-mapreduce.md#yarn-desde-la-terminal)**:
  `yarn node -list` muestra el NodeManager y `yarn application -list` los
  trabajos. En http://localhost:8088 se ve el AM de cada trabajo y la memoria
  usada.

Para repasar: [evaluación de YARN y MapReduce](../evaluacion/03-yarn-mapreduce.md).
Comandos: referencia de [YARN](../referencia.md#yarn) y de
[MapReduce](../referencia.md#mapreduce-y-jobhistory).
