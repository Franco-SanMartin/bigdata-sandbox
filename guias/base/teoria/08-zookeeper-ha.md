# 8. ZooKeeper y alta disponibilidad

Cómo un sistema distribuido se pone de acuerdo en algo tan simple como
"quién manda", aunque se caigan máquinas o se corte la red. ZooKeeper es la
pieza que lo resuelve en el ecosistema Hadoop, y la alta disponibilidad (HA)
del NameNode es su uso más conocido.

[← 7. Spark](07-spark.md) · [Teoría](README.md) · Siguiente: [9. MongoDB y NoSQL →](09-mongodb.md)

## El problema: el punto único de falla

En HDFS sin HA hay **un** NameNode. Si se cae (un corte de luz, una
actualización, un disco), nadie sabe dónde está cada bloque: los datos siguen
en los DataNodes, pero HDFS entero queda sin servicio hasta que vuelva. Y el
Secondary NameNode no lo reemplaza, porque solo hace checkpoints.

La solución obvia es tener dos NameNodes. Trae dos problemas:

1. **Que tengan los mismos metadatos**, al día, en todo momento.
2. **Que manden de a uno.** Si los dos se creen activos (*split brain*: la
   red se corta entre ellos y cada uno cree que el otro murió), cada uno
   acepta cambios por su lado y los metadatos se corrompen.

## Conceptos de coordinación

| Concepto | Qué es |
|---|---|
| **Consenso** | Que varios procesos acuerden un valor (quién es el líder, el orden de las operaciones) aunque algunos fallen |
| **Quórum** | La mayoría estricta de un grupo: 2 de 3, 3 de 5. Dos mayorías siempre comparten al menos un miembro, así que no puede haber dos decisiones contradictorias |
| **Ensemble** | El grupo de servidores de ZooKeeper (3 o 5 en producción). Con 2f+1 servidores tolera f caídos |
| **Líder y seguidores** | En el ensemble, un servidor es líder: toda escritura pasa por él y se confirma cuando la aceptó un quórum (protocolo ZAB) |
| **Znode** | Cada nodo del árbol de datos de ZooKeeper (`/hadoop-ha/sandbox/...`), con pocos datos (bytes o KB, no archivos) |
| **Znode efímero** | Existe mientras viva la **sesión** del cliente que lo creó. Si el cliente se cae y deja de mandar latidos, la sesión vence y el znode desaparece solo |
| **Znode secuencial** | ZooKeeper le agrega un número creciente al nombre: sirve para colas y turnos |
| **Watch** | Aviso que pide un cliente para enterarse cuando un znode cambia o desaparece |
| **Fencing** | "Cercar" al viejo activo para asegurarse de que no siga escribiendo antes de que el nuevo tome el control |

## ZooKeeper por dentro

```text
               clientes (ZKFC, HBase, Kafka...)
              /           |            \
     +-----------+  +-----------+  +-----------+
     | ZK server |  | ZK server |  | ZK server |    ensemble de 3: tolera 1 caído
     | seguidor  |  |  LÍDER    |  | seguidor  |
     +-----------+  +-----------+  +-----------+
          ^   escrituras: el líder las propone y las confirma con quórum (2 de 3)
          |   lecturas: las responde el servidor al que está conectado el cliente

     árbol de znodes (igual en los 3):
       /
       +-- zookeeper
       +-- hadoop-ha
            +-- sandbox
                 +-- ActiveStandbyElectorLock   (efímero: lo tiene el NameNode activo)
                 +-- ActiveBreadCrumb           (persistente: quién fue el último activo)
```

Con znodes efímeros y watches se arma una **elección de líder**: todos
intentan crear el mismo znode efímero; ZooKeeper garantiza que solo uno lo
logra (ese es el líder). Los demás ponen un watch. Si el líder muere, su
sesión vence, el znode desaparece, los demás reciben el aviso y vuelven a
intentar.

ZooKeeper **no** es una base de datos: guarda poco, en memoria, y está pensado
para muchas lecturas y pocas escrituras. Su valor está en las garantías:
escrituras en un orden total, atómicas, y que sobreviven mientras haya
quórum.

## La alta disponibilidad de HDFS

```text
                       ZooKeeper (:2181)
                  /hadoop-ha/sandbox/ActiveStandbyElectorLock
                     ^                           ^
            compite  |                           |  compite
                 [ZKFC nn1]                  [ZKFC nn2]
            vigila   |                           |  vigila
                     v                           v
   clientes --> [NameNode nn1]              [NameNode nn2]
   hdfs://sandbox    ACTIVE                     STANDBY
                     |  escribe edits            ^  lee edits
                     v                           |
              [JournalNode 1] [JournalNode 2] [JournalNode 3]
               un cambio vale cuando lo guardó la mayoría (2 de 3)

   DataNodes: mandan heartbeats y block reports a LOS DOS NameNodes
```

