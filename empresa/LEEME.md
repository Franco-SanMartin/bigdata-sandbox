# Versión empresa: el cluster del aula

> Documentación completa (guías paso a paso, referencia, teoría y evaluación): [guías de `empresa`](../guias/empresa/README.md).
> La clase con las PCs del laboratorio, paso a paso: [guía 3, el laboratorio](../guias/empresa/03-laboratorio.md).

La imagen `franki678/bigdata-sandbox:empresa` es la `full` más un modo de
cluster de verdad: cada compu del aula corre un contenedor y entre todas arman
**un solo cluster** de Hadoop. Las PCs de los alumnos usan una imagen más
chica, `franki678/bigdata-sandbox:trabajador` (192 MB comprimida, contra los
1,6 GB de `empresa`), porque el reset del laboratorio borra todo cada día y
hay que volver a cargarla en cada clase.

| `ROL` | Qué corre | Imagen | Para quién |
|---|---|---|---|
| `solo` (o sin `ROL`) | Igual que la `full`: la interfaz en `:8080` | `empresa` | Cada uno en su compu |
| `maestro` | NameNode + Secondary, ResourceManager, JobHistory, MariaDB (tienda y Metastore de Hive), Hive Metastore + HiveServer2, Spark History, un DataNode de archivo y **la interfaz en `:8080` con la vista Aula** (arranca sola) | `empresa` | La compu del profe |
| `trabajador` | Un DataNode y un NodeManager | `trabajador` (o `empresa`) | Cada PC del aula |

## Las dos redes

| `RED` | Cómo se ven los nodos | Para qué |
|---|---|---|
| `docker` (de fábrica) | Todos en la misma red de Docker, por nombre (`maestro`, `pc01`...) | El aula simulada en una sola compu (`aula-simulada.yml`) y las pruebas |
| `wireguard` | Un túnel WireGuard con el hub en el maestro: cada PC se conecta **hacia** el profe y recibe su IP del túnel (`10.13.0.(10+N)`) | Las PCs del laboratorio (lo que midió la sonda el 27/10: anduvo en 11 de 11) |

Con `RED=wireguard` (lo arman [`aula/red.sh`](aula/red.sh) y
[`aula/inscripcion.py`](aula/inscripcion.py)):

1. **El maestro** crea el hub (`wg0`, `10.13.0.1`, UDP **51820**) y abre la
   **inscripción** (TCP **8099**) con un **código de la clase** de 4 letras.
   Clave, código y PCs inscriptas quedan en el volumen: un `docker restart`
   sigue con el mismo túnel.
2. **Cada PC** reserva su número con su nombre de Windows y el código
   (`red.sh reservar` → `pcNN`), arranca **con ese nombre de máquina**
   (`--hostname pcNN`: Tez se anuncia con el nombre de la máquina), se
   inscribe con su clave, levanta el túnel y se anuncia a HDFS
   (`dfs.datanode.hostname`) y a YARN (`yarn.nodemanager.hostname`) como
   `pcNN`. Todas las PCs y el maestro tienen en `/etc/hosts` los nombres del
   aula (`maestro` = `10.13.0.1`, `pcNN` = `10.13.0.(10+NN)`), así que todos
   resuelven a todos sin DNS. Los servicios escuchan en `0.0.0.0`.
3. **Las PCs no publican ningún puerto**: solo hacen conexiones salientes, así
   que no aparece el cartel del firewall de Windows. Una PC le habla a otra
   (copias de HDFS, shuffle) pasando por el hub (`ip_forward` en el maestro).
4. **MTU 1380**: 1500 de la red, menos los 80 de WireGuard sobre IPv6 y 40 de
   margen. Si en una PC no pasan paquetes de ese tamaño, esa PC baja a 1280
   sola (TCP acuerda el tamaño con cada punta).
5. Si el maestro es de otra clase (se borró su volumen), la PC borra lo que
   tenía de HDFS antes de sumarse: si no, su DataNode no arrancaría.

`WireGuard` va con el módulo del kernel (Docker Desktop lo trae) o, si no
está, con `wireguard-go` (necesita `--device /dev/net/tun`).

