# Evaluación: HDFS desde la interfaz

Sobre la [guía 3](../03-hdfs.md), el paso 7 de la [guía 2](../02-cluster-y-sinoptico.md)
y la teoría de [salud de HDFS](../teoria/salud-hdfs.md).

[← Evaluación](README.md) · [Índice de full](../README.md)

## Opción múltiple

### 1. Subís `ventas_grandes.csv` (5,9 MB) con bloque de 1 MB y réplica 2. ¿Cuántas copias de bloques quedan en los DataNodes?

- a) 6
- b) 12
- c) 2
- d) 18

<details><summary>Respuesta</summary>

**b) 12.** 5,9 MB en bloques de 1 MB son 6 bloques (el último, más chico), y
cada uno tiene 2 copias: 6 × 2 = 12. Es lo que dice el detalle: "Copias 12
de 12 (réplica 2)".

- a) 6 son los bloques, no las copias.
- c) 2 es la réplica, la cantidad de copias **de cada** bloque.
- d) 18 sería con réplica 3.
</details>

### 2. Apagás un DataNode. ¿Qué pasa a los 10 segundos?

- a) El NameNode ya copió sus bloques a otro DataNode.
- b) La lámpara está *caída*, pero el NameNode todavía no lo dio por muerto y no copió nada.
- c) Los archivos que tenían bloques ahí quedan perdidos.
- d) HDFS entra en modo seguro.

<details><summary>Respuesta</summary>

**b).** El proceso ya no está (por eso la lámpara cambia enseguida), pero el
NameNode solo nota que faltan latidos. En el sandbox lo da por muerto a los
40 s (2 × 5 s + 10 × 3 s) y recién ahí encola la re-replicación.

- a) No copia nada mientras el nodo solo está callado: podría volver.
- c) Con réplica 2 o más, los bloques siguen teniendo otra copia viva.
- d) El modo seguro es del arranque del NameNode, no de la caída de un DataNode.
</details>

### 3. `hdfs fsck /` dice `Status: HEALTHY` y `Under-replicated blocks: 2`. ¿Qué significa?

- a) Es una contradicción: si hay bloques sub-replicados no puede estar HEALTHY.
- b) Hay 2 bloques perdidos.
- c) Ningún bloque se perdió, pero 2 tienen menos copias de las que piden.
- d) El `fsck` está desactualizado y hay que correrlo de nuevo.

<details><summary>Respuesta</summary>

**c).** HEALTHY quiere decir que **ningún bloque se perdió** (todos tienen al
menos una copia viva), no que estén todas las copias. Es exactamente la salida
real de la teoría, con un DataNode muerto.

- a) No es contradicción: son dos medidas distintas.
- b) Perdidos sería `Missing blocks` mayor a 0, y el estado diría CORRUPT.
- d) `fsck` le pregunta al NameNode en el momento: no tiene caché.
</details>

### 4. Tenés 2 DataNodes vivos y cambiás la réplica de un archivo a 3. ¿Qué pasa?

- a) El comando falla.
- b) HDFS guarda dos copias en el mismo DataNode.
- c) El archivo queda sub-replicado hasta que haya un tercer DataNode.
- d) HDFS baja la réplica a 2 solo.

<details><summary>Respuesta</summary>

**c).** Cada copia tiene que ir en un DataNode distinto. Con 2 nodos solo
entran 2; el archivo queda marcado con réplica 3 y sub-replicado, y la
interfaz avisa "Con 2 DataNodes no entran 3 copias". Esos bloques no entran
en la cola de re-replicación: no hay adónde copiarlos.

- a) `setrep` no falla (por eso el servidor no le pone `-w` en ese caso:
  esperaría para siempre).
- b) Nunca se guardan dos copias del mismo bloque en el mismo nodo.
- d) La réplica no se corrige sola.
</details>

### 5. Movés un archivo de 2 GB a otra carpeta con **Mover**. ¿Cuánto dato viaja entre DataNodes?

- a) 2 GB.
- b) 2 GB por la réplica.
- c) Nada: el NameNode solo cambia la ruta.
- d) Depende del tamaño de bloque.

<details><summary>Respuesta</summary>

