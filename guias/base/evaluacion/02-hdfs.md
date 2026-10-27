# Evaluación 2. HDFS

[← 1. Big Data](01-big-data.md) · [Evaluación](README.md) · Teoría: [HDFS](../teoria/02-hdfs.md) · Guía: [3. HDFS](../../03-hdfs.md) · Siguiente: [3. YARN y MapReduce →](03-yarn-mapreduce.md)

## Opción múltiple

**1.** ¿Qué guarda el NameNode?

- a) Los bloques de los archivos.
- b) Los metadatos: qué archivos y carpetas hay, en qué bloques está cada
  archivo y en qué DataNodes está cada bloque.
- c) Una copia de seguridad de los DataNodes.
- d) Los resultados de los trabajos de MapReduce.

<details><summary>Respuesta</summary>

**b)** El NameNode es el maestro: tiene en memoria el espacio de nombres y el
mapa de bloques.

- a) Los bloques los guardan los DataNodes; los datos ni siquiera pasan por
  el NameNode.
- c) No hay copia de los DataNodes: la protección son las réplicas entre
  DataNodes.
- d) Los resultados son archivos en HDFS como cualquier otro: sus bloques
  están en los DataNodes.

</details>

**2.** `ventas_grandes.csv` pesa 6.213.191 bytes y se sube con
`BLOCK_SIZE=1m`. ¿En cuántos bloques queda y cuánto ocupa el último?

- a) 6 bloques; el último ocupa 1 MB, como todos.
- b) 6 bloques; el último ocupa solo lo que tiene (970.311 bytes).
- c) 7 bloques, porque se redondea para arriba con un bloque de reserva.
- d) 1 bloque, porque el tamaño de bloque es un máximo por archivo.

<details><summary>Respuesta</summary>

**b)** 6.213.191 / 1.048.576 = 5,9: cinco bloques llenos y un sexto de
970.311 bytes. Un bloque de HDFS no ocupa en disco más que lo que tiene.

- a) El último bloque no se rellena hasta el tamaño de bloque.
- c) No existe un bloque de reserva.
- d) El tamaño de bloque es el de **cada** bloque; un archivo más grande se
  parte.

</details>

**3.** ¿Por qué HDFS usa bloques tan grandes (128 MB de fábrica)?

- a) Para que el NameNode tenga pocos bloques que recordar y que el tiempo de
  leer un bloque sea mucho mayor que el de buscarlo.
- b) Porque los discos no aceptan bloques más chicos.
- c) Para ahorrar espacio con los archivos chicos.
- d) Porque así no hace falta replicar.

<details><summary>Respuesta</summary>

**a)** Menos metadatos en la memoria del NameNode, transferencias largas y
mappers de un tamaño razonable.

- b) Los discos usan bloques de unos KB; el bloque de HDFS es una unidad
  lógica encima.
- c) Los archivos chicos son justamente el punto débil de HDFS (un archivo de
  1 KB es un bloque, y una entrada en la memoria del NameNode).
- d) El tamaño de bloque y la replicación son independientes.

</details>

**4.** Al escribir un bloque con replicación 2, ¿cómo viajan los datos?

- a) Del cliente al NameNode, y del NameNode a los dos DataNodes.
- b) Del cliente a los dos DataNodes a la vez, por separado.
- c) Del cliente al primer DataNode, que los reenvía al segundo
  (pipeline); las confirmaciones vuelven por el mismo camino.
- d) Del cliente al primer DataNode; el segundo copia el bloque recién
  cuando termina el archivo.

<details><summary>Respuesta</summary>

**c)** El NameNode solo dice a qué DataNodes va el bloque; los datos van en
cadena de DataNode a DataNode.

- a) Si los datos pasaran por el NameNode, sería el cuello de botella de todo
  el cluster.
- b) El cliente manda una sola vez; la cadena reparte el ancho de banda.
- d) La réplica se escribe mientras llega el bloque, no al final.

</details>

**5.** Con `REPLICATION=3` y `DATANODES=2`, un archivo nuevo:

- a) Queda con 3 réplicas, dos de ellas en el mismo DataNode.
- b) Queda sub-replicado: 2 réplicas, porque dos réplicas de un bloque nunca
  van al mismo DataNode.
- c) No se puede subir: `put` falla.
- d) Queda con 1 réplica.

<details><summary>Respuesta</summary>

**b)** No hay un tercer DataNode distinto. El archivo se lee bien, y `fsck`
lo informa como *under-replicated*.