## Cómo se reparte

- **Racks por fila**: el maestro es `/profe` y las PCs `pcNN` van de a
  `PCS_POR_FILA` por fila (`/fila1`, `/fila2`...), en orden de número. HDFS
  deja las copias de un bloque en más de una fila.
- **Una copia de todo en el maestro**: HDFS usa la política `WARM` y el
  DataNode del maestro es de tipo `ARCHIVE`, así que cada bloque tiene una
  réplica ahí. Se puede apagar el aula entera y los datos siguen. La vista
  Aula avisa **"ya pueden apagar"** cuando el maestro tiene todos los bloques.
- **Réplica 2 en el aula de verdad** (3 en la de Docker): todo pasa por la
  PC del profe (unos 50 Mbit/s), y con 2 cada bloque cruza la red una sola vez.
- **Los trabajos corren en las PCs**: el maestro no tiene NodeManager (salvo
  `MAESTRO_NM=si`). YARN reparte por memoria **y** por cores
  (`DominantResourceCalculator`).
- **Lo que presta cada PC**: con `RED=wireguard`, dos tercios de la RAM que
  tiene Docker en esa PC, redondeado al GB (3863 MB → **2048**; 7828 MB →
  **5120**), y todos sus cores. Con `RED=docker` (varias "PCs" en la misma
  compu), 2048 MB.
- **Una PC que se apaga**: el NameNode la da por muerta a los 40 s y copia sus
  bloques; YARN la pierde a los 60 s (`LOST`) y reintenta sus tareas.

## Variables

| Variable | De fábrica | Qué hace |
|---|---|---|
| `ROL` | `solo` (`trabajador` en la imagen trabajador) | `solo`, `maestro` o `trabajador` |
| `RED` | `docker` | `docker` (una red de Docker) o `wireguard` (el túnel del aula) |
| `MAESTRO` | `maestro` | Con `RED=docker`: el nombre del maestro. Con `RED=wireguard`, en las PCs: **la IP de la PC del profe** en la red del aula |
| `CODIGO` | uno al azar | El código de la clase. En el maestro, si se pasa, es ese; en las PCs, obligatorio |
| `PC_NOMBRE` | el de la máquina | Con qué nombre se inscribe la PC (empresa-alumno.cmd pasa el de Windows) |
| `IP_AULA` | | En el maestro: su IP en el aula, para mostrarla en la vista Aula |
| `CARPETA_VEYON` | | En el maestro: dónde deja Veyon los archivos, para armar la línea de la vista Aula |
| `PCS_POR_FILA` | `5` | PCs por fila, para los racks |
| `TRABAJADOR_RAM` | 2/3 de la RAM de Docker con `RED=wireguard`; `2048` con `RED=docker` | MB que cada PC presta para trabajos (1024 a 65536) |
| `TRABAJADOR_CORES` | los de Docker con `RED=wireguard`; los de fábrica de YARN con `RED=docker` | Cores que cada PC presta para trabajos (1 a 256) |
| `MAESTRO_NM` | `no` | `si`: el maestro también corre trabajos |
| `REPLICATION` | `2` con `RED=wireguard`, `3` con `RED=docker` | Réplicas de cada bloque (con `RED=wireguard` la decide el maestro para toda la clase) |
| `WG_MTU` | `1380` | MTU del túnel |
| `INTERFAZ` | `si` | En el maestro: `no` arranca sin la interfaz (el entrypoint directo) |
| `ESPERA_MAESTRO` | `600` | Segundos que una PC espera a que conteste el profe |

## En el laboratorio

Con dos `.cmd` (para Windows, como los de la sonda):

| Archivo | Dónde | Qué hace |
|---|---|---|
| [`empresa-profe.cmd`](empresa-profe.cmd) | La PC del profe | Abre Docker Desktop si está cerrado, carga la imagen del maestro (de `bigdata-sandbox-empresa.tar.gz` al lado, o de Docker Hub), arranca `bigdata-maestro` con el hub y muestra la IP del aula, el código y la línea para Veyon. `cargar RUTA [HDFS]` sube un dataset midiendo la velocidad; `estado`, `apagar` y `cero` |
| [`empresa-alumno.cmd`](empresa-alumno.cmd) | Cada PC, por Veyon | `empresa-alumno.cmd IP CODIGO [CARPETA]`: carga la imagen trabajador (al lado del `.cmd` o en `CARPETA`, que puede ser `\\servidor\carpeta`), reserva su nombre, arranca `bigdata-trabajador` y espera a que esté en el cluster. `estado` y `salir` |

