# Evaluación 2: fallas

Teoría: [fallas](../teoria/03-fallas.md).

[← 1. Cluster y racks](01-cluster-y-racks.md) · [Evaluación](README.md) · Siguiente: [3. Almacenamiento →](03-almacenamiento.md)

## Opción múltiple

**1.** ¿Cómo se entera el NameNode de que un DataNode sigue vivo?

- a) El NameNode le hace ping cada un minuto.
- b) El DataNode le manda un heartbeat cada pocos segundos.
- c) Por Docker: sabe qué contenedores están prendidos.
- d) No se entera hasta que alguien intenta leer un bloque.

<details><summary>Respuesta</summary>

**b)** Cada DataNode manda heartbeats (`dfs.heartbeat.interval`, 3 s) y en
la respuesta recibe órdenes (copiar, borrar).

- a) Es al revés: el que avisa es el DataNode.
- c) Hadoop no sabe nada de Docker; con PCs de verdad no habría Docker
  entre ellas.
- d) Se entera por la falta de heartbeats, sin que nadie lea nada.

</details>

**2.** Con la configuración de la imagen (heartbeat 3 s, recheck 5 s), ¿a
los cuántos segundos se da por muerto un DataNode que se apagó?

- a) 3 s
- b) 15 s
- c) 40 s
- d) 630 s

<details><summary>Respuesta</summary>

**c)** `2 × 5 + 10 × 3 = 40` segundos.

- a) Es un solo heartbeat: perder uno no alcanza (puede ser un atraso).
- b) No sale de la fórmula.
- d) Es el valor de fábrica de Hadoop (recheck de 300 s): 10,5 minutos.

</details>

**3.** ¿Por qué Hadoop de fábrica espera más de 10 minutos para dar por
muerto un DataNode?

- a) Porque el NameNode es lento.
- b) Para no copiar todos los bloques de un nodo que solo se está
  reiniciando y vuelve en unos minutos.
- c) Porque los heartbeats se mandan cada 10 minutos.
- d) Por un error de Hadoop que la imagen corrige.

<details><summary>Respuesta</summary>

**b)** Re-replicar un nodo de un cluster real puede ser mover terabytes;
esperar evita hacerlo por un reinicio.

- a) No es un tema de velocidad: es una decisión.
- c) Los heartbeats son cada 3 s.
- d) No es un error: la imagen lo acorta para que se vea en clase.

</details>

**4.** En el aula simulada con dos PCs (replicación 3), se apaga pc02. ¿Qué
pasa con los bloques?

- a) Se pierden los que estaban en pc02.
- b) Quedan sub-replicados y HDFS los copia enseguida a otra PC.
- c) Quedan sub-replicados y siguen así: no hay otro nodo donde poner la
  tercera copia.
- d) HDFS baja la replicación a 2.

<details><summary>Respuesta</summary>

**c)** Quedan maestro y pc01, que ya tienen una réplica cada uno. Un nodo
no guarda dos copias del mismo bloque.

- a) Cada bloque sigue en el maestro y en pc01: se sigue leyendo.
- b) Pasaría con una tercera PC (guía 1, sección 8).
- d) La replicación del archivo no cambia sola.

</details>

**5.** Con bloques sub-replicados, `hdfs fsck /` dice...

- a) `CORRUPT`
- b) `HEALTHY`, con `Under-replicated blocks` mayor que 0
- c) `MISSING`
- d) Nada: fsck no corre si falta un nodo

<details><summary>Respuesta</summary>

**b)** Para fsck "sano" quiere decir sin bloques perdidos ni corruptos. Un
bloque con menos réplicas de las pedidas se puede leer.

- a) `CORRUPT` es cuando hay bloques sin ninguna réplica viva (o
  corruptos).
- c) No es un estado del resumen de fsck: los bloques perdidos se cuentan
  en `Missing blocks` y el estado pasa a `CORRUPT`.
- d) fsck pregunta al NameNode: anda con nodos caídos.

</details>

**6.** ¿Quién copia los bloques durante la re-replicación?

- a) El NameNode lee el bloque y lo escribe en otro DataNode.
- b) Un DataNode con una réplica sana se lo manda directo a otro DataNode,
  por orden del NameNode.
- c) El cliente que subió el archivo, la próxima vez que se conecta.
- d) El ResourceManager, con un trabajo de MapReduce.

<details><summary>Respuesta</summary>

**b)** El NameNode decide (origen y destino) y manda la orden en el
heartbeat; los bytes van de DataNode a DataNode.

- a) Los datos no pasan por el NameNode.
- c) El cliente no participa.
- d) YARN no tiene nada que ver con la re-replicación.

</details>

**7.** Una PC que estaba muerta vuelve, pero sus bloques ya se habían
re-replicado en otro lado. ¿Qué pasa?

- a) Se borra todo su disco.
- b) Esos bloques quedan sobre-replicados y el NameNode manda borrar las
  copias que sobran.
- c) Quedan con una réplica de más para siempre.
- d) La PC no puede volver a sumarse.

<details><summary>Respuesta</summary>

**b)** Al anotarse reporta sus bloques; los que ya tenían su replicación
completa ahora tienen una copia de más. El NameNode elige cuál borrar,
cuidando racks y políticas.