- a) Dos copias en el mismo nodo no protegerían de nada si ese nodo se cae.
- c) La subida funciona: HDFS escribe las réplicas que puede.
- d) Pone tantas como DataNodes distintos haya, hasta la replicación pedida.

</details>

**6.** Se apaga un DataNode con `REPLICATION=2`. ¿Qué pasa en el cluster de
la imagen?

- a) Los archivos que tenían bloques ahí quedan perdidos hasta que vuelva.
- b) Los archivos se siguen leyendo de la otra réplica; a los ~40 s el
  NameNode lo da por muerto y copia de nuevo los bloques sub-replicados a los
  DataNodes vivos.
- c) HDFS entra en safe mode hasta que vuelva.
- d) El NameNode se apaga para no perder consistencia.

<details><summary>Respuesta</summary>

**b)** Es lo que muestra la guía: el md5 da igual con el DataNode 2 apagado,
y `hdfs fsck /` va mostrando cómo bajan los *Under-replicated blocks*.

- a) Eso pasa con `REPLICATION=1` (los bloques quedan `MISSING`).
- c) El safe mode es del arranque del NameNode, no de la caída de un
  DataNode.
- d) La caída de un trabajador no afecta al maestro.

</details>

**7.** Cuando el DataNode caído vuelve, sus bloques ya fueron copiados a
otros nodos. ¿Qué hace el NameNode?

- a) Borra todo el DataNode que volvió.
- b) Nada: esos bloques quedan con una réplica de más para siempre.
- c) Detecta los bloques sobre-replicados y borra las copias que sobran.
- d) Lo rechaza hasta que se formatee.

<details><summary>Respuesta</summary>

**c)** El NameNode mantiene cada bloque en su replicación pedida, en las dos
direcciones: copia lo que falta y borra lo que sobra.

- a) Solo sobran algunos bloques, no todos.
- b) El exceso se corrige: ocupa disco sin necesidad.
- d) El DataNode vuelve a reportar sus bloques y se reincorpora normalmente.

</details>

**8.** ¿Qué hace el Secondary NameNode?

- a) Reemplaza al NameNode si se cae.
- b) Atiende las lecturas para descargar al NameNode.
- c) Junta periódicamente la fsimage y los edits en una fsimage nueva
  (checkpoint), para que los edits no crezcan sin fin.
- d) Guarda una tercera réplica de cada bloque.

<details><summary>Respuesta</summary>

**c)** Es un ayudante de mantenimiento: hace el checkpoint y se lo devuelve
al NameNode.

- a) Es la confusión clásica por el nombre. Para reemplazar al NameNode está
  la alta disponibilidad (guía 9).
- b) No atiende a los clientes.
- d) No guarda bloques.

</details>

**9.** Al arrancar, el NameNode pasa un rato en **safe mode**. ¿Por qué?

- a) Porque está verificando el md5 de cada archivo.
- b) Porque la fsimage no dice dónde está cada bloque: espera los block
  reports de los DataNodes, y mientras tanto HDFS es de solo lectura.
- c) Porque está copiando los bloques al Secondary NameNode.
- d) Porque espera que YARN arranque.

<details><summary>Respuesta</summary>

**b)** La ubicación de los bloques se reconstruye con lo que reportan los
DataNodes. Sale del safe mode cuando la gran mayoría de los bloques (el
99,9 %) tiene al menos una réplica reportada.

- a) Los checksums se verifican al leer, no al arrancar.
- c) El Secondary no guarda bloques.
- d) HDFS no depende de YARN; es al revés.

</details>

**10.** ¿Por qué HDFS anda mal con millones de archivos chicos?

- a) Porque cada archivo y cada bloque ocupa memoria en el NameNode, y cada
  archivo chico es además un mapper diminuto.
- b) Porque los DataNodes tienen un límite de archivos por disco.
- c) Porque no se pueden replicar.
- d) Porque `hdfs dfs -put` solo acepta archivos de más de 128 MB.

<details><summary>Respuesta</summary>

**a)** Pocos datos pero muchos metadatos (del orden de 150 bytes por
objeto en la memoria del NameNode) y miles de tareas cortas.

- b) El límite que importa es la memoria del NameNode.
- c) Se replican igual que los grandes.
- d) `put` acepta archivos de cualquier tamaño (la guía sube uno de 7 líneas).

</details>

## Desarrollo

**1.** Explicá qué pasa, paso a paso, cuando un cliente lee
`/user/root/ventas/ventas_grandes.csv`. ¿Por qué el NameNode no es un cuello
de botella para la lectura?

<details><summary>Respuesta modelo</summary>

