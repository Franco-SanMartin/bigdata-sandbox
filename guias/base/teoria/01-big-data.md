# 1. Introducción a Big Data

Qué se entiende por Big Data, por qué no alcanza con una base de datos común,
y las ideas de arquitectura que se repiten en todas las herramientas de la
materia.

[← Teoría](README.md) · Siguiente: [2. HDFS →](02-hdfs.md)

## Qué es Big Data

Se habla de Big Data cuando los datos son tantos, llegan tan rápido o son tan
variados que **una sola máquina no alcanza** para guardarlos o procesarlos en
un tiempo útil, y hace falta repartir el trabajo entre muchas. No hay un
número mágico de terabytes: depende de qué hay que hacer y en cuánto tiempo.
Mil millones de filas son poco para contar una vez por mes y mucho para
responder en un segundo.

### Las V

La forma clásica de describirlo son las **tres V** (Laney, 2001), a las que
después se sumaron otras:

| V | Qué significa | Ejemplo |
|---|---|---|
| **Volumen** | La cantidad: no entra en un disco o no se procesa en una máquina en tiempo útil | Los registros de navegación de un sitio grande, años de transacciones de un banco |
| **Velocidad** | El ritmo al que llegan y al que hay que responder | Lecturas de sensores cada segundo, detección de fraude mientras se paga |
| **Variedad** | La forma: no todo son tablas | Texto, logs, JSON, imágenes, audio, además de tablas |
| **Veracidad** | La calidad: datos incompletos, duplicados o contradictorios | Formularios con campos vacíos, sensores que fallan |
| **Valor** | Si sirven para decidir algo | Guardar todo "por las dudas" cuesta y no siempre rinde |

Las tres primeras hablan del **problema técnico**; las dos últimas recuerdan
que juntar datos no es el objetivo.

### Datos estructurados, semiestructurados y no estructurados

- **Estructurados**: filas y columnas con tipo fijo (una tabla de MySQL, un
  CSV con encabezado). Es lo que procesa bien SQL.
- **Semiestructurados**: tienen estructura, pero flexible y anidada (JSON,
  XML, logs con formato). Cada registro puede tener campos distintos: es lo
  que guarda MongoDB.
- **No estructurados**: texto libre, imágenes, audio, video. Hay que
  extraerles la estructura antes de analizarlos.

## Escalar: hacia arriba o hacia los costados

Cuando una máquina no alcanza hay dos caminos:

```text
  Escalar verticalmente (scale up)        Escalar horizontalmente (scale out)

      +-----------------+                   +----+ +----+ +----+ +----+
      |   una máquina   |                   | PC | | PC | | PC | | PC |  ...
      |  más CPU, más   |                   +----+ +----+ +----+ +----+
      |  RAM, más disco |                      repartir datos y trabajo
      +-----------------+
   tiene techo y el precio crece             crece de a una máquina común;
   más rápido que la capacidad               hay que tolerar que alguna falle
```

Big Data elige **escalar horizontalmente** con máquinas comunes (*commodity
hardware*). Eso trae dos consecuencias que explican casi todo el diseño de
Hadoop:

1. **Las fallas son normales.** Con miles de discos, todos los días se rompe
   alguno. Por eso HDFS **replica** cada bloque y YARN **reintenta** las
   tareas que fallan: la tolerancia a fallas está en el software, no en
   hardware caro.
2. **Mover datos por la red es caro.** Copiar terabytes hasta donde está el
   programa tarda más que procesarlos. Por eso se hace al revés.

## Llevar el cómputo a los datos

Es la idea central de Hadoop (*data locality*): en vez de traer los datos a
un servidor de procesamiento, se manda el **programa** (unos KB) a las
máquinas que **ya tienen** los datos, y cada una procesa los suyos.

```text
   modelo tradicional                      modelo Hadoop

   [disco]--datos-->[servidor]             [nodo 1: bloque A + tarea A]
   [disco]--datos-->[  de     ]            [nodo 2: bloque B + tarea B]
   [disco]--datos-->[ cálculo ]            [nodo 3: bloque C + tarea C]
        la red es el cuello                   viaja el programa, no los datos;
        de botella                             solo viajan los resultados
```

Por eso HDFS (dónde están los datos) y YARN (dónde se corre) están en las
mismas máquinas: el planificador intenta poner cada tarea en un nodo que tenga
el bloque que va a leer.

## Arquitectura maestro-trabajador

Casi todas las herramientas del ecosistema tienen la misma forma: un
**maestro** que coordina y lleva los metadatos, y muchos **trabajadores** que
guardan o procesan.

| Sistema | Maestro | Trabajadores |
|---|---|---|
| HDFS | NameNode (qué bloques tiene cada archivo y dónde) | DataNodes (guardan los bloques) |
| YARN | ResourceManager (reparte memoria y CPU) | NodeManagers (corren los contenedores) |
| Un trabajo MapReduce o Tez | ApplicationMaster (coordina las tareas de ese trabajo) | Tareas en contenedores |
| Spark | Driver (arma el plan y reparte tareas) | Executors |
| Hive | HiveServer2 + Metastore (reciben el SQL, guardan el esquema) | El trabajo de Tez en YARN |

