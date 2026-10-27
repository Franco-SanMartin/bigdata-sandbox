# Evaluación 8. ZooKeeper y alta disponibilidad

[← 7. Spark](07-spark.md) · [Evaluación](README.md) · Teoría: [ZooKeeper y HA](../teoria/08-zookeeper-ha.md) · Guía: [9. ZooKeeper y HA](../../09-zookeeper-ha.md) · Siguiente: [9. MongoDB y NoSQL →](09-mongodb.md)

## Opción múltiple

**1.** En un HDFS con un solo NameNode, ¿qué pasa si el NameNode se cae?

- a) Nada: el Secondary NameNode toma su lugar.
- b) HDFS entero queda sin servicio hasta que vuelva: los bloques siguen en
  los DataNodes, pero nadie sabe dónde está cada uno.
- c) Se pierden todos los datos.
- d) Los DataNodes eligen un nuevo NameNode.

<details><summary>Respuesta</summary>

**b)** Es el *punto único de falla* que resuelve la alta disponibilidad.

- a) El Secondary solo hace checkpoints: no atiende clientes.
- c) Los datos no se pierden: el NameNode los vuelve a encontrar al arrancar
  (con su fsimage y los reportes de bloques).
- d) Los DataNodes no eligen nada.

</details>

**2.** ¿Qué es el *split brain*?

- a) Que un archivo quede partido en bloques.
- b) Que dos NameNodes se crean activos a la vez (por ejemplo, por un corte
  de red entre ellos) y acepten cambios cada uno por su lado.
- c) Que ZooKeeper tenga dos servidores.
- d) Que un DataNode tenga dos discos.

<details><summary>Respuesta</summary>

**b)** Los metadatos quedarían contradictorios. La HA de HDFS lo evita con
tres barreras: el candado de ZooKeeper, los JournalNodes (que solo aceptan
escrituras del activo más reciente) y el fencing.

- a) Eso es el diseño normal de HDFS.
- c) ZooKeeper funciona con varios servidores a propósito.
- d) No tiene nada que ver.

</details>

**3.** Un ensemble de ZooKeeper de 5 servidores, ¿cuántas caídas tolera sin
dejar de funcionar?

- a) 1
- b) 2
- c) 4
- d) 5

<details><summary>Respuesta</summary>

**b)** Necesita un **quórum** (mayoría estricta): 3 de 5. Con 2f+1
servidores tolera f caídas: 5 = 2·2+1.

- a) Eso tolera un ensemble de 3.
- c) Con 1 de 5 no hay mayoría.
- d) Sin servidores no hay servicio.

</details>

**4.** ¿Por qué los ensembles de ZooKeeper tienen una cantidad impar de
servidores?

- a) Porque con un número par no arranca.
- b) Porque agregar uno para llegar a un número par no tolera ninguna caída
  más: 4 servidores necesitan 3 para la mayoría y toleran 1, igual que 3.
- c) Por la licencia.
- d) Porque el líder no cuenta.

<details><summary>Respuesta</summary>

**b)** El servidor extra suma costo y una máquina más que se puede romper, sin
ganar tolerancia.

- a) Arranca con cualquier cantidad.
- c) No tiene nada que ver.
- d) El líder también vota.

</details>

**5.** ¿Qué es un **znode efímero** y para qué lo usa la HA de HDFS?

- a) Un archivo temporal de HDFS.
- b) Un nodo de ZooKeeper que existe mientras viva la sesión del cliente que
  lo creó; el candado `ActiveStandbyElectorLock` es efímero, así que si el
  ZKFC del activo muere, el candado desaparece solo.
- c) Un znode que se borra cada 60 segundos.
- d) Un NameNode standby.

<details><summary>Respuesta</summary>

**b)** Así nadie tiene que "avisar" que el activo murió: la sesión vence y
otro ZKFC puede tomar el candado.

- a) Es de ZooKeeper, no de HDFS.
- c) No vence por tiempo fijo, sino cuando vence la sesión.
- d) Es un dato, no un proceso.

