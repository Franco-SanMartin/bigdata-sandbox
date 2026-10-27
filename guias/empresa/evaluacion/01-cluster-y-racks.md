# Evaluación 1: cluster y racks

Teoría: [de pseudo-distribuido a cluster](../teoria/01-de-pseudo-a-cluster.md)
y [réplicas y racks](../teoria/02-replicas-y-racks.md).

[Evaluación](README.md) · Siguiente: [2. Fallas →](02-fallas.md)

## Opción múltiple

**1.** En el aula, ¿qué corre en un contenedor con `ROL=trabajador`?

- a) Un NameNode y un DataNode.
- b) Un DataNode y un NodeManager.
- c) Un NodeManager y HiveServer2.
- d) Todo el cluster, igual que con `ROL=solo`.

<details><summary>Respuesta</summary>

**b)** Cada PC suma un DataNode (guarda bloques) y un NodeManager (corre
tareas), contra el maestro.

- a) No: hay un solo NameNode, en el maestro.
- c) No: HiveServer2 corre solo en el maestro.
- d) No: eso es `ROL=solo`, que además arranca con la interfaz web.

</details>

**2.** Un alumno lee un archivo de HDFS desde pc01. ¿Por dónde pasan los
**bytes** del archivo?

- a) Del NameNode a pc01: el NameNode tiene los datos.
- b) De los DataNodes que tienen los bloques a pc01; el NameNode solo dice
  dónde están.
- c) Del ResourceManager a pc01.
- d) Siempre del DataNode del maestro, porque tiene una copia de todo.

<details><summary>Respuesta</summary>

**b)** El NameNode maneja metadatos (qué bloques tiene el archivo y dónde
está cada réplica). Los datos se leen directo de los DataNodes.

- a) No: el NameNode no guarda el contenido de los archivos.
- c) No: el ResourceManager maneja memoria para trabajos, no archivos.
- d) No: el cliente elige la réplica más cercana; el maestro tiene una,
  pero no es la única ni la preferida.

</details>

**3.** Con `PCS_POR_FILA=5`, ¿en qué rack queda `pc11`?

- a) `/fila2`
- b) `/fila3`
- c) `/fila11`
- d) `/default-rack`

<details><summary>Respuesta</summary>

**b)** La cuenta es `(11 - 1) / 5 + 1 = 2 + 1 = 3` con división entera:
`/fila3` (pc11 a pc15).

- a) `/fila2` es pc06 a pc10.
- c) No hay un rack por PC: se agrupan de a `PCS_POR_FILA`.
- d) `/default-rack` es para nombres que no son `maestro` ni `pcNN`.

</details>

**4.** En el aula se suma una compu con hostname `notebook-juan`. ¿En qué
rack queda su DataNode?

- a) `/fila1`, porque es la primera que no tiene número.
- b) `/profe`.
- c) `/default-rack`.
- d) No arranca: el nombre tiene que ser `pcNN`.

<details><summary>Respuesta</summary>

**c)** El script de topología solo reconoce `maestro` (→ `/profe`) y
`pcNN` (→ `/filaK`). Cualquier otro nombre es `/default-rack`.

- a) No hay ninguna regla así.
- b) `/profe` es solo para el maestro.
- d) Arranca igual: el nombre solo cambia el rack.

</details>

**5.** ¿Quién usa `PCS_POR_FILA` para calcular los racks?

- a) Cada PC, al arrancar su DataNode.
- b) El NameNode, en el maestro, con el script `/opt/sandbox/bin/topologia`.
- c) El ResourceManager.
- d) Docker Compose.

<details><summary>Respuesta</summary>

**b)** El NameNode llama al script de topología cuando un DataNode se
anota. Por eso vale el `PCS_POR_FILA` del maestro.

- a) Las PCs no deciden su rack.
- c) El script está en la configuración de HDFS (`hdfs-site.xml`).
- d) Compose solo pasa la variable.

</details>

**6.** Con replicación 3 y la regla de fábrica de HDFS, ¿cómo quedan las
réplicas de un bloque en un cluster con varios racks?

- a) Las tres en el mismo rack, para escribir más rápido.
- b) Cada una en un rack distinto.
- c) Una en el nodo que escribe (si es DataNode), y las otras dos en un mismo
  rack distinto, en nodos distintos.
- d) Donde haya más espacio libre, sin mirar racks.

<details><summary>Respuesta</summary>

**c)** Así el bloque sobrevive a la caída de un rack, pero solo una copia
cruza entre racks.

- a) Si se cae ese rack, se pierden las tres.
- b) Es más seguro pero cruza racks dos veces: más tráfico en el enlace
  más caro. No es la regla de fábrica.
- d) El espacio cuenta, pero dentro de la regla de racks.

</details>

**7.** Con `REPLICATION=3` y solo dos DataNodes vivos, ¿qué pasa al subir
un archivo?

- a) Falla la subida.
- b) Se sube y cada bloque queda con 2 réplicas: sub-replicado.
- c) Se sube con 3 réplicas: una de las PCs guarda dos copias.
- d) HDFS baja la replicación del archivo a 2 automáticamente.

<details><summary>Respuesta</summary>

**b)** HDFS escribe en los nodos que hay y deja el bloque sub-replicado
hasta que aparezca otro DataNode.

- a) Mientras haya al menos un DataNode donde escribir, la subida anda.
- c) Un nodo nunca guarda dos réplicas del mismo bloque.
- d) La replicación del archivo sigue siendo 3: falta una copia.

