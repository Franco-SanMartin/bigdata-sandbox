# Teoría

Los conceptos detrás de cada guía: qué problema resuelve cada herramienta,
cómo funciona por dentro, qué ventajas y qué limitaciones tiene, y en qué
parte de las guías se ve cada idea funcionando. Está pensada para una materia
universitaria de Big Data: se puede leer antes de la guía (para llegar con la
idea) o después (para entender lo que se vio).

[← Versión base](../README.md) · [Índice de guías](../../README.md)

## Temas

| # | Tema | Qué vas a entender | Guía |
|---|---|---|---|
| 1 | [Introducción a Big Data](01-big-data.md) | Las V, batch y streaming, el ecosistema Hadoop, la arquitectura maestro-trabajador y por qué se lleva el cómputo a los datos | [1](../../01-instalacion.md), [2](../../02-arrancar-y-apagar.md) |
| 2 | [HDFS](02-hdfs.md) | Bloques, réplicas, NameNode y DataNodes, cómo se lee y se escribe, qué pasa cuando se cae un nodo | [3](../../03-hdfs.md) |
| 3 | [YARN y MapReduce](03-yarn-mapreduce.md) | Cómo se reparten los recursos del cluster y el modelo map → shuffle → reduce | [4](../../04-yarn-mapreduce.md) |
| 4 | [Pig](04-pig.md) | Un lenguaje de flujo de datos y cómo se traduce a trabajos MapReduce | [5](../../05-pig.md) |
| 5 | [Hive](05-hive.md) | SQL sobre archivos: metastore, *schema on read*, tablas externas y administradas, Tez | [6](../../06-hive.md) |
| 6 | [Sqoop](06-sqoop.md) | Mover datos entre bases relacionales y HDFS: import, export, paralelismo | [7](../../07-mysql-sqoop.md) |
| 7 | [Spark](07-spark.md) | Procesamiento en memoria: driver y executors, DataFrames, evaluación *lazy*, el DAG | [8](../../08-spark.md) |
| 8 | [ZooKeeper y alta disponibilidad](08-zookeeper-ha.md) | Coordinación distribuida, quórum, elección de líder y el failover del NameNode | [9](../../09-zookeeper-ha.md) |
| 9 | [MongoDB y NoSQL](09-mongodb.md) | Las familias NoSQL, el modelo de documentos, CAP, agregación e índices | [10](../../10-mongodb.md) |

## Cómo leerla

- Cada tema empieza por los **conceptos** (el vocabulario), sigue con **cómo
  funciona por dentro** (con diagramas), las **ventajas y limitaciones** y
  termina con **dónde lo ves en las guías**: qué paso de la guía muestra cada
  idea.
- Los números de los ejemplos (200.000 ventas, 6 bloques, 8 productos) son los
  de las guías: el dataset se genera siempre igual, así que lo que dice la
  teoría se puede comprobar en el cluster.
- Para los comandos y opciones de cada componente, la
  [referencia](../referencia.md). Para comprobar lo que aprendiste, la
  [evaluación](../evaluacion/README.md).

## Un mismo cálculo, cinco herramientas

El hilo de toda la materia es un solo problema: **las ventas por producto** de
un almacén (unidades y facturado) sobre 200.000 ventas. Se resuelve con
MapReduce, Pig, Hive y Spark, y la misma idea aparece en MongoDB con sus
pedidos. Comparar las soluciones es la mejor forma de entender qué aporta cada
capa:

```text
  nivel de abstracción
        ^
        |   Hive (SQL)          SELECT producto, SUM(...) GROUP BY producto
        |   Spark (DataFrames)  df.groupBy("producto").agg(...)
        |   Pig (flujo)         GROUP ... BY producto; FOREACH ... SUM(...)
        |   MapReduce           mapper.py + reducer.py (+ Hadoop Streaming)
        |   YARN                contenedores de memoria y CPU
        |   HDFS                bloques de 1 MB replicados en DataNodes
        +-------------------------------------------------------------->
```

Las capas de arriba no reemplazan a las de abajo: se apoyan en ellas. Una
consulta de Hive termina siendo un trabajo de Tez en contenedores de YARN que
leen bloques de HDFS.