El paso a paso de la clase, con tiempos y qué mirar en la vista Aula: [guía 3](../guias/empresa/03-laboratorio.md).

Los dos `.cmd` y las imágenes en `.tar.gz` están en el release `aula-v1`.

A mano (lo mismo que hacen los `.cmd`):

```bash
# PC del profe
docker run -d --name bigdata-maestro --hostname maestro --cap-add NET_ADMIN --device /dev/net/tun \
  --sysctl net.ipv4.ip_forward=1 --stop-timeout 20 -p 51820:51820/udp -p 8099:8099 \
  -p 127.0.0.1:8080:8080 -v bigdata_aula:/hadoop -e ROL=maestro -e RED=wireguard -e IP_AULA=192.169.0.86 \
  franki678/bigdata-sandbox:empresa
docker exec bigdata-maestro cat /hadoop/aula/codigo

# Cada PC: primero el nombre, después el contenedor con ese nombre
docker run --rm --entrypoint /opt/sandbox/aula/red.sh -e RED=wireguard -e MAESTRO=192.169.0.86 \
  -e CODIGO=K7Q2 -e PC_NOMBRE=PC121 franki678/bigdata-sandbox:trabajador reservar      # -> NODO=pc03
docker run -d --name bigdata-trabajador --hostname pc03 --cap-add NET_ADMIN --device /dev/net/tun \
  --stop-timeout 20 -e RED=wireguard -e MAESTRO=192.169.0.86 -e CODIGO=K7Q2 -e PC_NOMBRE=PC121 \
  franki678/bigdata-sandbox:trabajador
```

## La imagen trabajador

Target `trabajador` del [Dockerfile](../Dockerfile), sobre Ubuntu 24.04:

- Java 8 (el runtime de Temurin, sin JDK).
- Hadoop 3.3.6 recortado a lo que usan el DataNode, el NodeManager y las
  tareas de MapReduce y Tez: sin los clientes empaquetados, las herramientas
  (S3, Azure, distcp), el Timeline Service v2, la interfaz nueva de YARN,
  los tests, los fuentes ni la documentación de la API, y sin los jars de
  `hdfs/lib` repetidos en `common/lib` (de 355 a 101 MB).
- Python 3.12 con numpy 1.26.4, el mismo que el maestro (se verifica al
  armarla): los executors de PySpark se pasan arrays con pickle.
- `wireguard-tools` y `wireguard-go`.

Spark y Tez no van: les llegan desde HDFS (`spark.yarn.archive` y
`tez.lib.uris`), que sube el maestro en su primer arranque. Para el CI mide el
`.tar.gz` y lo que tarda `docker load` (en el resumen de cada corrida de
*Empresa*).

## Probarlo en una sola compu

Alcanza con bajar [`aula-simulada.yml`](aula-simulada.yml), sin clonar el repo:

```bash
curl -fsSLO https://raw.githubusercontent.com/Franki-678/bigdata-sandbox/empresa/empresa/aula-simulada.yml
docker compose -f aula-simulada.yml up -d
docker exec maestro estado
docker exec -it pc01 bash
hdfs dfsadmin -printTopology
```

La interfaz del maestro queda en <http://localhost:8080> si se publica el
puerto (en `aula-simulada.yml` no está: agregar `- "8080:8080"` en
`ports` del maestro).

Las pruebas automáticas están en `pruebas/aula.sh`: `aula` y `aula-caida`
con `RED=docker`; `aula-wg`, `aula-wg-caida` y `aula-wg-cero` con el túnel,
cada "PC" en su propia red de Docker y sin puertos publicados. Las corre el
workflow **Empresa** en amd64 y arm64.