1. El cliente le pregunta al NameNode por el archivo y recibe la lista de sus
   6 bloques y, para cada uno, los DataNodes que lo tienen, ordenados por
   cercanía.
2. Lee cada bloque **directamente del DataNode**, verificando los checksums.
3. Si un DataNode no responde o un checksum no coincide, pasa a otra réplica
   (y avisa de la dañada).

El NameNode solo responde una consulta de metadatos chica por archivo; los
datos, que son el volumen grande, viajan entre los DataNodes y el cliente.
Por eso el cluster puede leer en paralelo desde todos los DataNodes a la vez.

</details>

**2.** ¿Qué son la fsimage y los edits? ¿Qué pasaría con el arranque del
NameNode si nunca se hiciera un checkpoint?

<details><summary>Respuesta modelo</summary>

La **fsimage** es una foto completa del espacio de nombres (archivos,
carpetas, bloques de cada archivo) en un momento. Los **edits** son el
registro de cada cambio posterior; cada cambio se escribe ahí antes de
confirmarse, para no perderlo si se corta la luz.

Al arrancar, el NameNode carga la fsimage y reproduce los edits. Sin
checkpoints, los edits crecerían sin fin y cada arranque tardaría más
(reproducir meses de cambios). El checkpoint (que hace el Secondary NameNode,
o el standby con HA) junta los dos en una fsimage nueva y empieza edits
vacíos.

</details>

**3.** Compará `REPLICATION=1`, `2` y `3` en cuanto a espacio en disco,
tolerancia a fallas y costo de escritura.

<details><summary>Respuesta modelo</summary>

| Replicación | Disco | Tolera | Escritura |
|---|---|---|---|
| 1 | 1× | Ninguna caída: un DataNode apagado deja sus bloques `MISSING` | La más rápida |
| 2 | 2× | La caída de un DataNode | Pipeline de 2 |
| 3 (la de fábrica) | 3× | La caída de dos DataNodes; con racks, la de un rack entero | Pipeline de 3, más tráfico |

Más réplicas también dan más opciones al planificador para correr una tarea
donde está el dato. El costo es el espacio, y por eso existe el *erasure
coding* para datos fríos.

</details>

**4.** Si HDFS tiene tantas ventajas, ¿por qué no sirve como disco para una
base de datos transaccional?

<details><summary>Respuesta modelo</summary>

Porque está pensado para archivos grandes que se escriben una vez y se leen
muchas (*write once, read many*): no se puede modificar el medio de un
archivo, solo agregar al final. Además, cada operación pasa por el NameNode y
la red, con latencias que no sirven para miles de operaciones chicas por
segundo. Una base transaccional necesita lo contrario: actualizaciones
puntuales, rápidas y en el lugar. HDFS es para leer mucho de corrido.

</details>

## Ejercicios sobre la imagen

Suponen la [guía 3](../../03-hdfs.md) hecha: `ventas_grandes.csv` en `/datos`
y en `/user/root/ventas`.

### Ejercicio 1. Mapa de bloques

Con `fsck`, armá una tabla con cada bloque de `ventas_grandes.csv` y los
DataNodes que tienen sus réplicas (por el puerto). Contestá: ¿cuántos
bloques hay?, ¿cuántas réplicas en total?, ¿algún DataNode tiene las dos
réplicas de un mismo bloque?

<details><summary>Solución</summary>

<!-- prueba: adentro | espera: HEALTHY -->
```bash
hdfs fsck /user/root/ventas/ventas_grandes.csv -files -blocks -locations
```

- 6 bloques (`blk_...`), cada uno con `Live_repl=2`: 12 réplicas.
- Cada bloque lista dos `DatanodeInfoWithStorage[127.0.0.1:<puerto>]`
  **distintos**: nunca dos réplicas en el mismo DataNode. El puerto (9911 a
  9913) dice cuál es el DataNode 1, 2 o 3.
- El reparto exacto entre DataNodes cambia de una subida a otra: no hay una
  única tabla correcta.

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| Usa `fsck` con `-files -blocks -locations` | 2 |
| Tabla con los 6 bloques y sus DataNodes | 3 |
| 12 réplicas en total (6 × 2) | 2 |
| Observa que las réplicas de un bloque están en DataNodes distintos y por qué | 3 |

### Ejercicio 2. Otro tamaño de bloque

El tamaño de bloque se elige **al subir** el archivo. Subí
`ventas_grandes.csv` a `/user/root/bloques2m` con bloques de 2 MB y
comparalo con el de 1 MB. ¿Cuántos bloques tiene? ¿Cuántos mappers tendría un
MapReduce sobre ese archivo?

<details><summary>Solución</summary>