**c).** Mover (`hdfs dfs -mv`) es una operación de **metadatos**: los bloques
siguen en los mismos DataNodes. Por eso es instantáneo aunque el archivo
pese gigas. La interfaz lo dice: "No se copian datos: el NameNode solo cambia
la ruta."

- a), b), d) Serían ciertas para copiar (`-cp`), no para mover.
</details>

### 6. Sumás un DataNode con **Sumar**. ¿Qué tiene adentro?

- a) Una parte de los bloques que ya estaban, para emparejar.
- b) Nada: entra vacío y recibe lo que se escriba después.
- c) Una copia de todos los bloques.
- d) Los bloques del último DataNode que se cayó.

<details><summary>Respuesta</summary>

**b).** HDFS no reparte solo lo que ya estaba. El nodo nuevo recibe
escrituras nuevas y re-replicaciones; para emparejar existe el `balancer`.

- a) Eso es lo que hace el balancer, y hay que correrlo aparte.
- c) Eso multiplicaría la réplica.
- d) Las copias de un nodo muerto se reparten entre los vivos según elija el
  NameNode, no van a un nodo en particular.
</details>

### 7. ¿De dónde saca la pestaña **Archivos** la lista de una carpeta?

- a) De leer las carpetas de los DataNodes.
- b) De WebHDFS `LISTSTATUS` del NameNode.
- c) De la carpeta `/datos` del contenedor.
- d) Del Metastore de Hive.

<details><summary>Respuesta</summary>

**b).** El servidor llama a `:9870/webhdfs/v1<ruta>?op=LISTSTATUS`, que es lo
que da `hdfs dfs -ls`. El árbol de carpetas vive en el NameNode.

- a) Los DataNodes guardan bloques sueltos (`blk_…`), no carpetas ni nombres.
- c) `/datos` es el disco del contenedor, no HDFS.
- d) El Metastore sabe de tablas, no de cualquier archivo.
</details>

### 8. La columna **Lo escribió** dice *MapReduce*. ¿De dónde sale?

- a) HDFS guarda qué programa escribió cada archivo.
- b) La interfaz lo deduce por la ruta y el nombre (por ejemplo, `part-r-00000`).
- c) Del log de auditoría del NameNode.
- d) De YARN.

<details><summary>Respuesta</summary>

**b).** HDFS no guarda qué programa escribió un archivo: solo el usuario
dueño. La interfaz mira la ruta (`/user/hive/warehouse/…` es Hive) o el
nombre (`part-r-00000` es la salida de un reduce).

- a) No existe ese dato en HDFS.
- c) El audit log registra operaciones, pero la interfaz no lo lee.
- d) YARN sabe de trabajos, no de archivos.
</details>

## Desarrollo

### 1. Explicá por qué el NameNode espera antes de re-replicar los bloques de un DataNode que dejó de latir, y qué se arriesga si ese tiempo es muy corto o muy largo.

<details><summary>Respuesta modelo</summary>

Re-replicar cuesta: hay que copiar por la red todos los bloques que tenía el
nodo. Si el nodo solo se trabó unos segundos (una pausa de la JVM, la red
cargada) o se está reiniciando, copiar todo sería trabajo tirado, y cuando
vuelva habría copias de más que borrar. Por eso el NameNode lo marca primero
como *stale* (30 s) y lo da por muerto recién a los 2 × recheck + 10 ×
heartbeat (40 s en el sandbox, unos 10 minutos y medio con los valores de
fábrica).

Si el tiempo es muy **corto**, un problema pasajero dispara copias masivas
que saturan la red justo cuando el cluster ya está con problemas (y puede
encadenar más fallas). Si es muy **largo**, los bloques pasan mucho tiempo
con menos copias: si se cae otro nodo en ese lapso, se pueden perder.

Rúbrica: menciona el costo de copiar (1 punto), la posibilidad de que el
nodo vuelva (1), los dos riesgos opuestos (2), los números del sandbox o de
fábrica (1).
</details>

### 2. ¿Qué diferencia hay entre un bloque sub-replicado y un bloque perdido? ¿Cuál deja el `fsck` en CORRUPT?

<details><summary>Respuesta modelo</summary>