</details>

**6.** ¿Qué hace el **ZKFC**?

- a) Guarda los edits de HDFS.
- b) Vigila a su NameNode; mientras está sano, compite por el candado en
  ZooKeeper, y si lo consigue, lo pasa a *active*.
- c) Es el cliente de consola de ZooKeeper.
- d) Reemplaza a los DataNodes caídos.

<details><summary>Respuesta</summary>

**b)** Hay uno por NameNode (en `jps`: `DFSZKFailoverController`).

- a) Eso hacen los JournalNodes.
- c) Esa es `zkCli.sh`.
- d) Los DataNodes no tienen reemplazo: se re-replican sus bloques.

</details>

**7.** ¿Para qué están los **JournalNodes**?

- a) Para guardar los bloques de los archivos.
- b) Para guardar el registro de cambios (edits) de HDFS: el activo escribe
  ahí, y el cambio vale cuando lo confirmó la mayoría; los standby lo leen
  para estar al día.
- c) Para elegir al activo.
- d) Para servir la web del NameNode.

<details><summary>Respuesta</summary>

**b)** Así los standby tienen los metadatos al día sin compartir un disco.
Con 3 JournalNodes hacen falta 2.

- a) Los bloques están en los DataNodes.
- c) La elección la resuelven los ZKFC con ZooKeeper.
- d) La web es del propio NameNode (9870, 9871).

</details>

**8.** En la guía 9, después de apagar el NameNode activo y prenderlo de
nuevo, ¿en qué estado vuelve?

- a) Active, porque era el primero.
- b) Standby: el activo sigue siendo el que tomó el control.
- c) Apagado.
- d) Los dos quedan active.

<details><summary>Respuesta</summary>

**b)** No hay "dueño" fijo: cambiar de activo tiene un costo, así que no se
hace sin necesidad.

- a) El número no da prioridad.
- c) Se prendió con `namenode start`.
- d) Es justo lo que la HA impide.

</details>

**9.** ¿Qué es el **fencing** y cómo está configurado en la imagen?

- a) Un firewall entre NameNodes; en la imagen está desactivado.
- b) Asegurarse de que el viejo activo no siga escribiendo antes de que el
  nuevo tome el control (por ejemplo, matarlo por SSH); en la imagen es
  `shell(/bin/true)`, que no hace nada, porque todos los NameNodes están en la
  misma máquina.
- c) La replicación de bloques.
- d) La contraseña de ZooKeeper.

<details><summary>Respuesta</summary>

**b)** En producción el fencing es real; en la imagen alcanza con la barrera
de los JournalNodes.

- a) No es un firewall.
- c) La replicación es otra cosa.
- d) ZooKeeper no tiene clave en la imagen.

</details>

**10.** ¿Por qué la guía 9 arma otro contenedor (`bigdata-ha`) en vez de
pasar a HA el cluster `bigdata`?

- a) Porque la HA solo funciona con MongoDB.
- b) Porque `NAMENODES` queda fijo al crear el volumen: cambiar la arquitectura
  de HDFS requiere otro volumen, y así no se toca el cluster de las otras
  guías.
- c) Porque `bigdata` no tiene HDFS.
- d) Porque ZooKeeper necesita su propia compu.

<details><summary>Respuesta</summary>

**b)** Con un NameNode no corren ZooKeeper, JournalNodes ni ZKFC; con 2 o 3,
sí. Los dos contenedores juntos no entran en la memoria de una notebook, por
eso se apaga `bigdata` antes.

- a) No tiene nada que ver con MongoDB.
- c) `bigdata` tiene HDFS.
- d) ZooKeeper corre adentro del mismo contenedor.

</details>

## Desarrollo

**1.** Describí, paso a paso, qué pasa desde que se apaga el NameNode activo
hasta que el otro queda *active*. Nombrá cada pieza.

<details><summary>Respuesta modelo</summary>