La opción `-D` cambia una propiedad de la configuración solo para ese
comando:

<!-- prueba: no (solución de ejercicio: la opción -D no se usa en las guías probadas) -->
```bash
hdfs dfs -mkdir -p /user/root/bloques2m
hdfs dfs -D dfs.blocksize=2m -put -f ventas_grandes.csv /user/root/bloques2m/
hdfs fsck /user/root/bloques2m/ventas_grandes.csv -files -blocks
```

- 6.213.191 / 2.097.152 = 2,96: **3 bloques** (dos de 2 MB y uno de
  ~1,9 MB). Con 4 MB serían 2.
- Un MapReduce sobre ese archivo tendría **3 mappers** (uno por bloque), la
  mitad que con 1 MB.
- No se puede usar para cambiar el bloque de un archivo ya subido: hay que
  subirlo de nuevo.

Para no confundir a la guía 4, borrá la carpeta al terminar
(`hdfs dfs -rm -r /user/root/bloques2m`). No la dejes adentro de
`/user/root/ventas`: los ejemplos leen **todos** los archivos de esa carpeta y
contarían las ventas dos veces.

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| Sube con `-D dfs.blocksize=2m` (o equivalente) a otra carpeta | 3 |
| 3 bloques, con la cuenta | 3 |
| Relaciona bloques con mappers (3) | 2 |
| Advierte que no se puede cambiar el bloque sin volver a subir | 2 |

### Ejercicio 3. Seguir una re-replicación

Apagá el DataNode 3, esperá un minuto y seguí con `fsck` el estado de todo
HDFS hasta que no queden bloques sub-replicados. Después prendelo y explicá
qué pasa con los bloques que tenía.

<details><summary>Solución</summary>

<!-- prueba: adentro | espera: DataNode 3 apagado -->
```bash
datanode stop 3
sleep 60
datanode
hdfs fsck / | tail -20
```

Repetir `hdfs fsck / | tail -20` hasta que *Under-replicated blocks* llegue
a 0. Después:

<!-- prueba: adentro | espera: DataNode 3 prendido | espera: HEALTHY -->
```bash
datanode start 3
sleep 30
hdfs fsck / | tail -20
```

- Con el DataNode 3 apagado, el NameNode lo da por muerto a los ~40 s. Sus
  bloques quedan con una réplica y el NameNode los copia a los DataNodes 1 y
  2, hasta volver a 2 réplicas. El estado sigue siendo `HEALTHY`: nada está
  perdido, solo sub-replicado.
- Al volver, el DataNode 3 reporta sus bloques, que ahora tienen una réplica
  de más (*over-replicated*). El NameNode borra las sobrantes. En 9870 →
  *Datanodes*, el 3 vuelve a figurar vivo.

</details>

**Rúbrica (10 puntos)**

| Criterio | Puntos |
|---|---:|
| Apaga y prende el DataNode con los comandos de la imagen | 2 |
| Muestra la evolución de los sub-replicados con `fsck` | 3 |
| Explica por qué no se pierde nada (replicación 2) | 2 |
| Explica qué pasa con las réplicas sobrantes al volver | 3 |

### Ejercicio 4. Replicación por archivo y safe mode

1. Subí `ejemplos/ventas.csv` a `/user/root/prueba` y dejalo con replicación
   1. Confirmalo con `-ls`.
2. Preguntale al NameNode si está en safe mode.
3. Explicá qué pasaría con ese archivo si se apaga el DataNode que tiene su
   único bloque.

<details><summary>Solución</summary>

<!-- prueba: adentro | espera: Replication 1 set | espera: Safe mode is OFF -->
```bash
hdfs dfs -mkdir -p /user/root/prueba
hdfs dfs -put -f ejemplos/ventas.csv /user/root/prueba/
hdfs dfs -setrep -w 1 /user/root/prueba/ventas.csv
hdfs dfs -ls /user/root/prueba
hdfs dfsadmin -safemode get
hdfs dfs -rm -r /user/root/prueba
```

1. La segunda columna de `-ls` dice 1. La replicación es una propiedad de
   cada archivo, y se cambia sin volver a subirlo (al revés que el tamaño de
   bloque).
2. `Safe mode is OFF`: el cluster ya arrancó y acepta escrituras.
3. Su único bloque quedaría `MISSING` y el archivo no se podría leer hasta
   que el DataNode vuelva. Si su disco se rompiera, el archivo se perdería.

</details>

**Rúbrica (8 puntos)**: replicación 1 aplicada y verificada (3), safe mode
consultado e interpretado (2), consecuencia de la caída bien explicada (3).
