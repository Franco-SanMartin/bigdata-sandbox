# Guías

Un cluster de Big Data entero en tu compu, con la imagen
`franki678/bigdata-sandbox:base` (la versión `base`: Hadoop, Hive, Spark, Pig,
Sqoop, ZooKeeper, MySQL y MongoDB). Las guías van en orden: cada una usa lo
que quedó armado en las anteriores.

[← README del repo](../README.md)

| # | Guía | Qué se aprende |
|---|---|---|
| 1 | [Instalación](01-instalacion.md) | Instalar Docker (Windows, Mac, Linux) y tener la imagen: de Docker Hub, del archivo del aula o de un compañero |
| 2 | [Arrancar y apagar](02-arrancar-y-apagar.md) | Crear el cluster, entrar, las páginas web, apagar y prender, cambiar los parámetros |
| 3 | [HDFS](03-hdfs.md) | Subir y bajar archivos, bloques y réplicas, apagar un DataNode y ver que no se pierde nada |
| 4 | [YARN y MapReduce](04-yarn-mapreduce.md) | Cómo YARN reparte el trabajo; wordcount y un MapReduce propio en Python |
| 5 | [Pig](05-pig.md) | Procesar datos con scripts de Pig Latin, en el cluster y en modo local |
| 6 | [Hive](06-hive.md) | Tablas y SQL sobre HDFS, con `beeline` |
| 7 | [MySQL y Sqoop](07-mysql-sqoop.md) | Traer tablas de MySQL a HDFS, procesarlas con Hive y devolver el resultado |
| 8 | [Spark](08-spark.md) | DataFrames con PySpark y SQL sobre las tablas de Hive |
| 9 | [ZooKeeper y alta disponibilidad](09-zookeeper-ha.md) | Dos NameNodes, uno se cae y el otro toma el control |
| 10 | [MongoDB](10-mongodb.md) | Documentos, consultas, agregación, índices y la comparación con SQL |
| 11 | [Problemas](11-problemas.md) | Qué hacer cuando algo no anda, venir de la imagen anterior y empezar de cero |

Con la versión `full`, las guías 3 a 10 también están en la interfaz web, en
**Prácticas**: los mismos pasos hechos desde las pantallas, con un chequeo
contra el cluster en cada uno y el comando equivalente al lado. Las de acá
son las de la terminal.

## Cómo leer los comandos

Hay dos lugares donde se escriben comandos, y cada bloque dice cuál:

- **Tu compu** (PowerShell, CMD o la terminal de Mac/Linux): los que empiezan
  con `docker`.
- **Adentro** del contenedor (después de `docker exec -it bigdata bash`): todo
  lo demás (`hdfs`, `yarn`, `pig`, `beeline`, `sqoop`, `spark-submit`,
  `mongosh`...). Se sale con `exit`.

Adentro se arranca parado en `/datos`, que es la carpeta `datos/` de tu compu:
lo que guardes ahí lo ves de los dos lados. Los ejemplos están en
`/datos/ejemplos`.

Cada vez que cambia la imagen, GitHub corre **todos** los comandos de estas
guías contra ella y compara la salida con la que muestran: si una guía dice
que sale `448780000`, es porque salió.