Un bloque **sub-replicado** tiene al menos una copia viva, pero menos de las
que pide su réplica: no se perdió nada, solo hay menos margen. El NameNode lo
encola para copiarlo apenas haya un DataNode destino. Un bloque **perdido**
no tiene ninguna copia viva: el dato no se puede leer hasta que vuelva un
nodo que lo tenga. Solo los perdidos (y los corruptos) dejan el `fsck` en
CORRUPT; los sub-replicados lo dejan en HEALTHY.

Rúbrica: define los dos (2 puntos), dice cuál cambia el estado (1), menciona
la cola o que el perdido no se puede leer (1).
</details>

### 3. ¿Por qué mover un archivo es instantáneo y copiarlo no, aunque pesen lo mismo?

<details><summary>Respuesta modelo</summary>

Porque HDFS separa **metadatos** (en el NameNode: nombres, carpetas, qué
bloques forman cada archivo) de **datos** (los bloques, en los DataNodes).
Mover solo cambia el nombre en el NameNode: ningún bloque se toca. Copiar
crea un archivo nuevo con bloques nuevos, que hay que leer y escribir con
todas sus réplicas.

Rúbrica: distingue metadatos de datos (2), explica qué hace cada operación
(2).
</details>

## Ejercicios sobre la interfaz

### Ejercicio 1. La falla a propósito

Con 3 DataNodes y réplica 2: subí `ventas_grandes.csv` con bloque de 1 MB,
apagá el DataNode que más bloques tenga de ese archivo y, sin tocar nada
más, anotá: (a) qué dice la fila del DataNode a los 10 s, (b) cuándo
aparecen tareas en la **Cola de re-replicación**, (c) cuántas copias tiene
cada bloque al final y (d) qué dice el `fsck` de la pestaña Salud.

<details><summary>Solución</summary>

(a) *sin latidos · muerto en N s*, con el cartel **Degradado**. (b) Recién
cuando el NameNode lo da por muerto, unos 40 s después del apagado. (c) Todas
vuelven a 2 (12 de 12), ahora repartidas entre los dos DataNodes vivos. (d)
HEALTHY, con 0 sub-replicados al final (durante la copia, sub-replicados
mayor a 0 y todavía HEALTHY).

Rúbrica: cada punto bien, 1. Un punto extra si explica por qué la cola
estuvo vacía los primeros 40 s.
</details>

### Ejercicio 2. Más copias que nodos

Con 2 DataNodes, cambiá la réplica de un archivo a 3 desde **Réplica**.
¿Qué avisa el diálogo antes de aplicar? Después de aplicar, ¿qué muestran el
mapa de bloques, la etiqueta de salud y la cola de re-replicación? ¿Qué
tenés que hacer para que quede sano?

<details><summary>Solución</summary>

El diálogo avisa "Con 2 DataNodes no entran 3 copias: … sub-replicados hasta
que sumes nodos." En el mapa, la columna **Copias** de cada bloque dice `2 / 3`; la
etiqueta dice *N bloques sub-replicados*; la cola no tiene tareas para esos
bloques porque no hay destino. Para que quede sano: sumar un DataNode
(**Sumar** en la pestaña DataNodes) o bajar la réplica a 2.

Rúbrica: el aviso (1), los tres lugares (3), las dos salidas posibles (2).
</details>

### Ejercicio 3. De la interfaz a la terminal

Hacé en la interfaz: crear la carpeta `/user/root/prueba`, subir
`texto.txt` ahí, cambiarle la réplica a 1 y borrarla. Después, en la
**Consola**, encontrá los cuatro comandos y escribilos.

<details><summary>Solución</summary>

1. `hdfs dfs -mkdir -p /user/root/prueba`
2. `hdfs dfs -put -f texto.txt /user/root/prueba/` (la subida repite antes
   el `-mkdir -p` de la carpeta destino; con réplica o bloque distintos de
   los del cluster, el `-put` lleva además las opciones `-D` que elegiste)
3. `hdfs dfs -setrep -w 1 /user/root/prueba/texto.txt` (el servidor le
   pone `-w`, esperar a que quede la réplica pedida, solo si alcanzan los
   DataNodes vivos; con réplica 1 siempre alcanzan)
4. `hdfs dfs -rm -r -skipTrash /user/root/prueba`

Rúbrica: cada comando bien, 1; un punto extra si nota que el borrado es sin
papelera.
</details>