Cómo resuelve cada problema:

1. **Metadatos al día**: el activo escribe cada cambio (*edit*) en los
   **JournalNodes** (*Quorum Journal Manager*), y el cambio vale cuando lo
   guardó la mayoría. El standby lee esos edits y los aplica. Como los
   DataNodes le reportan los bloques **a los dos**, el standby también sabe
   dónde está cada bloque y puede tomar el control en segundos, sin el *safe
   mode* largo de un arranque en frío. El standby hace también los
   checkpoints: con HA no hay Secondary NameNode.
2. **Uno solo manda**:
   - Cada **ZKFC** vigila la salud de su NameNode y compite por el znode
     efímero. El que lo tiene pone a su NameNode como *active*.
   - Si el activo se cuelga, su ZKFC suelta el candado (o su sesión vence si
     se cayó la máquina entera). Otro ZKFC lo toma y pasa a *active* a su
     NameNode: es el **failover automático**.
   - Los JournalNodes, además, solo aceptan escrituras del NameNode con la
     "época" más nueva, así que un activo viejo que siguiera vivo no puede
     escribir edits. El **fencing** es una segunda barrera: antes de tomar el
     control, se intenta asegurar que el viejo esté muerto (por ejemplo,
     matarlo por SSH). En la imagen todos los NameNodes están en la misma
     máquina, así que el fencing es `shell(/bin/true)`: no hace nada.
3. **Los clientes no saben quién es el activo**: usan una dirección lógica,
   `hdfs://sandbox`. Un *failover proxy provider* prueba los NameNodes de la
   lista hasta dar con el activo.

### Qué se gana y qué cuesta

| | Sin HA | Con HA |
|---|---|---|
| Se cae el NameNode | HDFS sin servicio hasta que vuelva | Otro toma el control en segundos |
| Procesos | NameNode + Secondary | 2 o 3 NameNodes + 3 JournalNodes + 1 ZKFC por NameNode + ZooKeeper |
| Memoria en la imagen | menos | más: 8 GB para Docker según los [requisitos](../README.md#requisitos), y la guía 9 usa `SERVICIOS=hdfs` para aliviar |
| Checkpoints | Secondary NameNode | El standby |

En la imagen, ZooKeeper tiene **un solo servidor**. Alcanza para ver la
elección, pero no tolera que se caiga ZooKeeper mismo. En producción son 3 o 5
servidores, en máquinas distintas.

## Ventajas y limitaciones de ZooKeeper

**Ventajas**

- Primitivas simples (znodes, efímeros, watches) con garantías fuertes,
  sobre las que se construye elección de líder, candados, configuración
  compartida y registro de servicios.
- Probado durante años en producción (Hadoop, HBase, Kafka, Solr).

**Limitaciones**

- Es otro sistema distribuido que hay que operar, y necesita un número impar
  de servidores para que el quórum tenga sentido.
- Pocas escrituras por segundo y datos chicos: no sirve como base.
- Si pierde el quórum, todo lo que depende de él deja de poder cambiar de
  líder.
- La tendencia es integrar el consenso dentro de cada sistema: Kafka lo
  reemplazó por su protocolo KRaft, y Kubernetes usa etcd (basado en Raft, la
  misma familia de algoritmos).

## En la guía 9 lo ves cuando...

- **[Un cluster con HA, aparte](../../09-zookeeper-ha.md#un-cluster-con-ha-aparte)**:
  `NAMENODES=2` cambia la arquitectura entera (ZooKeeper, 3 JournalNodes, 2
  ZKFC, sin Secondary), y por eso queda fijo en el volumen. `namenode`
  muestra uno *active* y otro *standby*.
- **[Mirar adentro](../../09-zookeeper-ha.md#mirar-adentro)**:
  `zkCli.sh ... ls /hadoop-ha/sandbox` muestra el candado
  (`ActiveStandbyElectorLock`, efímero) y `ActiveBreadCrumb`.
- **[Se cae el NameNode activo](../../09-zookeeper-ha.md#se-cae-el-namenode-activo)**:
  el standby pasa a *active* solo y el archivo se lee igual. Cuando el viejo
  vuelve, queda como *standby*.
- **Para pensar** de la guía: con los dos NameNodes apagados no hay a quién
  pasarle el control. Con un solo NameNode (sin HA), `namenode stop 1` deja a
  HDFS sin servicio.

Para repasar: [evaluación de ZooKeeper y HA](../evaluacion/08-zookeeper-ha.md).
Comandos: [referencia de ZooKeeper](../referencia.md#zookeeper).
