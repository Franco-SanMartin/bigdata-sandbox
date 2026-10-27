# Evaluación 4: YARN y localidad

Teoría: [localidad de datos y YARN](../teoria/05-localidad-y-yarn.md).

[← 3. Almacenamiento](03-almacenamiento.md) · [Evaluación](README.md) · Siguiente: [5. Redes y dimensionamiento →](05-redes-y-dimensionamiento.md)

## Opción múltiple

**1.** ¿Qué quiere decir que un map es *data-local*?

- a) Que lee un archivo del disco local de la PC del alumno, fuera de HDFS.
- b) Que corre en un nodo que tiene una réplica del bloque que procesa y lo
  lee de su propio disco.
- c) Que corre en el maestro.
- d) Que no usa la red para nada, ni siquiera para hablar con YARN.

<details><summary>Respuesta</summary>

**b)** Es llevar el cómputo adonde están los datos: el bloque no viaja por
la red.

- a) La entrada sigue siendo un archivo de HDFS.
- c) De fábrica, el maestro no corre tareas.
- d) La tarea igual habla con su ApplicationMaster; lo que no viaja es el
  bloque.

</details>

**2.** ¿Quién pide un contenedor "en pc01 o pc02, que tienen el bloque"?

- a) El NameNode.
- b) El ResourceManager.
- c) El ApplicationMaster del trabajo.
- d) El NodeManager de pc01.

<details><summary>Respuesta</summary>

**c)** El ApplicationMaster sabe qué bloques procesa cada map (le pregunta
al NameNode dónde están) y pide contenedores con esas preferencias.

- a) El NameNode solo contesta dónde están los bloques.
- b) El ResourceManager **da** los contenedores; trata de respetar la
  preferencia, pero no la arma.
- d) El NodeManager solo lanza lo que le mandan.

</details>

**3.** En el aula simulada (maestro más pc01 y pc02, replicación 3), ¿por
qué todos los maps pueden ser data-local?

- a) Porque el maestro corre todos los maps.
- b) Porque cada PC tiene una réplica de cada bloque.
- c) Porque YARN copia el bloque a la PC antes de empezar.
- d) Porque los archivos de las guías son chicos.

<details><summary>Respuesta</summary>

**b)** Tres réplicas: una en el maestro (`ARCHIVE`) y una en cada PC.
Cualquier PC donde caiga el map tiene el bloque.

- a) El maestro no tiene NodeManager de fábrica.
- c) YARN no copia bloques.
- d) El tamaño no cambia la localidad: lo que importa es dónde están las
  réplicas.

</details>

**4.** ¿Por qué la réplica del maestro no ayuda a la localidad?

- a) Porque es `ARCHIVE` y no se puede leer.
- b) Porque el maestro no corre tareas (no tiene NodeManager, salvo
  `MAESTRO_NM=si`).
- c) Porque está comprimida.
- d) Sí ayuda: es la preferida.

<details><summary>Respuesta</summary>

**b)** Para que un map lea "de su disco" tiene que correr en ese nodo.

- a) Las réplicas `ARCHIVE` se leen como cualquier otra.
- c) HDFS no comprime las réplicas según el tipo.
- d) Sin NodeManager ahí, ninguna tarea puede aprovecharla.

</details>

**5.** Con `TRABAJADOR_RAM=2048` y dos PCs, ¿cuánta memoria tiene YARN para
trabajos?

- a) 2048 MB
- b) 4096 MB
- c) 6144 MB, contando el maestro
- d) Toda la RAM de la compu

<details><summary>Respuesta</summary>

**b)** Cada NodeManager anuncia `TRABAJADOR_RAM`; el ResourceManager los
suma.

- a) Es lo de una sola PC.
- c) El maestro no presta memoria con `MAESTRO_NM=no`.
- d) YARN solo conoce lo que anuncian los NodeManagers.

</details>

**6.** Un executor de Spark se configura con 512 MB. ¿Cuánto le da YARN?

- a) 512 MB
- b) 896 MB
- c) 1024 MB
- d) 2048 MB

<details><summary>Respuesta</summary>

**c)** 512 MB más 384 MB de overhead son 896, y YARN redondea a un
múltiplo del mínimo (512): 1024.

- a) Falta el overhead.
- b) Es el pedido, sin redondear.
- d) Es `TRABAJADOR_RAM`, lo máximo que acepta un contenedor.

</details>

**7.** Lanzás `spark-submit --master yarn` desde pc02 (modo `client`).
¿Dónde corre el driver?

- a) En el maestro.
- b) En un contenedor de YARN, en cualquier PC.
- c) En pc02, fuera de YARN.
- d) En el NameNode.

<details><summary>Respuesta</summary>

**c)** En modo `client` el driver es el proceso que lanzaste. Su memoria no
sale de `TRABAJADOR_RAM`.

