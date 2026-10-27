# Versión `base`: documentación completa

La imagen `franki678/bigdata-sandbox:base` es **la de la materia**: un cluster
de Hadoop entero (HDFS, YARN, MapReduce), con Pig, Hive sobre Tez, Spark,
Sqoop con una base MySQL de ejemplo, ZooKeeper para la alta disponibilidad y
MongoDB, todo en un solo contenedor. Cada componente corre como un proceso
aparte, con su página web, y la arquitectura de HDFS (cuántos DataNodes y
NameNodes, cuántas réplicas, de qué tamaño los bloques) se elige en el
`docker run`.

[← Índice de guías](../README.md)

## Para quién es

- **Alumnos** de una materia de Big Data que quieren practicar con el Hadoop
  de verdad en su compu, sin un cluster de la facultad.
- **Docentes** que necesitan que toda el aula tenga el mismo entorno, con los
  mismos datos y los mismos resultados (los datasets de ejemplo se generan
  siempre iguales).
- Cualquiera que quiera entender cómo se arma un cluster de Big Data por
  dentro: nada está escondido, cada proceso se ve con `estado` y con `jps`.

Las otras versiones (`ml`, `full`, `empresa`) son `base` con cosas
agregadas: todo lo que dice esta documentación vale también para ellas.

## Qué trae

Las versiones salen del `Dockerfile` (los `ARG ..._VERSION` del principio y
las imágenes de base):

| Componente | Versión | Para qué |
|---|---|---|
| Sistema | Ubuntu 24.04 (`eclipse-temurin:8-jdk-noble`) | La base de la imagen, para amd64 y ARM64 |
| Java | 8 (JDK, no solo el runtime: Sqoop compila una clase por tabla) | Todo el ecosistema Hadoop corre sobre la JVM |
| Python | 3.12 (el de Ubuntu 24.04) | PySpark y los scripts de Hadoop Streaming |
| **Hadoop**: HDFS, YARN, MapReduce | 3.3.6 | Almacenamiento distribuido, reparto de recursos y procesamiento batch |
| **Tez** | 0.10.3 | El motor que ejecuta las consultas de Hive |
| **Hive**: Metastore y HiveServer2 | 4.0.0 | SQL sobre archivos de HDFS |
| **Pig** | 0.18.0 | Pig Latin: procesar datos paso a paso, se traduce a MapReduce |
| **Spark** (build `bin-hadoop3`, con soporte Hive) | 3.5.9 | Procesamiento en memoria sobre YARN; comparte las tablas con Hive |
| **Sqoop** | 1.4.7 (con el driver JDBC `mysql-connector-java` 5.1.49) | Copiar tablas entre una base relacional y HDFS |
| **MySQL** (MariaDB) | 10.11 (el paquete de Ubuntu 24.04) | La base de ejemplo `tienda`, para Sqoop |
| **ZooKeeper** | 3.8.7 | Elige el NameNode activo en alta disponibilidad (solo con `NAMENODES` 2 o 3) |
| **MongoDB** y `mongosh` | 8.0 | Base NoSQL de documentos, con su propia base `tienda` (solo con `MONGODB=si`) |

El detalle de cada uno (qué hace, dónde se usa, cómo se usa acá) está en la
[referencia](referencia.md).

## Requisitos