</details>

**8.** Se cambia `REPLICATION` de 3 a 2 y se recrean los contenedores.
¿Qué pasa con los archivos que ya estaban?

- a) Pasan a tener 2 réplicas solos.
- b) Siguen con replicación 3: la replicación es de cada archivo y se fija
  al crearlo.
- c) Se borran.
- d) Quedan sobre-replicados para siempre.

<details><summary>Respuesta</summary>

**b)** `REPLICATION` es lo que pide el cliente al crear un archivo nuevo.
Para cambiar uno viejo está `hdfs dfs -setrep`.

- a) No: nada cambia los archivos existentes solo.
- c) Recrear los contenedores no toca los volúmenes.
- d) Sobre-replicado quiere decir más réplicas que la replicación **del
  archivo**, que sigue siendo 3.

</details>

**9.** ¿Por qué en el aula los comandos `hdfs`, `yarn` y `beeline` andan
igual desde cualquier PC?

- a) Porque cada PC tiene su propio NameNode.
- b) Porque la configuración de cada nodo, generada al arrancar, apunta al
  maestro (`hdfs://maestro:9000`, ResourceManager y Metastore en `maestro`).
- c) Porque Docker copia los comandos al maestro.
- d) No andan: solo funcionan en el maestro.

<details><summary>Respuesta</summary>

**b)** Cada nodo genera su `core-site.xml`, `yarn-site.xml` y `hive-site.xml`
con `MAESTRO` en cada arranque.

- a) Hay un solo NameNode.
- c) No hay nada de eso: el cliente corre en la PC y habla con el maestro
  por la red.
- d) Las guías los corren desde pc01, pc02 y pc03.

</details>

**10.** ¿Cuál es el punto único de falla del aula?

- a) Cualquier PC de alumno.
- b) El DataNode de pc01, porque es la primera PC.
- c) El maestro: tiene el único NameNode y el único ResourceManager.
- d) No hay ninguno: HDFS replica todo.

<details><summary>Respuesta</summary>

**c)** Sin NameNode no se sabe dónde está cada bloque; sin ResourceManager
no se lanzan trabajos.

- a) Una PC caída no frena el cluster (guía 1, sección 7).
- b) pc01 es una PC como las otras: sus bloques tienen réplicas en otros
  nodos.
- d) HDFS replica los **bloques**, no el NameNode. La alta disponibilidad
  (varios NameNodes) solo está con `ROL=solo`.

</details>

## Desarrollo

**1.** Explicá qué diferencia hay entre el modo pseudo-distribuido
(`ROL=solo`) y el aula, y qué cosas solo se pueden ver en el aula.

<details><summary>Respuesta modelo</summary>

En pseudo-distribuido todos los procesos de Hadoop corren en un mismo
contenedor: son procesos separados que hablan por la red, pero en
`localhost`, con un solo disco y sin racks. En el aula cada contenedor es
un nodo: el maestro corre NameNode, ResourceManager, Hive y el historial, y
cada PC un DataNode y un NodeManager, todos configurados para hablar con
el maestro por nombre.

Solo en el aula se ve: réplicas en nodos distintos de verdad (si se apaga
uno, los otros siguen), racks y colocación de réplicas, un nodo que se
muere y la re-replicación, trabajos repartidos en varios NodeManagers y
localidad de datos.

Puntos que no pueden faltar: los papeles de maestro y trabajador; que en
`solo` todo está en una máquina; al menos dos cosas que solo se ven en el
aula.

</details>

**2.** ¿Qué es un rack, por qué le importa a HDFS y cómo lo sabe en el
aula? Dá un ejemplo con `PCS_POR_FILA=2` y las PCs pc01 a pc04.

<details><summary>Respuesta modelo</summary>

Un rack es un grupo de máquinas que comparten switch y energía, y por eso
pueden caerse juntas. A HDFS le importa para no dejar todas las réplicas de
un bloque en el mismo rack: si ese rack se cae, se perderían todas.

HDFS no lo adivina: se lo dice un script de topología. En el aula es
`/opt/sandbox/bin/topologia`, que corre el NameNode en el maestro y calcula
el rack por el nombre: `maestro` es `/profe`, `pcNN` es la fila
`(NN - 1) / PCS_POR_FILA + 1`.

Con `PCS_POR_FILA=2`: pc01 y pc02 en `/fila1`, pc03 y pc04 en `/fila2`, el
maestro en `/profe`.

</details>

**3.** Un compañero dice: "subo todo con replicación 9, así nunca pierdo
nada". Contestale.

<details><summary>Respuesta modelo</summary>

Replicación 9 ocupa nueve veces el tamaño del archivo y cada escritura
pasa por nueve DataNodes en cañería: más lenta y más tráfico. Si el aula
tiene menos de 9 DataNodes, los bloques quedan sub-replicados para
siempre, porque un nodo no guarda dos copias del mismo bloque. Y la
ganancia es poca: con 3 réplicas en dos racks ya hace falta que fallen
varias máquinas de racks distintos a la vez. Además, en el aula ya hay una
copia de todo en el maestro.

Puntos que no pueden faltar: el costo en espacio y escritura; que no puede
haber más réplicas que DataNodes.

</details>

[Evaluación](README.md) · Siguiente: [2. Fallas →](02-fallas.md)