- a) El maestro no tiene nada que ver, salvo el ResourceManager.
- b) Eso sería modo `cluster`.
- d) El NameNode no corre programas.

</details>

**8.** Dos alumnos lanzan a la vez trabajos que juntos piden más memoria de
la que tiene YARN. ¿Qué pasa con el segundo?

- a) Falla con un error de memoria.
- b) Espera en la cola (`ACCEPTED`) hasta que se libere lugar.
- c) Le saca memoria al primero.
- d) Corre en el maestro.

<details><summary>Respuesta</summary>

**b)** YARN no lanza un contenedor si no hay lugar: el trabajo queda
esperando.

- a) Solo falla si un contenedor pide más que el máximo
  (`TRABAJADOR_RAM`).
- c) La imagen no configura nada de eso.
- d) El maestro no tiene NodeManager de fábrica.

</details>

**9.** ¿Por qué los reduces no tienen localidad?

- a) Porque corren en el maestro.
- b) Porque leen la salida de **todos** los maps, que está repartida en
  todas las PCs (el shuffle).
- c) Porque no leen nada.
- d) Sí tienen: corren donde está el archivo de salida.

<details><summary>Respuesta</summary>

**b)** Cada reduce junta su parte de la salida de cada map, por la red.

- a) Corren en las PCs, como los maps.
- c) Leen la salida de los maps.
- d) El archivo de salida todavía no existe: lo escribe el reduce.

</details>

**10.** ¿Dónde se ve en qué rack ubica YARN a cada NodeManager?

- a) En `hdfs fsck / -racks`.
- b) En <http://localhost:8088> → Nodes, columna Rack.
- c) En `hdfs dfsadmin -printTopology`.
- d) En el `aula-simulada.yml`.

<details><summary>Respuesta</summary>

**b)** Es la vista del ResourceManager.

- a) y c) Muestran la topología de **HDFS**, que no tiene por qué ser la
  misma que la de YARN: el script de racks está en la configuración de
  HDFS.
- d) El compose no dice nada de racks: solo pasa `PCS_POR_FILA`.

</details>

## Desarrollo

**1.** Explicá cómo se decide en qué PC corre cada map de un wordcount en
el aula, desde que se lanza el trabajo.

<details><summary>Respuesta modelo</summary>

1. El cliente le pide al ResourceManager que lance el trabajo; el
   ResourceManager le da un contenedor al ApplicationMaster en alguna PC.
2. El ApplicationMaster divide la entrada en splits (uno por bloque) y le
   pregunta al NameNode dónde está cada réplica.
3. Por cada map pide un contenedor de 512 MB con preferencia por los nodos
   que tienen el bloque (y sus racks).
4. El planificador del ResourceManager trata de darle un nodo preferido con
   lugar; si no hay, espera un poco y después acepta el mismo rack y luego
   cualquiera.
5. El ApplicationMaster le pide al NodeManager de esa PC que lance el
   contenedor.

En el aula de dos PCs, las dos tienen todos los bloques, así que lo que
decide es el lugar libre. Al final, los contadores dicen cuántos maps
fueron data-local.

Puntos que no pueden faltar: ApplicationMaster pide con preferencia;
ResourceManager reparte; el NameNode dice dónde están los bloques.

</details>

**2.** ¿Qué pasa si se pone `TRABAJADOR_RAM` más alto que la memoria que
Docker tiene libre en esa PC?

<details><summary>Respuesta modelo</summary>

El NodeManager anuncia esa memoria y el ResourceManager le manda
contenedores confiando en el número. La memoria real no alcanza: la compu
empieza a usar swap y todo se vuelve lento, o el sistema mata procesos;
puede caer el DataNode o el NodeManager de esa PC, que se da por muerto, y
las tareas se reintentan en otro lado. `TRABAJADOR_RAM` se anuncia, no se
reserva: hay que calcularlo como memoria libre menos los servicios
(DataNode y NodeManager) menos un margen.

</details>

**3.** ¿Para qué sirve `MAESTRO_NM=si`, y por qué no viene prendido?

<details><summary>Respuesta modelo</summary>

Prende un NodeManager en el maestro, que suma su `TRABAJADOR_RAM` al
cluster; además, la réplica del maestro pasa a servir para localidad. No
viene prendido porque el maestro ya corre los servicios más pesados
(NameNode, ResourceManager, Hive, MariaDB): si un trabajo lo deja sin
memoria, se cae el cluster entero, no una PC. Conviene con pocas PCs y un
maestro con RAM de sobra.

</details>

[← 3. Almacenamiento](03-almacenamiento.md) · [Evaluación](README.md) · Siguiente: [5. Redes y dimensionamiento →](05-redes-y-dimensionamiento.md)