Medidos en cada versión nueva de la imagen (Intel/AMD y ARM), los mismos
números del [README del repo](../../README.md#requisitos):

| | `base` | `base` + MongoDB |
|---|---:|---:|
| **RAM para Docker** (lo que hay que darle) | 6 GB | **7 GB** |
| RAM en uso, en reposo | 2,0 GB | 2,1 GB |
| RAM en uso, pico con trabajos | 5,8 GB | 5,8 GB |
| Descarga (`docker pull` o archivo del aula) | 1,36 GB | 1,36 GB |
| Disco, Linux | 2,23 GB | 2,23 GB |
| Disco, Docker Desktop (Windows/Mac) | ~3,6 GB | ~3,6 GB |

- Con menos servicios alcanza menos RAM: solo HDFS (`SERVICIOS=hdfs`), 4 GB;
  HDFS y YARN (`SERVICIOS=mapreduce`), 5 GB. Con alta disponibilidad
  (`NAMENODES=2` o `3`), 8 GB.
- MongoDB necesita un procesador Intel/AMD con **AVX** o un ARM moderno
  ([guía 1](../01-instalacion.md#tu-procesador-tiene-avx-para-mongodb)).
- En Windows la RAM de Docker la fija WSL, con el archivo `.wslconfig`
  ([guía 1](../01-instalacion.md#windows)).

## Cómo arrancarla

El camino completo, con las variantes para PowerShell y CMD, está en la
[guía 1](../01-instalacion.md) (instalar Docker y tener la imagen) y la
[guía 2](../02-arrancar-y-apagar.md) (crear el cluster). En resumen, desde una
terminal de Mac o Linux parada en una carpeta vacía:

<!-- prueba: no (es el mismo docker run de la guía 2, que es donde se prueba) -->
```bash
docker run -d --name bigdata --stop-timeout 20 \
  -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si \
  -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 \
  -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 \
  -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 \
  -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 \
  -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 \
  -v bigdata_hadoop:/hadoop -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox:base
```

Cuando el log (`docker logs -f bigdata`) dice **Cluster LISTO**, se entra con
`docker exec -it bigdata bash` y adentro `estado` muestra cada proceso con su
página web. Se apaga con `docker stop bigdata` y se vuelve a prender con
`docker start bigdata`: los datos quedan en el volumen `bigdata_hadoop`.

## Mapa de la documentación

Hay cuatro partes, y cada tema aparece en las cuatro:

| Parte | Qué tiene | Cuándo leerla |
|---|---|---|
| **Paso a paso** (las guías numeradas) | Los comandos, en orden, con lo que tiene que salir | Con la compu y el cluster prendido |
| **[Referencia](referencia.md)** | Qué hace cada componente, dónde se usa en la industria, sus comandos y opciones, puertos, parámetros, comandos propios de la imagen y carpetas | Como consulta, cuando no te acordás de algo |
| **[Teoría](teoria/README.md)** | Los conceptos y cómo funciona cada cosa por dentro, con sus ventajas y limitaciones | Antes o después de cada guía, para entender el porqué |
| **[Evaluación](evaluacion/README.md)** | Preguntas de opción múltiple, de desarrollo y ejercicios sobre la imagen, con respuestas y criterios de corrección | Para repasar, o para que el profe arme un examen |

### Por tema

| # | Tema | Paso a paso | Teoría | Evaluación |
|---|---|---|---|---|
| 0 | Big Data y el ecosistema Hadoop | [1. Instalación](../01-instalacion.md) y [2. Arrancar y apagar](../02-arrancar-y-apagar.md) | [Introducción](teoria/01-big-data.md) | [Introducción](evaluacion/01-big-data.md) |
| 1 | HDFS | [3. HDFS](../03-hdfs.md) | [HDFS](teoria/02-hdfs.md) | [HDFS](evaluacion/02-hdfs.md) |
| 2 | YARN y MapReduce | [4. YARN y MapReduce](../04-yarn-mapreduce.md) | [YARN y MapReduce](teoria/03-yarn-mapreduce.md) | [YARN y MapReduce](evaluacion/03-yarn-mapreduce.md) |
| 3 | Pig | [5. Pig](../05-pig.md) | [Pig](teoria/04-pig.md) | [Pig](evaluacion/04-pig.md) |
| 4 | Hive | [6. Hive](../06-hive.md) | [Hive](teoria/05-hive.md) | [Hive](evaluacion/05-hive.md) |
| 5 | Sqoop y bases relacionales | [7. MySQL y Sqoop](../07-mysql-sqoop.md) | [Sqoop](teoria/06-sqoop.md) | [Sqoop](evaluacion/06-sqoop.md) |
| 6 | Spark | [8. Spark](../08-spark.md) | [Spark](teoria/07-spark.md) | [Spark](evaluacion/07-spark.md) |
| 7 | ZooKeeper y alta disponibilidad | [9. ZooKeeper y HA](../09-zookeeper-ha.md) | [ZooKeeper y HA](teoria/08-zookeeper-ha.md) | [ZooKeeper y HA](evaluacion/08-zookeeper-ha.md) |
| 8 | MongoDB y NoSQL | [10. MongoDB](../10-mongodb.md) | [MongoDB y NoSQL](teoria/09-mongodb.md) | [MongoDB y NoSQL](evaluacion/09-mongodb.md) |
| | Cuando algo no anda | [11. Problemas](../11-problemas.md) | | |

## Orden sugerido de estudio

1. **Antes de tocar nada**: [Introducción a Big Data](teoria/01-big-data.md)
   (las V, batch y streaming, el ecosistema y la arquitectura
   maestro-trabajador).
2. **Preparar la compu**: guías [1](../01-instalacion.md) y
   [2](../02-arrancar-y-apagar.md). Con el cluster prendido, mirá `estado` y
   las páginas web: cada fila es una pieza de la arquitectura que viste en la
   introducción.
3. **Para cada tema, de HDFS a MongoDB**, el mismo ciclo:
   1. la teoría del tema (los conceptos),
   2. la guía numerada (los comandos, con el cluster prendido),
   3. la referencia del componente (las opciones que no aparecieron en la guía),
   4. la evaluación: primero el multiple choice, después los ejercicios
      sobre la imagen.
4. **El orden de los temas importa**: HDFS va primero porque todo lo demás lee
   y escribe ahí; YARN y MapReduce antes que Pig y Hive porque esos se
   traducen a trabajos de YARN; Sqoop después de Hive porque el ejemplo
   procesa en Hive lo que trae de MySQL; Spark después de Hive porque usa sus
   tablas. ZooKeeper y MongoDB son independientes: se pueden ver en cualquier
   momento después de HDFS.
5. **Al final**, el mismo cálculo (ventas por producto) hecho con MapReduce,
   Pig, Hive y Spark: compará cuántas líneas lleva cada uno, cuánto tarda y
   qué se ve en http://localhost:8088. Es la mejor forma de entender para qué
   sirve cada herramienta.