1. El **ZKFC** del activo detecta que su NameNode no responde y deja de
   sostener la elección; el znode efímero `ActiveStandbyElectorLock`
   desaparece (si el ZKFC también murió, desaparece cuando vence su sesión en
   **ZooKeeper**).
2. El ZKFC del standby, que tenía un *watch* sobre ese candado, se entera y
   lo toma.
3. Antes de promover a su NameNode, hace el **fencing** del viejo activo
   (lee `ActiveBreadCrumb` para saber quién era).
4. El NameNode standby termina de leer los edits de los **JournalNodes**, que
   ya tenía casi al día, y pasa a *active*. Desde ahí es el único que puede
   escribir en los JournalNodes.
5. Los clientes, configurados con los dos NameNodes, reintentan contra el
   nuevo activo. Todo tarda segundos (la guía espera 20).

</details>

**2.** ¿Por qué un quórum (mayoría) evita que haya dos decisiones
contradictorias, aunque la red se parta?

<details><summary>Respuesta modelo</summary>

Dos mayorías de un mismo grupo siempre comparten al menos un miembro: con 3
servidores, cualquier par de mayorías (de 2) tiene uno en común. Si la red se
parte en dos grupos, a lo sumo uno tiene mayoría y puede decidir; el otro se
queda sin quórum y no acepta escrituras. Por eso, en un corte, el lado
minoritario deja de responder en vez de tomar decisiones por su cuenta: se
elige consistencia antes que disponibilidad. La misma idea usan los
JournalNodes (2 de 3) y la elección de primario en un replica set de MongoDB.

</details>

**3.** ZooKeeper en la imagen tiene un solo servidor. ¿Qué limitación tiene
eso respecto de producción, y por qué igual sirve para aprender?

<details><summary>Respuesta modelo</summary>

Un solo servidor de ZooKeeper es a su vez un punto único de falla: si se cae,
no hay elección posible y la conmutación automática deja de funcionar
(aunque el activo siga atendiendo mientras su NameNode esté sano). En
producción el ensemble es de 3 o 5 servidores en máquinas distintas. Para
aprender sirve igual: el protocolo de elección (candado efímero, watch,
ZKFC), los JournalNodes y la conmutación son los mismos, y se ven en `jps`,
en `zkCli.sh` y en las webs de los NameNodes.

</details>

## Ejercicios sobre la imagen

