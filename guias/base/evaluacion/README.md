# Evaluación

Preguntas y ejercicios de cada tema de la versión `base`, con sus respuestas.
Sirven para dos cosas: que el alumno compruebe solo lo que entendió, o que el
profe arme un examen o un trabajo práctico.

[Versión base](../README.md) · [Teoría](../teoria/README.md) · [Referencia](../referencia.md)

## Los temas

| # | Tema | Teoría | Guía |
|---|---|---|---|
| 1 | [Big Data y el ecosistema Hadoop](01-big-data.md) | [Introducción](../teoria/01-big-data.md) | [1](../../01-instalacion.md) y [2](../../02-arrancar-y-apagar.md) |
| 2 | [HDFS](02-hdfs.md) | [HDFS](../teoria/02-hdfs.md) | [3](../../03-hdfs.md) |
| 3 | [YARN y MapReduce](03-yarn-mapreduce.md) | [YARN y MapReduce](../teoria/03-yarn-mapreduce.md) | [4](../../04-yarn-mapreduce.md) |
| 4 | [Pig](04-pig.md) | [Pig](../teoria/04-pig.md) | [5](../../05-pig.md) |
| 5 | [Hive](05-hive.md) | [Hive](../teoria/05-hive.md) | [6](../../06-hive.md) |
| 6 | [Sqoop y bases relacionales](06-sqoop.md) | [Sqoop](../teoria/06-sqoop.md) | [7](../../07-mysql-sqoop.md) |
| 7 | [Spark](07-spark.md) | [Spark](../teoria/07-spark.md) | [8](../../08-spark.md) |
| 8 | [ZooKeeper y HA](08-zookeeper-ha.md) | [ZooKeeper y HA](../teoria/08-zookeeper-ha.md) | [9](../../09-zookeeper-ha.md) |
| 9 | [MongoDB y NoSQL](09-mongodb.md) | [MongoDB y NoSQL](../teoria/09-mongodb.md) | [10](../../10-mongodb.md) |

## Qué tiene cada tema

1. **Opción múltiple**: cuatro opciones, una sola correcta. La respuesta está
   plegada (*Respuesta*): dice cuál es la correcta, por qué, y por qué no las
   otras. Equivocarse con un distractor dice qué idea falta repasar.
2. **Desarrollo**: preguntas para contestar con tus palabras, en un párrafo o
   dos. La respuesta modelo dice lo que no puede faltar; no hace falta
   repetirla palabra por palabra.
3. **Ejercicios sobre la imagen**: se resuelven con el cluster prendido. Cada
   uno tiene la solución (plegada) y una **rúbrica**: qué se mira para
   corregirlo y cuánto vale cada parte.

Los resultados numéricos de los ejercicios son **exactos**: los datos de
ejemplo se generan siempre iguales (semilla fija), así que a todos les tiene
que dar lo mismo. Si a alguien le da distinto, algo del procedimiento está
mal (o los datos se cargaron dos veces).

## Para el alumno

- Hacé primero la guía del tema y leé la teoría. Después contestá el multiple
  choice **sin mirar las respuestas**, y recién al final abrilas todas.
- En los ejercicios, intentá antes de abrir la solución. Si no sale, la
  [referencia](../referencia.md) tiene los comandos y las opciones.
- Las preguntas de desarrollo se contestan por escrito. Compará tu respuesta
  con la modelo: ¿están las ideas que pide la rúbrica?

## Para el profe

- Para un examen escrito: elegí preguntas de opción múltiple y de desarrollo
  de uno o varios temas. Las respuestas están en este mismo archivo, así que
  el examen se arma copiando las preguntas sin los bloques *Respuesta*.
- Para un trabajo práctico: los ejercicios sobre la imagen. El resultado
  numérico exacto permite corregir rápido, y la rúbrica reparte el puntaje
  entre el resultado, el procedimiento y la explicación.
- Una variante para que no se copien entre ellos: el generador de ventas
  acepta otra cantidad de filas (`python3 ejemplos/generar_ventas.py 100000`).
  Con otra cantidad, los números cambian, pero todos los que usen la misma
  cantidad obtienen los mismos.
- Los ejercicios suponen el cluster de la guía 2 (`DATANODES=3`,
  `REPLICATION=2`, `BLOCK_SIZE=1m`, `MONGODB=si`) con las guías anteriores del
  tema hechas: las ventas en `/user/root/ventas`, la tabla `ventas` en Hive,
  etc. Cada ejercicio dice qué necesita.

## Las marcas de los bloques

Igual que en las guías, cada bloque de comandos lleva una marca invisible que
dice dónde se corre: `adentro` (en el contenedor, parado en `/datos`), `compu`
(en tu compu) o `no` con el motivo (por ejemplo, porque es una consola
interactiva o un comando que solo se usa como ejemplo). La herramienta
`pruebas/tutoriales.py --revisar` controla que ninguno quede sin marca.
