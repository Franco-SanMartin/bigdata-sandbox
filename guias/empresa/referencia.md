# Referencia de `empresa`

Para consultar, no para leer de corrido. Todo sale de lo que hace la imagen
al arrancar (`entrypoint.sh`, `sandbox/lib.sh`, `sandbox/bin/topologia`,
`conf/`): si algo de esta página no coincide con lo que ves, manda lo que
ves.

[Índice de `empresa`](README.md) · [Teoría](teoria/README.md) · [Evaluación](evaluacion/README.md)

- [Roles](#roles)
- [Puertos](#puertos)
- [RAM](#ram)
- [Variables](#variables)
- [Racks](#racks)
- [Políticas de almacenamiento](#políticas-de-almacenamiento)
- [Comandos útiles](#comandos-útiles)
- [La sonda del laboratorio](#la-sonda-del-laboratorio)
- [Dónde se usa cada cosa en la industria](#dónde-se-usa-cada-cosa-en-la-industria)

## Roles

La variable `ROL` elige qué es el contenedor. La lee
`/opt/sandbox/arranque-empresa.sh`, que es el punto de entrada de la imagen.

| `ROL` | Qué corre | Cómo arranca |
|---|---|---|
| `solo` (o sin `ROL`) | Todo el cluster en un contenedor, igual que la `full` | La interfaz web en `:8080`; el cluster se prende desde ahí |
| `maestro` | NameNode y Secondary NameNode, un DataNode `ARCHIVE` (el "archivo"), ResourceManager, MapReduce JobHistory, MariaDB (base `tienda` y Metastore), Hive Metastore, HiveServer2 y Spark History Server. Con `MAESTRO_NM=si`, también un NodeManager | Directo, sin interfaz: prende sus procesos y dice `Cluster LISTO` |
| `trabajador` | Un DataNode `DISK` y un NodeManager | Directo, sin interfaz: espera al maestro, se suma y dice `Cluster LISTO` |

Lo que hace cada uno al arrancar, en orden:

**Maestro**

1. Revisa las variables (ver [Variables](#variables)): si algo no va, se
   corta con un mensaje.
2. Genera la configuración apuntando a sí mismo (`hdfs://maestro:9000`) y
   con el script de racks.
3. Primer arranque: formatea el NameNode. Prende NameNode, Secondary
   NameNode y su DataNode.
4. Espera a que HDFS salga de safe mode (si en 120 s no sale, lo fuerza y
   avisa).
5. Primer arranque: pone la política `WARM` en `/` y crea `/aula` con
   permisos `1777` (todos escriben, cada uno borra lo suyo), además de las
   carpetas de siempre (`/tmp`, `/user/hive/warehouse`, `/spark-logs`...).
6. Prende ResourceManager y JobHistory (y NodeManager si `MAESTRO_NM=si`), y
   MariaDB.
7. Primer arranque: sube las librerías de Tez y Spark a HDFS y crea la base
   `metastore` en MariaDB (usuario `hive`, clave `hive`).
8. Prende Hive Metastore, HiveServer2 y Spark History, y espera a que
   HiveServer2 conteste en `10000`.
9. `Cluster LISTO` y la salida de `estado`.

**Trabajador**

1. Revisa las variables.
2. Genera la configuración apuntando al maestro (`MAESTRO`).
3. Espera a que el NameNode del maestro conteste en `MAESTRO:9000` (hasta
   10 minutos; si no, se corta con `el NameNode del maestro (...) no
   contesta despues de 10 minutos`).
4. Prende su DataNode y espera a que el NameNode lo tenga anotado.
5. Espera al ResourceManager en `MAESTRO:8031` (hasta 10 minutos) y prende
   su NodeManager.
6. `Cluster LISTO` y la salida de `estado`.

Por eso en `aula-simulada.yml` las PCs tienen `depends_on: [maestro]`, pero
igual podrían arrancar antes: esperan solas.

## Puertos

**Maestro**

| Puerto | Proceso | Para qué | Publicado en `aula-simulada.yml` |
|---|---|---|---|
| 9000 | NameNode | RPC: clientes y DataNodes | No (solo en la red `aula`) |
| 9870 | NameNode | Interfaz web y JMX | Sí |
| 9868 | Secondary NameNode | Interfaz web | No |
| 9866 / 9867 / 9864 | DataNode (archivo) | Datos / IPC / web | No |
| 8088 | ResourceManager | Interfaz web y REST | Sí |
| 8031 | ResourceManager | Donde se anotan los NodeManagers | No |
| 8032 / 8030 | ResourceManager | Clientes / ApplicationMasters (puertos de fábrica de Hadoop) | No |
| 10020 / 19888 | JobHistory | RPC / web | 19888 sí |
| 3306 | MariaDB | Base `tienda` y Metastore | No |
| 9083 | Hive Metastore | Catálogo de tablas (Thrift) | No |
| 10000 / 10002 | HiveServer2 | JDBC (`beeline`) / web | 10000 sí |
| 18080 | Spark History | Web | Sí |
| 8041 / 8042 | NodeManager (solo con `MAESTRO_NM=si`) | RPC / web | No |

**Trabajador**

| Puerto | Proceso | Para qué |
|---|---|---|
| 9866 | DataNode | Datos: lo usan los clientes y los otros DataNodes |
| 9867 | DataNode | IPC |
| 9864 | DataNode | Web |
| 8041 | NodeManager | RPC: los ApplicationMasters le piden lanzar contenedores |
| 8042 | NodeManager | Web y logs de los contenedores |
| 13562 | NodeManager | Shuffle de MapReduce (puerto de fábrica de Hadoop: la imagen no lo cambia) |
| aleatorios | Contenedores de YARN | ApplicationMaster, executors y driver de Spark |

Los DataNodes del aula usan siempre los puertos de fábrica (`9866`,
`9867`, `9864`): hay uno por nodo. En `ROL=solo` cada DataNode tiene otros
puertos, porque conviven en el mismo contenedor.

La imagen declara `EXPOSE 9864 9866 9867 8031 8041 10020` además de los de
la `full`. En el aula simulada no hace falta publicarlos: los nodos se ven
entre sí por la red de Docker. Con PCs de verdad, todos estos puertos (y los
aleatorios) tendrían que poder abrirse entre nodos: ver [teoría:
redes](teoria/06-redes.md).

## RAM

Topes de memoria (`-Xmx`) de cada proceso, puestos por la imagen. Cada
proceso Java usa algo más que su tope (clases, hilos).

| Proceso | Tope | Dónde corre |
|---|---|---|
| NameNode | 384 MB | Maestro |
| Secondary NameNode | 256 MB | Maestro |
| DataNode | 256 MB | Todos |
| ResourceManager | 384 MB | Maestro |
| NodeManager | 256 MB | Trabajadores (y maestro con `MAESTRO_NM=si`) |
| MapReduce JobHistory | 256 MB | Maestro |
| Spark History Server | 256 MB | Maestro |
| Hive Metastore y HiveServer2 | Sin tope propio | Maestro |
| MariaDB | `innodb_buffer_pool_size = 32M` | Maestro |

Lo que pide cada trabajo a YARN (contenedores):

| Qué | Memoria pedida | Contenedor de YARN |
|---|---|---|
| ApplicationMaster de MapReduce | 512 MB | 512 MB |
| Map y reduce | 512 MB cada uno | 512 MB |
| Tez (Hive): AM y tareas | 1024 MB cada uno | 1024 MB |
| Spark: AM (`spark.yarn.am.memory`) | 512 MB + 384 MB de overhead | 1024 MB (YARN redondea a múltiplos de 512) |
| Spark: cada executor (2 de fábrica) | 512 MB + 384 MB de overhead | 1024 MB |
| Spark: driver | 512 MB | **Fuera de YARN**: corre donde se lanzó `spark-submit` (modo `client`) |

Con `TRABAJADOR_RAM=2048` (fábrica) cada PC tiene lugar para 4 contenedores
de 512 MB o 2 de 1024 MB a la vez. `TRABAJADOR_RAM` también es el contenedor
más grande que acepta el ResourceManager (`yarn.scheduler.maximum-allocation-mb`)
y el mínimo es 512 MB (`yarn.scheduler.minimum-allocation-mb`).

Cuánto pide cada nodo a Docker, a grandes rasgos: el aula simulada (maestro
y dos PCs) necesita unos 8 GB libres; cada PC que se suma, unos 2 GB más
(más si sus trabajos usan todo `TRABAJADOR_RAM`). La cuenta completa está en
[teoría: RAM por rol](teoria/07-ram-por-rol.md).

## Variables

Se pasan con `-e` en `docker run` o en `environment:` del compose. Se leen
**en cada arranque** (la configuración se vuelve a generar cada vez): para
cambiarlas alcanza con recrear el contenedor.

| Variable | De fábrica | Qué hace | Quién la usa |
|---|---|---|---|
| `ROL` | `solo` | `solo`, `maestro` o `trabajador` | Todos |
| `RED` | `docker` | Cómo se ven los nodos. Hoy solo `docker` (todos en una red de Docker); otro valor corta el arranque | Maestro y trabajadores |
| `MAESTRO` | `maestro` | Nombre (o IP) del maestro | Trabajadores (y el maestro, para su propia configuración) |
| `NODO` | el `hostname` del contenedor | Nombre con el que el nodo se anuncia (DataNode y NodeManager) | Todos |
| `PCS_POR_FILA` | `5` (`2` en `aula-simulada.yml`) | Cuántas PCs por fila (rack). Número de 1 en adelante | El maestro (lo usa el script de racks) |
| `TRABAJADOR_RAM` | `2048` | MB que cada NodeManager presta para trabajos (1024 a 65536). En el maestro: el contenedor más grande que acepta YARN | NodeManagers y ResourceManager |
| `MAESTRO_NM` | `no` | `si`: el maestro también corre trabajos | Maestro |
| `REPLICATION` | `3` en el aula (`1` con `ROL=solo`) | Copias de cada bloque nuevo, de 1 a 9 | Quien escribe el archivo |
| `BLOCK_SIZE` | `128m` | Tamaño de bloque de los archivos nuevos | Quien escribe el archivo |
| `SERVICIOS` | `todo` | `hdfs`, `mapreduce` (YARN + MapReduce) o `todo` (más Hive y Spark) | Todos |
| `MONGODB` | `no` | `si`: prende MongoDB en ese nodo | Cualquiera |
| `JUPYTER` | `no` en el aula (`si` con `ROL=solo`) | JupyterLab | Cualquiera |
| `NAMENODES` | `1` | Con `maestro`/`trabajador` solo puede ser `1`: la alta disponibilidad se ve con `ROL=solo` | Validación |
| `DATANODES` | `1` fijo en el aula | Se ignora con un aviso: cada nodo tiene un DataNode | Validación |

Mensajes con los que se corta el arranque si una variable no va:

| Caso | Mensaje |
|---|---|
| `RED` distinto de `docker` | `RED=...: por ahora solo docker (los nodos en una red de Docker)` |
| `NAMENODES` distinto de 1 | `NAMENODES=...: con ROL=... hay un solo NameNode (la alta disponibilidad se ve con ROL=solo)` |
| `PCS_POR_FILA` no es un número de 1 en adelante | `PCS_POR_FILA=...: tiene que ser un numero de 1 en adelante` |
| `TRABAJADOR_RAM` fuera de rango | `TRABAJADOR_RAM=...: MB, de 1024 a 65536` |
| `MAESTRO_NM` | `MAESTRO_NM=...: tiene que ser si o no` |
| `ROL` | `ROL=...: tiene que ser solo, maestro o trabajador` |

## Racks

El NameNode le pregunta el rack de cada DataNode a un script,
`/opt/sandbox/bin/topologia` (`net.topology.script.file.name` en
`hdfs-site.xml`). El script recibe nombres o IPs y contesta un rack por
cada uno, en orden:

| Nombre | Rack |
|---|---|
| `maestro` (o el `hostname` del nodo que corre el script) | `/profe` |
| `pcNN` | `/filaK`, con `K = (NN - 1) / PCS_POR_FILA + 1` (división entera) |
| cualquier otro | `/default-rack` |

Detalles:

- Si recibe una IP, busca el nombre (`getent hosts`), y se queda con lo
  que va antes del primer punto: `pc07.aula` es `pc07`.
- Acepta ceros adelante o no: `pc7` y `pc07` son la misma PC.
- `PCS_POR_FILA` inválido en el script cae en 5 (el arranque ya lo habría
  cortado antes).
- Como `hostname` cuenta como `/profe`, conviene probarlo **en el maestro**:
  corrido en `pc01`, `topologia pc01` contesta `/profe`.
- El NameNode resuelve el rack cuando el DataNode se anota. Cambiar
  `PCS_POR_FILA` cuenta al reiniciar el maestro.

Con `PCS_POR_FILA=5`:

| PCs | Rack |
|---|---|
| pc01 a pc05 | `/fila1` |
| pc06 a pc10 | `/fila2` |
| pc11 a pc15 | `/fila3` |

YARN: el script está en `hdfs-site.xml`, que es la configuración de HDFS.
El ResourceManager lee `core-site.xml` y `yarn-site.xml`, así que no está
garantizado que vea las filas: puede tener a todos los NodeManagers en
`/default-rack`. Se comprueba en <http://localhost:8088> → **Nodes**,
columna **Rack** (ver [teoría: localidad](teoria/05-localidad-y-yarn.md)).

## Políticas de almacenamiento

HDFS sabe de **tipos de almacenamiento** (`DISK`, `SSD`, `ARCHIVE`,
`RAM_DISK`...) y de **políticas** que dicen en qué tipo va cada réplica.
En el aula:

- El DataNode del maestro guarda en `[ARCHIVE]/hadoop/dfs/dn1`; los de las
  PCs, en `[DISK]/hadoop/dfs/dn1`.
- En el primer arranque, el maestro pone la política `WARM` en `/`: todo lo
  que se escriba debajo la hereda.

| Política | Dónde van las réplicas | Si no hay lugar del tipo pedido |
|---|---|---|
| `HOT` (la de fábrica de HDFS) | Todas en `DISK` | Al escribir, ninguno; al re-replicar, `ARCHIVE` |
| `WARM` (la del aula) | Una en `DISK`, el resto en `ARCHIVE` | `DISK` o `ARCHIVE` |
| `COLD` | Todas en `ARCHIVE` | Ninguno: si no hay `ARCHIVE`, la réplica no se hace |
| `ONE_SSD` / `ALL_SSD` | Una / todas en `SSD`, el resto en `DISK` | `DISK` (y `SSD`) |

La lista exacta, con los tipos y los de reemplazo de cada política, la da
`hdfs storagepolicies -listPolicies`.

Con `REPLICATION=3`, `WARM` quiere 1 `DISK` y 2 `ARCHIVE`, pero hay un solo
nodo `ARCHIVE` (el maestro) y un nodo no guarda dos copias del mismo
bloque: la segunda `ARCHIVE` cae en `DISK`. Resultado: **1 `ARCHIVE` (el
maestro) y 2 `DISK` (dos PCs)**. Con `REPLICATION=2`: 1 y 1. Las pruebas de
la imagen (`pruebas/aula.sh`) verifican exactamente una `ARCHIVE` por bloque.

Más en [teoría: políticas y tiers](teoria/04-politicas-de-almacenamiento.md).

## Comandos útiles

Todos andan desde cualquier nodo (todos apuntan al maestro). Se corren con
el aula andando ([guía 1](01-aula-simulada.md)), adentro de un nodo.

| Para | Comando |
|---|---|
| Qué corre en este nodo y qué dice el NameNode | `estado` |
| DataNodes vivos y muertos, espacio, rack de cada uno | `hdfs dfsadmin -report` |
| Solo los vivos / los muertos | `hdfs dfsadmin -report -live` / `-dead` |
| Racks y qué DataNode hay en cada uno | `hdfs dfsadmin -printTopology` |
| Bloques de un archivo, réplicas y tipo de cada una | `hdfs fsck <ruta> -files -blocks -locations` |
| Bloques de un archivo y rack de cada réplica | `hdfs fsck <ruta> -files -blocks -racks` |
| Salud de todo HDFS (sub/sobre-replicados, perdidos) | `hdfs fsck /` |
| Políticas que existen | `hdfs storagepolicies -listPolicies` |
| Política de una ruta | `hdfs storagepolicies -getStoragePolicy -path <ruta>` |
| Cambiar la replicación de un archivo (y esperar) | `hdfs dfs -setrep -w <n> <ruta>` |
| NodeManagers y su estado | `yarn node -list` (con `-all`, también los caídos) |
| Trabajos | `yarn application -list` (con `-appStates ALL`, los terminados) |
| Racks a mano (en el maestro) | `PCS_POR_FILA=5 /opt/sandbox/bin/topologia pc01 pc06` |

Cómo leer `fsck`:

- `-locations` muestra cada réplica como
  `DatanodeInfoWithStorage[ip:9866,DS-...,DISK]`: el último campo es el
  tipo. Con `-racks`, en ese lugar aparece el rack (`/fila1/ip:9866`), sin
  el tipo: para ver las dos cosas, correr los dos.
- `Live_repl=N`: réplicas vivas de ese bloque.
- `Under-replicated blocks` / `Over-replicated blocks` /
  `Missing blocks` / `Corrupt blocks` en el resumen.
- `The filesystem under path ... is HEALTHY` quiere decir que **no hay
  bloques perdidos ni corruptos**. Un HDFS con bloques sub-replicados sigue
  siendo `HEALTHY`; uno con un bloque sin ninguna réplica es `CORRUPT`.

Desde la compu, sin entrar al nodo: `docker exec maestro estado`,
`docker exec pc01 hdfs dfsadmin -printTopology`.

Interfaces web (con los puertos que publica `aula-simulada.yml`):

| Qué | Dónde |
|---|---|
| NameNode: DataNodes, bloques, explorador de HDFS | <http://localhost:9870> |
| YARN: nodos, trabajos | <http://localhost:8088> |
| JobHistory: trabajos de MapReduce terminados, en qué nodo corrió cada tarea | <http://localhost:19888> |
| Spark History | <http://localhost:18080> |

## La sonda del laboratorio

Un programa aparte (release `sonda-v1`, imagen `bigdata-sandbox-sonda:v1`,
no está en Docker Hub) que se corre a la vez en la PC del profe y en las de
los alumnos para saber **qué red se puede armar en ese laboratorio**. El
paso a paso está en el [LEEME de la sonda](../../sonda/LEEME.md) y en la
[guía 3](03-laboratorio.md).

**Qué publica cada uno**

| PC | Puertos | Para qué |
|---|---|---|
| Profe | UDP 51820 | Hub del túnel WireGuard |
| Profe | UDP 51821 | Eco: ¿llega un paquete UDP y vuelve? |
| Profe | TCP 8099 | Inscripción de las PCs y resultados (y el resumen web) |
| Alumno | TCP 8098 | Prueba de entrada: ¿el profe puede abrir una conexión hacia la PC? |

El túnel usa la red `10.13.0.0/24` (profe `.1`, alumnos `.11` en
adelante).

**Qué mide** (columnas de `planilla.csv`, una fila por PC):

| Grupo | Columnas | Qué dice |
|---|---|---|
| La PC | `nombre`, `ip_pc`, `perfil_red`, `windows`, `ram_gb`, `cpu`, `nucleos`, `gpu` | Hardware y si Windows ve la red como Pública/Privada/Dominio |
| Docker | `docker_desktop`, `docker_ram_mb`, `docker_cpus`, `docker_kernel`, `docker`, `imagen_cargada_antes`, `carga_seg` | Si Docker anda y cuánta RAM le da a los contenedores |
| Salida hacia el profe | `udp_profe`, `inscripcion` | UDP 51821 y TCP 8099 hacia el profe |
| Túnel | `dev_net_tun`, `wg_kernel`, `wg_go`, `tunel`, `tunel_modo`, `tunel_motivo` | Si se pudo levantar WireGuard (del kernel o `wireguard-go`) y, si no, por qué |
| Calidad | `ping_profe_ms`, `iperf_profe_mbps`, `iperf_par`, `iperf_par_mbps` | Latencia y ancho de banda por el túnel, hacia el profe y hacia otro alumno pasando por el profe |
| Entrada | `tcp_entrante`, `tcp_companeros` | Si el profe (y dos compañeros) pudieron abrir una conexión **hacia** la PC |
| Día siguiente | `dia2_*` | Si el reset diario borró la imagen |

**Cómo decide** (con el 80% de las PCs **que mandaron resultado** como
umbral):

1. Si el túnel levantó en el 80% o más: **A** (overlay WireGuard).
2. Si no, pero `tcp_entrante` anduvo en el 80% o más: **B** (red directa).
3. Si no: **SIMULADO** (cada PC con su cluster simulado).
4. Si ninguna PC mandó nada: **SIN DATOS**.

Por qué esas dos preguntas y no otras: [teoría: redes](teoria/06-redes.md).

## Dónde se usa cada cosa en la industria

Esto no sale del código, sino de cómo se usan estas ideas afuera del aula.

| En el aula | En una empresa |
|---|---|
| Racks `/fila1`, `/fila2` con un script | **Rack awareness** en todo cluster Hadoop on-premise: el script (o una clase Java) lo arma el equipo de infraestructura a partir del inventario o de la subred de cada rack. La regla de réplicas es la misma: no todas en el mismo rack, para sobrevivir a la caída de un switch o de una fuente |
| `/profe` como un rack aparte | Un nodo o grupo de nodos con un rol distinto (nodos de borde, de archivo) |
| `WARM` con el maestro `ARCHIVE` | **Tiers de almacenamiento**: datos calientes en SSD o disco rápido, datos fríos en nodos con mucho disco barato y poca CPU (`ARCHIVE`). Las políticas `HOT`/`WARM`/`COLD` se ponen por carpeta (por ejemplo, por antigüedad de la partición) y la herramienta `hdfs mover` mueve las réplicas que ya estaban |
| Re-replicación a los ~40 s | Lo mismo, con los tiempos de fábrica (un nodo muerto a los ~10,5 minutos): más lento a propósito, para no mover terabytes por un reinicio |
| `docker kill` de una PC | Mantenimiento: se usa **decommission** para sacar un nodo de forma ordenada (primero copia sus bloques, después se apaga) |
| Todo en máquinas propias (on-prem) | En la **nube** los clusters suelen separar cómputo y almacenamiento: los datos en un almacenamiento de objetos (tipo S3) y los nodos de cómputo se prenden y apagan según la carga. Ahí el equivalente de los racks son las **zonas de disponibilidad**, y el de los tiers, las **clases de almacenamiento** (estándar, acceso poco frecuente, archivo) |
| La sonda | Antes de instalar un cluster se relevan red y firewalls: qué puertos abrir entre nodos y entre clientes y nodos. Cuando la red no es propia, se arma una red privada encima (VPN o overlay) |