- a) Solo se borran las copias que sobran.
- c) El NameNode lo corrige solo (`Over-replicated blocks` vuelve a 0).
- d) Se suma como cualquier DataNode.

</details>

**8.** ¿Para qué sirve el decommission?

- a) Para formatear un DataNode.
- b) Para sacar un nodo de forma ordenada: primero se copian sus bloques a
  otros y después se apaga, sin que nada quede sub-replicado.
- c) Para apagar el NameNode.
- d) Para borrar archivos viejos.

<details><summary>Respuesta</summary>

**b)** Se agrega el nodo a la lista de exclusión y `hdfs dfsadmin
-refreshNodes`. La imagen no lo configura: en el aula se ve solo el caso
de la falla.

- a) No borra nada del nodo.
- c) Es para DataNodes, no para el NameNode.
- d) No tiene que ver con archivos.

</details>

**9.** Se cae una PC mientras corre un MapReduce. Tenía dos maps
terminados y uno a medias. ¿Qué vuelve a correr?

- a) Nada: el trabajo falla.
- b) Solo el map a medias.
- c) El map a medias y también los dos terminados, porque su salida estaba
  en el disco de esa PC y los reduces todavía la necesitan.
- d) Todo el trabajo desde cero.

<details><summary>Respuesta</summary>

**c)** La salida de un map se guarda en el disco local del nodo y los
reduces la leen de ahí (shuffle). Si el nodo desaparece, esa salida
también.

- a) MapReduce reintenta las tareas en otros nodos.
- b) Faltaría la salida de los maps terminados.
- d) Solo se repiten las tareas afectadas.

</details>

**10.** Se reinicia el maestro con todas las PCs apagadas. ¿Sale HDFS de
safe mode?

- a) No: faltan todos los bloques de las PCs.
- b) Sí: el DataNode `ARCHIVE` del maestro tiene una réplica de cada
  bloque, así que todos tienen al menos una.
- c) Sí, pero borra los bloques que no encuentra.
- d) No arranca el NameNode sin DataNodes.

<details><summary>Respuesta</summary>

**b)** Safe mode termina cuando casi todos los bloques (99,9%) tienen al
menos una réplica reportada. Por la política `WARM`, el maestro tiene una
de cada uno.

- a) Sería cierto sin la copia del maestro.
- c) El NameNode no borra bloques por no encontrarlos.
- d) El NameNode arranca igual; lo que espera es a salir de safe mode.

</details>

## Desarrollo

**1.** Contá paso a paso qué pasa en HDFS desde que se apaga pc02 (en un
aula con tres PCs) hasta que todo vuelve a estar bien, y qué pasa cuando
pc02 vuelve.

<details><summary>Respuesta modelo</summary>

1. pc02 deja de mandar heartbeats.
2. A los ~40 s (2 × recheck de 5 s + 10 × heartbeat de 3 s) el NameNode la
   marca muerta. Deja de mandarle lecturas.
3. Los bloques que tenían réplica en pc02 quedan sub-replicados. Se siguen
   leyendo desde las otras réplicas, y fsck sigue diciendo `HEALTHY`.
4. El NameNode los pone en la cola de re-replicación y le ordena a un
   DataNode con una réplica sana copiarla a uno que no tenga (pc01 o pc03,
   según cuál falte), respetando racks y la política `WARM`.
5. `UnderReplicatedBlocks` baja a 0.
6. pc02 vuelve: su DataNode se anota y reporta sus bloques viejos. Esos
   bloques tienen ahora una copia de más (sobre-replicados).
7. El NameNode elige qué copia sobra y manda borrarla. `Over-replicated
   blocks` vuelve a 0.

Puntos que no pueden faltar: heartbeats y el plazo; sub-replicado sin
pérdida; copia de DataNode a DataNode; sobre-replicación al volver.

</details>

**2.** ¿Por qué la imagen acorta el plazo para dar por muerto un DataNode y
por qué en producción no conviene hacer lo mismo?

<details><summary>Respuesta modelo</summary>

La imagen pone el recheck en 5 s (de fábrica 300 s) para que un nodo caído
se marque muerto en ~40 s y en una clase se vea la re-replicación sin
esperar 10 minutos. En producción, un plazo tan corto haría que cualquier
reinicio, corte de red breve o pausa larga de la JVM dispare la copia de
todos los bloques de ese nodo, que en un cluster real puede ser mucho
volumen y cargar la red; y al volver el nodo, habría que borrar todas esas
copias de más.

</details>

**3.** Explicá la diferencia entre un bloque sub-replicado, uno
sobre-replicado y uno perdido. ¿Cuál es grave?

<details><summary>Respuesta modelo</summary>

Sub-replicado: tiene menos réplicas vivas que la replicación del archivo
(por ejemplo 2 de 3); se lee igual y HDFS intenta completarlo.
Sobre-replicado: tiene más (por ejemplo 4 de 3), típicamente porque volvió
un nodo; HDFS borra las de más. Perdido (*missing*): no tiene ninguna
réplica viva; no se puede leer y fsck dice `CORRUPT`. El grave es el
perdido; los otros dos HDFS los arregla solo.

</details>

[← 1. Cluster y racks](01-cluster-y-racks.md) · [Evaluación](README.md) · Siguiente: [3. Almacenamiento →](03-almacenamiento.md)