Ventaja: el maestro tiene la visión global y decide bien; los trabajadores son
intercambiables y se agregan sin cambiar nada. Problema: el maestro es un
**punto único de falla** y un posible cuello de botella. La solución es
replicarlo con un mecanismo que elija cuál manda (alta disponibilidad con
ZooKeeper, [tema 8](08-zookeeper-ha.md)).

En esta imagen todos los procesos corren en un solo contenedor, pero cada uno
es un proceso aparte que se comunica con los otros por la red, igual que en un
cluster de varias máquinas: por eso los conceptos se ven igual.

## Batch y streaming

| | Batch (por lotes) | Streaming (flujo) |
|---|---|---|
| Qué procesa | Un conjunto de datos ya guardado, completo | Eventos a medida que llegan, sin fin |
| Latencia | Minutos u horas | Milisegundos o segundos |
| Ejemplo | Ventas del mes por producto, el cierre del día | Alertas de fraude, tableros en vivo |
| Herramientas | MapReduce, Pig, Hive, Spark | Kafka (transporte), Flink, Spark Structured Streaming |

Todo lo de esta imagen es **batch**: se sube un archivo y se lo procesa
entero. Las arquitecturas reales suelen combinar los dos: la **arquitectura
Lambda** tiene una capa batch (exacta, lenta) y una de velocidad
(aproximada, inmediata) y junta los resultados; la **arquitectura Kappa**
trata todo como un flujo y re-procesa el historial pasándolo de nuevo por el
mismo flujo.

## El ecosistema Hadoop

Hadoop nació (2006) como implementación libre de dos papers de Google: el
**Google File System** (2003), que dio origen a HDFS, y **MapReduce** (2004).
Alrededor crecieron herramientas que se apoyan en esas dos:

```text
   +---------------------------------------------------------------+
   |  Acceso    Pig (flujo)   Hive (SQL)   Spark (DataFrames, SQL)  |
   +---------------------------------------------------------------+
   |  Motores   MapReduce      Tez                Spark              |
   +---------------------------------------------------------------+
   |  Recursos  YARN (ResourceManager + NodeManagers)                |
   +---------------------------------------------------------------+
   |  Datos     HDFS (NameNode + DataNodes)                          |
   +---------------------------------------------------------------+
   al costado:  Sqoop (ida y vuelta con bases relacionales)
                ZooKeeper (coordinación, alta disponibilidad)
   afuera:      MySQL (la base de la empresa)   MongoDB (NoSQL)
```

- **Almacenamiento**: HDFS guarda archivos enormes partidos en bloques.
- **Recursos**: YARN reparte memoria y CPU entre los trabajos de todos.
- **Procesamiento**: MapReduce (el original, a disco), Tez (un grafo de
  etapas, lo usa Hive) y Spark (en memoria).
- **Lenguajes de alto nivel**: Pig y Hive, para no escribir MapReduce a mano.
- **Integración**: Sqoop para las bases relacionales.
- **Coordinación**: ZooKeeper.

### Data warehouse y data lake

- Un **data warehouse** guarda datos ya limpios y con esquema fijo, pensados
  para consultas de negocio (*schema on write*: el esquema se valida al
  cargar).
- Un **data lake** guarda los datos crudos, como vienen, y les da forma al
  leerlos (*schema on read*). Es lo que se arma con HDFS + Hive: los CSV
  quedan como están y la tabla de Hive es solo una forma de leerlos.

Hoy la tendencia (*lakehouse*) es juntar las dos ideas: archivos en un data
lake con formatos de tabla (Delta Lake, Apache Iceberg, Apache Hudi) que
agregan transacciones y esquema.

## Ventajas y limitaciones del enfoque Hadoop

**Ventajas**

- Escala agregando máquinas comunes.
- Tolera fallas de discos y nodos sin perder datos ni trabajos.
- Guarda cualquier formato y decide el esquema al leer.
- Software libre, con un ecosistema enorme y probado.

**Limitaciones**

- Latencia alta: pensado para procesar mucho, no para responder rápido una
  consulta chica.
- Muchas piezas que configurar y operar (esta imagen trae más de diez
  procesos).
- Malo con muchos archivos chicos (cada uno ocupa memoria en el NameNode).
- Los archivos se escriben una vez y no se modifican en el medio: no sirve
  como base transaccional.
- En la nube perdió terreno frente al almacenamiento de objetos y los
  servicios administrados, aunque las ideas (bloques, réplicas,
  maestro-trabajador, llevar el cómputo a los datos) siguen siendo la base.

## En las guías lo ves cuando...

- **[Guía 2](../../02-arrancar-y-apagar.md)**: el comando `estado` muestra la
  arquitectura completa. Cada fila es un maestro o un trabajador de la tabla
  de arriba, con su página web.
- **[Guía 3](../../03-hdfs.md#se-cae-un-datanode)**: apagás un DataNode y el
  archivo se sigue leyendo. Es la tolerancia a fallas por software.
- **[Guía 4](../../04-yarn-mapreduce.md#ventas-por-producto-con-hadoop-streaming)**:
  `number of splits:6` muestra un mapper por bloque. Es llevar el cómputo a
  cada pedazo de los datos.
- **Guías 4 a 8**: el mismo cálculo con MapReduce, Pig, Hive y Spark. Son las
  capas del ecosistema, una encima de la otra.

Para repasar: [evaluación del tema](../evaluacion/01-big-data.md).
