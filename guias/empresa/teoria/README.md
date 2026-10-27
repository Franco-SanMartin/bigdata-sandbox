# Teoría de `empresa`

Lo que hay detrás del cluster del aula: qué cambia cuando Hadoop deja de
estar en una sola máquina. Cada tema dice qué hace la imagen (sale del
código) y cómo se ve en el [aula simulada](../01-aula-simulada.md), para
comprobarlo en vez de creerlo.

[Índice de `empresa`](../README.md) · [Referencia](../referencia.md) · [Evaluación](../evaluacion/README.md)

| # | Tema | Preguntas que responde |
|---|---|---|
| 1 | [De pseudo-distribuido a cluster](01-de-pseudo-a-cluster.md) | ¿Qué cambia entre `ROL=solo` y el aula? ¿Qué es un maestro y qué un trabajador? ¿Qué pasa si se cae el maestro? |
| 2 | [Réplicas y racks](02-replicas-y-racks.md) | ¿Dónde pone HDFS cada copia de un bloque? ¿Para qué sirven los racks y cómo los sabe? |
| 3 | [Fallas](03-fallas.md) | ¿Cómo se entera el NameNode de que una PC se cayó? ¿Qué hace después? ¿Y cuando vuelve? ¿Cómo se saca una PC "bien"? |
| 4 | [Políticas de almacenamiento y tiers](04-politicas-de-almacenamiento.md) | ¿Qué son `DISK` y `ARCHIVE`? ¿Por qué el maestro guarda una copia de todo? |
| 5 | [Localidad de datos y YARN con varios NodeManagers](05-localidad-y-yarn.md) | ¿Dónde corre cada tarea y por qué? ¿Qué es un map "local"? |
| 6 | [Redes](06-redes.md) | ¿Por qué el aula simulada anda y el laboratorio de verdad todavía no? ¿Qué mide la sonda? |
| 7 | [RAM por rol](07-ram-por-rol.md) | ¿Cuánta memoria necesita el maestro, cuánta cada PC y qué es `TRABAJADOR_RAM`? |

Se pueden leer en orden; el [orden de estudio](../README.md#orden-de-estudio)
del índice dice cuándo intercalar cada una con las guías. Al final de cada
tema hay un resumen corto y el link a sus preguntas en la
[evaluación](../evaluacion/README.md).

Lo que estos temas dan por sabido (qué es un bloque, el NameNode, un
DataNode, YARN, un map) está en las guías de [`base`](../../README.md),
sobre todo [HDFS](../../03-hdfs.md) y [YARN y
MapReduce](../../04-yarn-mapreduce.md).