Se hacen en el contenedor `bigdata-ha` de la
[guía 9](../../09-zookeeper-ha.md#un-cluster-con-ha-aparte).

### Ejercicio 1. Las piezas de la HA

Adentro de `bigdata-ha`, listá los procesos Java e identificá cada pieza de
la HA. ¿Cuántos hay de cada una? ¿Cuál falta respecto del cluster `bigdata`?

<details><summary>Solución</summary>

<!-- prueba: adentro bigdata-ha | espera: QuorumPeerMain | espera: JournalNode | espera: DFSZKFailoverController -->
```bash
jps
```

| En `jps` | Pieza | Cuántos |
|---|---|---:|
| `NameNode (nn1)`, `NameNode (nn2)` | NameNodes | 2 |
| `DFSZKFailoverController (nn1)`, `(nn2)` | ZKFC, uno por NameNode | 2 |
| `JournalNode (jn1)` ... `(jn3)` | JournalNodes | 3 |
| `QuorumPeerMain` | ZooKeeper | 1 |
| `DataNode (dn1)` ... `(dn3)` | DataNodes | 3 |

- Falta el **Secondary NameNode**: con HA, el standby hace los checkpoints.
- Tampoco están los procesos de YARN ni de Hive: el contenedor corre con
  `SERVICIOS=hdfs`.

</details>

**Rúbrica (8 puntos)**: identifica las cuatro piezas de la HA (4), cantidades
correctas (2), nota que falta el Secondary y por qué (2).

### Ejercicio 2. El candado en ZooKeeper

Mirá en ZooKeeper el árbol de la HA. ¿Qué znodes hay en
`/hadoop-ha/sandbox`? Compará con `hdfs haadmin -getAllServiceState`: ¿quién
tiene el candado?

<details><summary>Solución</summary>

<!-- prueba: adentro bigdata-ha | espera: ActiveStandbyElectorLock | espera: ActiveBreadCrumb | espera: active -->
```bash
zkCli.sh -server localhost:2181 ls /
zkCli.sh -server localhost:2181 ls /hadoop-ha/sandbox
hdfs haadmin -getAllServiceState
```

- En la raíz están `hadoop-ha` y `zookeeper` (el árbol interno del propio
  ZooKeeper).
- En `/hadoop-ha/sandbox` (`sandbox` es el nombre del *nameservice*):
  `ActiveStandbyElectorLock`, el candado efímero, que tiene el ZKFC del
  NameNode activo, y `ActiveBreadCrumb`, persistente, que recuerda quién fue
  el último activo (para el fencing).
- `haadmin` dice qué NameNode está `active`: es el dueño del candado.

</details>

**Rúbrica (6 puntos)**: lista los znodes (2), explica efímero frente a
persistente (2), relaciona el candado con el activo (2).

### Ejercicio 3. Ida y vuelta

Hacé que el activo cambie **dos veces**: apagá el activo, comprobá que el otro
tomó el control y que HDFS se sigue leyendo; prendelo, y repetí con el nuevo
activo. ¿Quién queda activo al final?

<details><summary>Solución</summary>

Es el bloque de la guía, dos veces seguidas, prendiendo los dos NameNodes en
cada vuelta:

<!-- prueba: adentro bigdata-ha | espera: lo apago | espera: hadoop guarda los datos en bloques -->
```bash
for vuelta in 1 2; do
  activo=$(namenode | awk '/active/ {print $2}')
  echo "Vuelta $vuelta. El activo es el $activo: lo apago"
  namenode stop $activo
  sleep 20
  namenode
  hdfs dfs -cat /user/root/texto.txt
  namenode start 1
  namenode start 2
  sleep 20
done
namenode
```

- En cada vuelta, el que era *standby* pasa a *active*, y el archivo se lee
  igual.
- Al final queda activo el mismo que al principio: cada apagado le pasa el
  control al otro, y con dos NameNodes, dos cambios vuelven al inicio.

</details>

**Rúbrica (8 puntos)**: apaga el activo correcto en cada vuelta (2),
verifica el cambio con `namenode` o `haadmin` (2), verifica que HDFS sigue
andando (2), explica quién queda al final (2).

### Ejercicio 4. Sin NameNodes

(Respuesta escrita, con prueba opcional.) ¿Qué pasa si se apagan los dos
NameNodes de `bigdata-ha`? ¿Y si en el cluster `bigdata`, que tiene uno
solo, se hace `namenode stop 1`? ¿Se pierden datos?

<details><summary>Solución</summary>

<!-- prueba: no (solución de ejercicio: sin NameNodes, el cliente reintenta durante varios minutos antes de fallar) -->
```bash
namenode stop 1
namenode stop 2
hdfs dfs -ls /user/root
namenode start 1
namenode start 2
```

- Con los dos apagados, HDFS queda sin servicio: `hdfs dfs -ls` reintenta
  contra uno y otro NameNode y termina fallando. La HA protege de **una**
  caída, no de todas.
- En `bigdata`, `namenode stop 1` deja HDFS sin servicio de inmediato: es el
  punto único de falla.
- En ningún caso se pierden datos: los bloques siguen en los DataNodes y los
  metadatos en el disco del NameNode (y en los JournalNodes). Al prender, el
  NameNode carga su fsimage y los edits, recibe los reportes de bloques y,
  después del *safe mode*, todo vuelve.

</details>

**Rúbrica (6 puntos)**: sin NameNodes no hay servicio (2), diferencia entre
HA y un solo NameNode (2), explica por qué no se pierden datos (2).
